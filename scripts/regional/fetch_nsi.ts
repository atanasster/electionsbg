/**
 * NSI open-data (JSON-stat) merger → data/regional.json.
 *
 * Adds oblast-grain indicators that NSI publishes at NUTS3 grain via its
 * open-data API (http://www.nsi.bg/opendata/getopendata_json.php?id=N,
 * cataloged on data.egov.bg org_id 143) but that Eurostat only offers at
 * NUTS2 (6 BG regions) or not at all:
 *   - 629 Чуждестранни преки инвестиции (cumulative FDI stock, хил. евро)
 *   - 844 Музеи – посещения (museum visits, absolute)
 *
 * Both are raw oblast totals dominated by population size, so we normalise
 * them against the population series fetch_eurostat.ts already wrote.
 * Population is in thousands, so value / population(ths) yields the per-
 * capita (FDI, € per person) or per-1000 (museum visits) rate directly —
 * the same trick the enterpriseDensity derivation uses.
 *
 * The NSI "NUTS" dimension is keyed by the real Eurostat NUTS3 codes
 * (BG311, BG411, …), so we reuse EUROSTAT_NUTS3_TO_OBLAST — including the
 * Sofia BG411 → S23/S24/S25 fanout (a per-capita rate is identical across
 * the three city МИР) and Plovdiv BG421 → PDV/PDV-00.
 *
 * MUST run after fetch_eurostat.ts (needs the population series and merges
 * into the regional.json it writes). The update-regional skill runs the
 * chain: fetch_eurostat → fetch_az_oblast → fetch_nsi.
 *
 * Usage: npx tsx scripts/regional/fetch_nsi.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  fetchNsiJsonStat,
  extractJsonStat,
  type PinSpec,
} from "../lib/jsonstat";
import { EUROSTAT_NUTS3_TO_OBLAST } from "./oblast_map";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REGIONAL_FILE = path.resolve(__dirname, "../../data/regional.json");

type Point = { year: number; value: number };

// Two geo-keying conventions appear across NSI's regional open-data:
//   - "nuts3": geo dim keyed by real Eurostat NUTS3 codes (BG311, BG411…).
//   - "ekatteOblast": geo dim keyed by the app's own 3-letter oblast codes
//     (VID, VAR, … plus region-group rows BG3/BG4 to skip). Health uses this.
type GeoMode = "nuts3" | "ekatteOblast";

// EKATTE 3-letter oblast code → regional.json oblast code(s). Identity for
// the 25 plain oblasts; only Sofia-city and Plovdiv split (matching how the
// Eurostat fetcher fans BG411 → S23/S24/S25 and BG421 → PDV/PDV-00).
const EKATTE_OBLAST_TO_REGIONAL: Record<string, string[]> = {
  SOF: ["S23", "S24", "S25"], // София (столица)
  PDV: ["PDV", "PDV-00"], // Пловдив (rural МИР + city МИР)
};

/** Map a source geo key to regional oblast code(s), or null to skip it. */
const projectGeo = (geoKey: string, mode: GeoMode): string[] | null => {
  if (mode === "nuts3") return EUROSTAT_NUTS3_TO_OBLAST[geoKey] ?? null;
  // ekatteOblast: the 28 oblast codes are exactly the 3-letter all-caps keys
  // (VID, VAR, BGS, …). Country ("BG", 2 chars) and the NUTS1 region groups
  // ("BG3"/"BG4", letter+digit) fail the all-letter test, and NUTS2 regions
  // ("BG31"…) / municipalities (5-char) fail the length test — so this regex
  // alone is the correct oblast filter. NB: do NOT also drop startsWith("BG")
  // — that wrongly excludes BGS (Бургас).
  if (!/^[A-Z]{3}$/.test(geoKey)) return null;
  return EKATTE_OBLAST_TO_REGIONAL[geoKey] ?? [geoKey];
};

type NsiIndicator = {
  key: string;
  id: number;
  geoDim: string;
  geoMode: GeoMode;
  pins?: Record<string, PinSpec>;
  /** Rounding of the per-capita result: integer (EUR/person) or 1dp (rates). */
  decimals: number;
  titleEn: string;
  titleBg: string;
  unitLabelEn: string;
  unitLabelBg: string;
  sourceUrl: string;
  datasetCode: string;
  minOblasts: number;
};

