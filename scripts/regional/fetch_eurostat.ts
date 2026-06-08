/**
 * Fetch sub-national (NUTS3 / oblast-level) indicators for Bulgaria and
 * write data/regional.json. Drilldown overlay for /municipality/<code>
 * showing the latest value + YoY delta + sparkline alongside the existing
 * electoral analysis.
 *
 * Indicators (Phase 1):
 *   nama_10r_3gdp     — GDP per capita (EUR per inhabitant, annual)
 *   nama_10r_3popgdp  — Average annual population (thousand persons)
 *   demo_r_gind3      — Net migration rate (per 1000 population)
 *
 * Originally the PRD targeted NSI as the data source. The spike found that
 * NSI's portal is behind Cloudflare with cookie sessions and the open-data
 * API does not exist, while Eurostat exposes all 28 BG NUTS3 oblasts in a
 * single JSON call per indicator with annual coverage from 2000 onward.
 * Sub-municipal (LAU2) work — registered unemployment per ОНС, DZI scores,
 * EU funds — is deferred to a later phase.
 *
 * Usage:
 *   tsx scripts/regional/fetch_eurostat.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { EUROSTAT_NUTS3_TO_OBLAST } from "./oblast_map";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_FILE = path.resolve(__dirname, "../../data/regional.json");

const EUROSTAT_BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

const START_YEAR = 2005;

// Hard floor — annual cadence, 28 oblasts × at least 10 years of data.
// A fetched series with fewer points across all oblasts is treated as a
// catastrophic upstream failure and the run aborts.
const MIN_POINTS_PER_OBLAST = 10;
// Regression threshold: if the new fetch returns materially fewer total
// points than the previously-committed data/regional.json, abort.
const REGRESSION_THRESHOLD = 0.1;

type RegionalPoint = { year: number; value: number };

type RegionalIndicator = {
  key: string;
  dataset: string;
  query: Record<string, string>;
  titleEn: string;
  titleBg: string;
  unitLabelEn: string;
  unitLabelBg: string;
  sourceUrl: string;
  // Per-indicator floor override. Defaults to MIN_POINTS_PER_OBLAST. Crime
  // and other patchy series legitimately have fewer years in small oblasts,
  // so they relax this rather than weakening the floor for everything.
  minPointsPerOblast?: number;
  // Some series legitimately publish 0 or negative values (e.g. net
  // migration). Default validation rejects only undefined / non-finite.
};

const INDICATORS: RegionalIndicator[] = [
  {
    key: "gdpPerCapita",
    dataset: "nama_10r_3gdp",
    query: { unit: "EUR_HAB", freq: "A" },
    titleEn: "GDP per capita",
    titleBg: "БВП на човек от населението",
    unitLabelEn: "EUR per inhabitant",
    unitLabelBg: "евро на човек",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/nama_10r_3gdp/default/table",
  },
  {
    key: "population",
    dataset: "nama_10r_3popgdp",
    query: { unit: "THS", freq: "A" },
    titleEn: "Population (annual average)",
    titleBg: "Население (средногодишно)",
    unitLabelEn: "thousand persons",
    unitLabelBg: "хил. души",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/nama_10r_3popgdp/default/table",
  },
  {
    key: "netMigration",
    dataset: "demo_r_gind3",
    query: { indic_de: "CNMIGRATRT", freq: "A" },
    titleEn: "Net migration rate",
    titleBg: "Нетна миграция",
    unitLabelEn: "per 1000 inhabitants",
    unitLabelBg: "на 1000 души",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/demo_r_gind3/default/table",
  },
  {
    // RP "Сигурност и правосъдие" proxy. crim_gen_reg has no "total" ICCS
    // category — only specific offence types — so we pick theft (ICCS0502),
    // the most common and regionally-discriminating recorded offence, as the
    // headline safety indicator. Per 100k inhabitants, fresh through 2024.
    key: "theftRate",
    dataset: "crim_gen_reg",
    query: { unit: "P_HTHAB", iccs: "ICCS0502", freq: "A" },
    titleEn: "Theft (recorded, per 100k)",
    titleBg: "Кражби (регистрирани, на 100 000 души)",
    unitLabelEn: "per 100 000 inhabitants",
    unitLabelBg: "на 100 000 души",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/crim_gen_reg/default/table",
    // Recorded-crime series are patchy in small oblasts (Видин ≈ 8 years);
    // relax the historical-depth floor — latest-value + sparkline still work.
    minPointsPerOblast: 5,
  },
];

type EurostatResponse = {
  value: Record<string, number> | number[];
  dimension: {
    time: { category: { index: Record<string, number> } };
    geo: { category: { index: Record<string, number> } };
  };
  size: number[];
  id: string[];
};

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

const fetchEurostat = async (
  ind: RegionalIndicator,
): Promise<Record<string, RegionalPoint[]>> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  for (const [k, v] of Object.entries(ind.query)) params.append(k, v);
  const url = `${EUROSTAT_BASE}/${ind.dataset}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Eurostat ${ind.key} returned ${res.status} for ${url}`);
  }
  const json = (await res.json()) as EurostatResponse;

  // Eurostat JSON-stat uses a row-major flattened index across dimensions
  // listed in `id`. For our queries the only multi-cardinality dimensions
  // are `geo` (28+ entities) and `time` (25+ years); other filters return
  // 1 each. Index = geoIdx * timeCount + timeIdx.
  const geoIndex = json.dimension.geo.category.index;
  const timeIndex = json.dimension.time.category.index;
  const timeKeys = Object.keys(timeIndex).sort(
    (a, b) => timeIndex[a] - timeIndex[b],
  );
  const timeCount = timeKeys.length;

  const values = json.value;
  const valueAt = (idx: number): number | undefined => {
    const v = Array.isArray(values) ? values[idx] : values[String(idx)];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };

  // Verify shape assumption — id order should end with [..., geo, time].
  // If Eurostat ever reorders dimensions on this dataset we want to fail
  // loudly rather than silently mis-index.
  const expectedTail = ["geo", "time"];
  const actualTail = json.id.slice(-2);
  if (actualTail[0] !== expectedTail[0] || actualTail[1] !== expectedTail[1]) {
    throw new Error(
      `Eurostat ${ind.key}: unexpected dimension order ${JSON.stringify(
        json.id,
      )} — expected geo,time as last two`,
    );
  }

  const out: Record<string, RegionalPoint[]> = {};
  for (const [nuts3Code, geoIdx] of Object.entries(geoIndex)) {
    if (!/^BG[0-9]{3}$/.test(nuts3Code)) continue; // skip aggregates (BG, BG3, BG31)
    const series: RegionalPoint[] = [];
    for (let t = 0; t < timeCount; t++) {
      const flatIdx = geoIdx * timeCount + t;
      const v = valueAt(flatIdx);
      if (v === undefined) continue;
      const year = Number(timeKeys[t]);
      if (!Number.isInteger(year) || year < START_YEAR) continue;
      series.push({ year, value: round(v, 2) });
    }
    series.sort((a, b) => a.year - b.year);
    if (series.length > 0) out[nuts3Code] = series;
  }
  return out;
};

// Aggregate per-oblast points from per-NUTS3 fetch results. When a single
// NUTS3 code maps to multiple oblast codes (Sofia stolitsa BG411 → S23,
// S24, S25), we duplicate the series to each — the underlying statistic
// is the same for the whole city.
const projectToOblasts = (
  nuts3Series: Record<string, RegionalPoint[]>,
): Record<string, RegionalPoint[]> => {
  const out: Record<string, RegionalPoint[]> = {};
  for (const [nuts3, series] of Object.entries(nuts3Series)) {
    const oblasts = EUROSTAT_NUTS3_TO_OBLAST[nuts3];
    if (!oblasts) {
      // Eurostat published a NUTS3 we don't recognise — log but don't fail.
      console.warn(`  ! NUTS3 ${nuts3} has no oblast mapping — skipping`);
      continue;
    }
    for (const oblast of oblasts) {
      out[oblast] = series;
    }
  }
  return out;
};

type RegionalPayload = {
  source: {
    name: string;
    url: string;
  };
  fetchedAt: string;
  country: string;
  indicators: Record<
    string,
    {
      titleEn: string;
      titleBg: string;
      unitLabelEn: string;
      unitLabelBg: string;
      sourceUrl: string;
      datasetCode: string;
    }
  >;
  // series[indicatorKey][oblastCode] = annual time series.
  series: Record<string, Record<string, RegionalPoint[]>>;
};

const readPrior = (): RegionalPayload | null => {
  if (!fs.existsSync(OUT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(OUT_FILE, "utf8")) as RegionalPayload;
  } catch {
    return null;
  }
};

const totalPoints = (series: Record<string, RegionalPoint[]>): number => {
  let n = 0;
  for (const s of Object.values(series)) n += s.length;
  return n;
};

const main = async () => {
  console.log(
    `NUTS3 → oblast mapping: ${Object.keys(EUROSTAT_NUTS3_TO_OBLAST).length} NUTS3 codes`,
  );

  const prior = readPrior();
  const series: Record<string, Record<string, RegionalPoint[]>> = {};
  const indicatorsMeta: RegionalPayload["indicators"] = {};

  for (const ind of INDICATORS) {
    process.stdout.write(`Loading ${ind.key} (${ind.dataset})... `);
    const byNuts3 = await fetchEurostat(ind);
    const byOblast = projectToOblasts(byNuts3);

    // Floor: each oblast we cover should have at least N years. Find the
    // weakest oblast and abort if it's below the floor — catches the
    // "Eurostat filter narrowed and most series are now 0-1 points" case.
    const weakest = Object.entries(byOblast).reduce<{
      code: string;
      n: number;
    } | null>(
      (acc, [code, s]) =>
        !acc || s.length < acc.n ? { code, n: s.length } : acc,
      null,
    );
    const floor = ind.minPointsPerOblast ?? MIN_POINTS_PER_OBLAST;
    if (!weakest || weakest.n < floor) {
      throw new Error(
        `safety check: ${ind.key} weakest oblast ${weakest?.code} has ${
          weakest?.n ?? 0
        } points (floor ${floor}). Upstream likely changed.`,
      );
    }

    // Regression vs. prior file.
    if (prior?.series?.[ind.key]) {
      const prevTotal = totalPoints(prior.series[ind.key]);
      const nowTotal = totalPoints(byOblast);
      if (prevTotal > 0) {
        const drop = (prevTotal - nowTotal) / prevTotal;
        if (drop > REGRESSION_THRESHOLD) {
          throw new Error(
            `safety check: ${ind.key} total points dropped ${prevTotal} → ${nowTotal} (${(
              drop * 100
            ).toFixed(1)}% > ${(REGRESSION_THRESHOLD * 100).toFixed(
              0,
            )}%). Refusing to overwrite.`,
          );
        }
      }
    }

    series[ind.key] = byOblast;
    indicatorsMeta[ind.key] = {
      titleEn: ind.titleEn,
      titleBg: ind.titleBg,
      unitLabelEn: ind.unitLabelEn,
      unitLabelBg: ind.unitLabelBg,
      sourceUrl: ind.sourceUrl,
      datasetCode: ind.dataset,
    };
    const oblastCount = Object.keys(byOblast).length;
    const totalN = totalPoints(byOblast);
    console.log(`${oblastCount} oblasts, ${totalN} points`);
  }

  // Derived: active enterprises per 1000 inhabitants — RP "Бизнес среда"
  // proxy. bd_size_r3 publishes the raw count of active enterprises (a
  // size-dominated absolute that just mirrors population on a choropleth),
  // so we normalise it against the population series fetched above. The
  // population indicator is in thousands, so count / population(ths) is
  // already the per-1000 density. NUTS3 business demography froze at 2020,
  // so this indicator ends earlier than the others (latest-available, per
  // RP convention).
  // bd_size_r3 is a discontinued/frozen NUTS3 dataset. If Eurostat ever
  // retires it (or narrows it below the floor) we degrade gracefully — skip
  // this one supplementary indicator rather than abort the whole regional
  // refresh, since GDP/population/migration/theft must still update. The
  // skipped key simply won't appear in regional.json (consumers iterate the
  // payload's keys, so nothing breaks); the warning surfaces in the run log.
  try {
    process.stdout.write(`Deriving enterpriseDensity (bd_size_r3 V11910)... `);
    const entCountNuts3 = await fetchEurostat({
      key: "enterpriseDensity",
      dataset: "bd_size_r3",
      query: {
        indic_sb: "V11910",
        sizeclas: "TOTAL",
        nace_r2: "B-S_X_K642",
        freq: "A",
      },
      titleEn: "Active enterprises per 1000 inhabitants",
      titleBg: "Активни предприятия на 1000 души",
      unitLabelEn: "per 1000 inhabitants",
      unitLabelBg: "на 1000 души",
      sourceUrl:
        "https://ec.europa.eu/eurostat/databrowser/view/bd_size_r3/default/table",
    });
    const entByOblast = projectToOblasts(entCountNuts3);
    const density: Record<string, RegionalPoint[]> = {};
    for (const [oblast, entSeries] of Object.entries(entByOblast)) {
      const popByYear = new Map(
        (series.population?.[oblast] ?? []).map((p) => [p.year, p.value]),
      );
      const pts: RegionalPoint[] = [];
      for (const e of entSeries) {
        const popThs = popByYear.get(e.year);
        if (popThs && popThs > 0) {
          pts.push({ year: e.year, value: round(e.value / popThs, 1) });
        }
      }
      if (pts.length > 0) density[oblast] = pts;
    }
    const weakestDensity = Object.values(density).reduce(
      (min, s) => Math.min(min, s.length),
      Infinity,
    );
    if (
      Object.keys(density).length < 20 ||
      weakestDensity < MIN_POINTS_PER_OBLAST
    ) {
      throw new Error(
        `enterpriseDensity covered ${Object.keys(density).length} oblasts, weakest ${weakestDensity} points (floor ${MIN_POINTS_PER_OBLAST})`,
      );
    }
    series.enterpriseDensity = density;
    indicatorsMeta.enterpriseDensity = {
      titleEn: "Active enterprises per 1000 inhabitants",
      titleBg: "Активни предприятия на 1000 души",
      unitLabelEn: "per 1000 inhabitants",
      unitLabelBg: "на 1000 души",
      sourceUrl:
        "https://ec.europa.eu/eurostat/databrowser/view/bd_size_r3/default/table",
      datasetCode: "bd_size_r3",
    };
    console.log(`${Object.keys(density).length} oblasts`);
  } catch (err) {
    console.warn(
      `\n  ! enterpriseDensity skipped — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const payload: RegionalPayload = {
    source: {
      name: "Eurostat",
      url: "https://ec.europa.eu/eurostat/databrowser/",
    },
    fetchedAt: new Date().toISOString(),
    country: "BG",
    indicators: indicatorsMeta,
    series,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload));
  console.log(`\nWrote ${OUT_FILE}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
