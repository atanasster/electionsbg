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
import { fileURLToPath, pathToFileURL } from "url";

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

// Indicator keys this script derives rather than fetching from a listed
// dataset. Own keys, so they are never carried forward — see OWN_INDICATORS.
const DERIVED_INDICATORS = ["enterpriseDensity"] as const;

/**
 * Every indicator key THIS writer produces. Anything else found in the prior
 * `data/regional.json` belongs to another script and is carried across the
 * rewrite (see readForeignIndicators).
 *
 * Membership here is what makes a skipped own indicator stay skipped. The
 * `enterpriseDensity` degrade path deliberately omits its key when Eurostat
 * narrows or retires bd_size_r3; a blind "keep unknown keys" carry-forward
 * would resurrect the previous vintage instead, turning a designed, visible
 * degradation into a silently stale series.
 */
export const OWN_INDICATORS: readonly string[] = [
  ...INDICATORS.map((i) => i.key),
  ...DERIVED_INDICATORS,
];

/**
 * Indicator keys other scripts merge into `data/regional.json`, and the script
 * that owns each. This writer replaces the file wholesale, so anything it does
 * not carry across is destroyed on every run.
 *
 * That is not hypothetical — observed 2026-08-11: running this script alone
 * dropped all five of these from both the `indicators` and the `series` block,
 * with a valid file, a green run and no warning. Half the oblast indicators
 * `/governance/region/:oblast` renders simply vanished until the two mergers
 * were re-run. A sentence in SKILL.md telling the operator to re-run them
 * afterwards is not a defence; this is. Same shape, and the same fix, as
 * FOREIGN_BLOCKS in scripts/macro/fetch_eu_peers.ts.
 *
 * An undeclared foreign key is still carried (losing a new writer's data is
 * worse than an out-of-date list), but it is reported so the list can catch
 * up; `regional_foreign_indicators.test.ts` fails when the committed artifact
 * carries one.
 */
export const FOREIGN_INDICATORS: Record<string, string> = {
  fdiPerCapita: "scripts/regional/fetch_nsi.ts",
  museumVisitsPer1000: "scripts/regional/fetch_nsi.ts",
  hospitalBedsPer1000: "scripts/regional/fetch_nsi.ts",
  deathRatePer1000: "scripts/regional/fetch_nsi.ts",
  ltUnemployment: "scripts/regional/fetch_az_oblast.ts",
};

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

const readPrior = (file: string = OUT_FILE): RegionalPayload | null => {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as RegionalPayload;
  } catch {
    return null;
  }
};

export type CarriedIndicators = {
  /** Foreign entries from the prior file's `indicators` block. */
  indicators: RegionalPayload["indicators"];
  /** Foreign entries from the prior file's `series` block. */
  series: RegionalPayload["series"];
  /** Every foreign key found, sorted — what the run log reports as carried. */
  keys: string[];
  /** Foreign keys absent from FOREIGN_INDICATORS. Carried, but reported. */
  undeclared: string[];
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The indicator keys in the committed file that this writer does not own, with
 * their `indicators` metadata and `series` data, ready to be merged back into
 * the fresh payload. A missing file or unreadable JSON yields nothing to carry
 * — a first-ever run on a clean machine legitimately has none, and a truncated
 * file must not abort the whole regional refresh.
 */
export const readForeignIndicators = (
  file: string = OUT_FILE,
): CarriedIndicators => {
  const carried: CarriedIndicators = {
    indicators: {},
    series: {},
    keys: [],
    undeclared: [],
  };
  const prior = readPrior(file);
  if (!prior) return carried;

  const priorIndicators = isObject(prior.indicators) ? prior.indicators : {};
  const priorSeries = isObject(prior.series) ? prior.series : {};

  // Union of both blocks: a half-written prior file may carry a key in one and
  // not the other, and dropping the orphan half would compound the loss.
  const foreignKeys = [
    ...new Set([...Object.keys(priorIndicators), ...Object.keys(priorSeries)]),
  ]
    .filter((k) => !OWN_INDICATORS.includes(k))
    .sort();

  for (const key of foreignKeys) {
    if (isObject(priorIndicators[key])) {
      carried.indicators[key] = priorIndicators[key];
    }
    if (isObject(priorSeries[key])) carried.series[key] = priorSeries[key];
  }
  carried.keys = foreignKeys;
  carried.undeclared = foreignKeys.filter((k) => !(k in FOREIGN_INDICATORS));
  return carried;
};

/**
 * Merge carried foreign indicators into a freshly fetched payload. The fresh
 * payload always wins on a key collision — a carried entry is last run's
 * vintage by definition, so it may only ever fill a gap, never overwrite.
 */
export const withCarriedIndicators = (
  payload: RegionalPayload,
  carried: CarriedIndicators,
): RegionalPayload => {
  const indicators = { ...payload.indicators };
  const series = { ...payload.series };
  for (const [key, meta] of Object.entries(carried.indicators)) {
    if (!(key in indicators)) indicators[key] = meta;
  }
  for (const [key, s] of Object.entries(carried.series)) {
    if (!(key in series)) series[key] = s;
  }
  return { ...payload, indicators, series };
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

  // Read BEFORE the write, since the write is what would destroy them.
  const carried = readForeignIndicators();

  const payload = withCarriedIndicators(
    {
      source: {
        name: "Eurostat",
        url: "https://ec.europa.eu/eurostat/databrowser/",
      },
      fetchedAt: new Date().toISOString(),
      country: "BG",
      indicators: indicatorsMeta,
      series,
    },
    carried,
  );

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload));
  console.log(`\nWrote ${OUT_FILE}`);

  // Say which foreign indicators survived, and — more importantly — which did
  // not. A key listed in FOREIGN_INDICATORS but absent from the prior file is
  // either a first-ever run or a key that was already lost, and those two must
  // not look the same as a clean carry-forward.
  if (carried.keys.length) {
    console.log(
      `carried forward from other writers: ${carried.keys.join(", ")}`,
    );
  }
  const missing = Object.keys(FOREIGN_INDICATORS).filter(
    (k) => !carried.keys.includes(k),
  );
  if (missing.length) {
    console.warn(
      `NOTE: ${missing.join(", ")} not present in the previous ` +
        `${path.basename(OUT_FILE)} — nothing to carry. If this is not a first ` +
        `run, re-run the script that owns it (` +
        `${[...new Set(missing.map((k) => FOREIGN_INDICATORS[k]))].join(", ")}).`,
    );
  }
  if (carried.undeclared.length) {
    console.warn(
      `NOTE: carried undeclared foreign indicator(s) ` +
        `${carried.undeclared.join(", ")} — add them to FOREIGN_INDICATORS in ` +
        `${path.basename(__filename)} so the run log can name their owner.`,
    );
  }
};

// Run only when invoked as the entry point. Without this guard, `import`ing
// anything from this module — as regional_foreign_indicators.test.ts does for
// readForeignIndicators / withCarriedIndicators — fires the whole Eurostat
// fetch and a rewrite of data/regional.json racing the very test that reads
// it. Same guard shape as scripts/macro/fetch_eu_peers.ts.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