const NSI_INDICATORS: NsiIndicator[] = [
  {
    key: "fdiPerCapita",
    id: 629,
    geoDim: "NUTS",
    geoMode: "nuts3",
    decimals: 0,
    titleEn: "Cumulative FDI per capita",
    titleBg: "ЧПИ с натрупване на човек",
    unitLabelEn: "EUR per inhabitant",
    unitLabelBg: "евро на човек",
    sourceUrl:
      "https://data.egov.bg/data/view/8ac81e48-5a0b-49ac-b982-770c7fd74b05",
    datasetCode: "nsi-629",
    minOblasts: 25,
  },
  {
    key: "museumVisitsPer1000",
    id: 844,
    geoDim: "NUTS",
    geoMode: "nuts3",
    pins: { Muz_Measure: "2" }, // 1=Музеи, 2=Посещения, 3=Експонати
    decimals: 0,
    titleEn: "Museum visits per 1000 inhabitants",
    titleBg: "Посещения в музеите на 1000 души",
    unitLabelEn: "per 1000 inhabitants",
    unitLabelBg: "на 1000 души",
    sourceUrl:
      "https://data.egov.bg/data/view/4c8e63d9-a5ba-42ec-bbcf-ef4ebb10cb66",
    datasetCode: "nsi-844",
    minOblasts: 25,
  },
  {
    // Hospital beds per 1000 — RP "Здравеопазване". Health services have an
    // oblast catchment (the oblast hospital serves the whole district), so
    // we use the EKATTE oblast aggregate, not municipality rows. Pin the
    // facility-type to hospital-care-total ("1") and the measure to beds.
    key: "hospitalBedsPer1000",
    id: 1206,
    geoDim: "EKATTE_Hlth",
    geoMode: "ekatteOblast",
    pins: { HlthEst_2011_2013: "1", HlthEst_measures: "Beds" },
    decimals: 1,
    titleEn: "Hospital beds per 1000 inhabitants",
    titleBg: "Болнични легла на 1000 души",
    unitLabelEn: "per 1000 inhabitants",
    unitLabelBg: "на 1000 души",
    sourceUrl:
      "https://data.egov.bg/data/view/0710b208-cd93-47ec-9f5e-69bc859dcd13",
    datasetCode: "nsi-1206",
    minOblasts: 25,
  },
];

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

const main = async () => {
  if (!fs.existsSync(REGIONAL_FILE)) {
    throw new Error(
      `${REGIONAL_FILE} not found — run scripts/regional/fetch_eurostat.ts first.`,
    );
  }
  const regional = JSON.parse(fs.readFileSync(REGIONAL_FILE, "utf8"));

  // Population (thousands) per oblast/year — the per-capita denominator.
  const popSeries = (regional.series?.population ?? {}) as Record<
    string,
    Point[]
  >;
  const popByOblastYear = new Map<string, Map<number, number>>();
  for (const [code, pts] of Object.entries(popSeries)) {
    popByOblastYear.set(code, new Map(pts.map((p) => [p.year, p.value])));
  }
  if (popByOblastYear.size === 0) {
    throw new Error(
      "regional.json carries no population series — re-run fetch_eurostat.ts before merging NSI.",
    );
  }

  for (const ind of NSI_INDICATORS) {
    process.stdout.write(`Fetching NSI ${ind.key} (id=${ind.id})... `);
    const ds = await fetchNsiJsonStat(ind.id);
    const { series: byNuts, latestYear } = extractJsonStat(
      ds,
      ind.geoDim,
      ind.pins ?? {},
    );

    // Project source geo → oblast code(s), dividing by population to normalise.
    const out: Record<string, Point[]> = {};
    for (const [geoKey, perYear] of byNuts) {
      const codes = projectGeo(geoKey, ind.geoMode);
      if (!codes) continue; // skip aggregates (BG, BG31, region groups, …)
      for (const code of codes) {
        const pop = popByOblastYear.get(code);
        if (!pop) continue;
        const pts: Point[] = [];
        for (const [year, value] of perYear) {
          const popThs = pop.get(year);
          if (popThs && popThs > 0) {
            pts.push({ year, value: round(value / popThs, ind.decimals) });
          }
        }
        if (pts.length > 0) {
          pts.sort((a, b) => a.year - b.year);
          out[code] = pts;
        }
      }
    }

    const oblastCount = Object.keys(out).length;
    if (oblastCount < ind.minOblasts) {
      throw new Error(
        `safety check: ${ind.key} covered ${oblastCount} oblasts (floor ${ind.minOblasts}). Upstream id=${ind.id} likely changed.`,
      );
    }

    regional.indicators[ind.key] = {
      titleEn: ind.titleEn,
      titleBg: ind.titleBg,
      unitLabelEn: ind.unitLabelEn,
      unitLabelBg: ind.unitLabelBg,
      sourceUrl: ind.sourceUrl,
      datasetCode: ind.datasetCode,
    };
    regional.series[ind.key] = out;
    console.log(`${oblastCount} oblasts, latest source year ${latestYear}`);
  }

  regional.fetchedAt = new Date().toISOString();
  fs.writeFileSync(REGIONAL_FILE, JSON.stringify(regional));
  console.log(
    `Merged ${NSI_INDICATORS.length} NSI indicators into ${REGIONAL_FILE}`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
