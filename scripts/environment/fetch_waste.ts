/**
 * Fetch municipal-waste outcome indicators for Bulgaria + EU peers and write
 * data/environment/waste.json — the data behind the /sector/environment
 * „Рециклиране спрямо целта на ЕС" tile (§5 tile 6 of the environment plan).
 *
 *   Eurostat cei_wm011 — Recycling rate of municipal waste (%, wst_oper=RCY)
 *   Eurostat env_wasmun — Municipal waste generated per capita (kg, wst_oper=GEN)
 *
 * The tile pairs BG's recycling-rate trend against the two hard EU targets
 * (55% by 2025, 65% by 2035, Waste Framework Directive 2018/851) — BG sits far
 * below. Tiny annual JSON (a handful of geos × ~25 years), fetched client-side
 * with staleTime:Infinity, same class as data/cofog.json.
 *
 * Usage:
 *   tsx scripts/environment/fetch_waste.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(__dirname, "../../data/environment/waste.json");

const EUROSTAT_BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

// BG first (the subject), then the EU aggregate + the three peers the app's
// other EU-peer tiles use (RO/HR/HU) so the comparison bar stays consistent.
const GEOS = ["BG", "EU27_2020", "RO", "HR", "HU"] as const;
const START_YEAR = 2010;

// Hard targets from the Waste Framework Directive (2018/851): 55% of municipal
// waste prepared for re-use / recycled by 2025, 60% by 2030, 65% by 2035.
const TARGETS = { y2025: 55, y2030: 60, y2035: 65 };

type Point = { year: number; value: number };

interface JsonStat {
  id: string[];
  dimension: Record<string, { category: { index: Record<string, number> } }>;
  value: Record<string, number> | number[];
  size: number[];
}

const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

// Walk a JSON-stat 2.0 response over its geo × time grid (all other dims are
// pinned to a single value by the query, so their index is always 0). Returns
// { geo: [{year,value}] }. Mirrors the fetch_cofog peer parser.
const parseGeoTime = (j: JsonStat): Record<string, Point[]> => {
  const geoIdx = j.dimension.geo.category.index;
  const timeIdx = j.dimension.time.category.index;
  const nTime = j.size[j.id.indexOf("time")];
  const values = j.value;
  const at = (i: number): number | undefined => {
    const v = Array.isArray(values) ? values[i] : values[String(i)];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  const out: Record<string, Point[]> = {};
  for (const [geo, gi] of Object.entries(geoIdx)) {
    const series: Point[] = [];
    for (const [yearKey, ti] of Object.entries(timeIdx)) {
      const year = Number(yearKey);
      if (!Number.isInteger(year) || year < START_YEAR) continue;
      // Flat index = geo * nTime + time (geo is the outer of the two open dims;
      // every other dimension has cardinality 1 so contributes 0).
      const v = at(gi * nTime + ti);
      if (v === undefined) continue;
      series.push({ year, value: round(v, 1) });
    }
    series.sort((a, b) => a.year - b.year);
    if (series.length) out[geo] = series;
  }
  return out;
};

const fetchDataset = async (
  dataset: string,
  extra: Record<string, string>,
): Promise<Record<string, Point[]>> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN", freq: "A" });
  for (const g of GEOS) params.append("geo", g);
  for (const [k, v] of Object.entries(extra)) params.append(k, v);
  const url = `${EUROSTAT_BASE}/${dataset}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`Eurostat ${dataset} returned ${res.status} for ${url}`);
  const json = (await res.json()) as JsonStat;
  return parseGeoTime(json);
};

// Protected-area coverage (env_bio4, terrestrial areas, % of land). Fetched PER GEO
// because env_bio4's dimension order puts geo LAST (time before geo), which the flat
// geo×time parser above (built for the geo-before-time waste datasets) can't index —
// single-geo requests sidestep it. Returns the latest value per geo. BG is among the
// EU's highest (a positive counterpoint to the recycling story).
const fetchProtectedAreaLatest = async (): Promise<{
  latestYear: number | null;
  byGeo: Record<string, number>;
}> => {
  const byGeo: Record<string, number> = {};
  let latestYear: number | null = null;
  for (const g of GEOS) {
    const params = new URLSearchParams({
      format: "JSON",
      lang: "EN",
      freq: "A",
      areaprot: "TPA",
      unit: "PC",
      geo: g,
    });
    const res = await fetch(`${EUROSTAT_BASE}/env_bio4?${params.toString()}`);
    if (!res.ok) continue;
    const j = (await res.json()) as JsonStat;
    const ti = j.dimension.time.category.index;
    const v = j.value;
    const at = (i: number): number | undefined => {
      const x = Array.isArray(v) ? v[i] : v[String(i)];
      return typeof x === "number" && Number.isFinite(x) ? x : undefined;
    };
    const entries = Object.entries(ti)
      .map(([y, i]) => [Number(y), i] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let k = entries.length - 1; k >= 0; k--) {
      const val = at(entries[k][1]);
      if (val !== undefined) {
        byGeo[g] = round(val, 1);
        latestYear = Math.max(latestYear ?? 0, entries[k][0]);
        break;
      }
    }
  }
  return { latestYear, byGeo };
};

const main = async () => {
  process.stdout.write("Loading cei_wm011 (recycling rate)... ");
  const recyclingRate = await fetchDataset("cei_wm011", {
    wst_oper: "RCY",
    unit: "PC",
  });
  const bgRcy = recyclingRate.BG ?? [];
  console.log(
    `${Object.keys(recyclingRate).length} geos, BG latest ${bgRcy.length ? `${bgRcy[bgRcy.length - 1].year}: ${bgRcy[bgRcy.length - 1].value}%` : "—"}`,
  );

  process.stdout.write("Loading env_wasmun (waste per capita)... ");
  const wastePerCapita = await fetchDataset("env_wasmun", {
    wst_oper: "GEN",
    unit: "KG_HAB",
  });
  const bgGen = wastePerCapita.BG ?? [];
  console.log(
    `${Object.keys(wastePerCapita).length} geos, BG latest ${bgGen.length ? `${bgGen[bgGen.length - 1].year}: ${bgGen[bgGen.length - 1].value} kg` : "—"}`,
  );

  process.stdout.write("Loading env_bio4 (protected areas)... ");
  const protectedArea = await fetchProtectedAreaLatest();
  console.log(
    `BG ${protectedArea.byGeo.BG ?? "—"}% of land (latest ${protectedArea.latestYear ?? "—"})`,
  );

  if ((recyclingRate.BG?.length ?? 0) < 5)
    throw new Error(
      "safety: cei_wm011 BG series too short — upstream query likely broke",
    );

  const payload = {
    source:
      "Eurostat cei_wm011 (recycling rate of municipal waste) + env_wasmun (municipal waste generated per capita) + env_bio4 (terrestrial protected areas)",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/cei_wm011/default/table",
    fetchedAt: new Date().toISOString(),
    // Waste Framework Directive 2018/851 preparing-for-reuse/recycling targets.
    targets: TARGETS,
    recyclingRate: { unit: "%", byGeo: recyclingRate },
    wastePerCapita: { unit: "kg/capita", byGeo: wastePerCapita },
    // Terrestrial protected areas as % of land (Natura 2000 + national designations).
    protectedArea: {
      unit: "%",
      latestYear: protectedArea.latestYear,
      byGeo: protectedArea.byGeo,
      source: "Eurostat env_bio4 (terrestrial protected areas, % of land)",
    },
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload));
  console.log(`\nWrote ${OUT_FILE}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
