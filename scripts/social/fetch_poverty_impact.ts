// Fetch the poverty-reduction-effect-of-social-transfers series for the social
// view's flagship outcome tile (docs/plans/social-assistance-view-v1.md §4.4/§4b).
//
// Two Eurostat SILC datasets, pinned to the standard 60%-of-median headline:
//   ilc_li10 — at-risk-of-poverty rate BEFORE social transfers (pensions EXCLUDED
//              from transfers, i.e. counted as income) → the "before" leg
//   ilc_li02 — at-risk-of-poverty rate AFTER all social transfers → the "after" leg
// Dimensions pinned: statinfo=MED_EI (median income), rskpovth=B_60 (below 60%),
// sex=T, age=TOTAL, unit=PC. One value per geo × year.
//
// The poverty-reduction effect = before − after (pp) and (before−after)/before (%).
// Bulgaria's ~27% is among the EU's weakest; that pairing is the tile's thesis.
//
// Output: a small STATIC data/social/poverty_impact.json (like data/cofog.json /
// road_safety.json — a reference series, no PG round-trip; plan §11). Run:
//   npx tsx scripts/social/fetch_poverty_impact.ts

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const EUROSTAT_BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

// Public ISO code ↔ Eurostat geo (Greece is EL in Eurostat, GR on the site).
type Geo = "BG" | "EU27_2020" | "RO" | "GR" | "HU" | "HR";
const GEOS: Geo[] = ["BG", "EU27_2020", "RO", "GR", "HU", "HR"];
const EUROSTAT_GEO = (g: Geo): string => (g === "GR" ? "EL" : g);
const FROM_EUROSTAT = (g: string): string => (g === "EL" ? "GR" : g);

const SINCE_YEAR = 2015;

interface JsonStat {
  value: Record<string, number>;
  id: string[];
  size: number[];
  dimension: Record<
    string,
    {
      category: {
        index: Record<string, number>;
        label?: Record<string, string>;
      };
    }
  >;
}

/** Flatten a jsonstat cube into {dims…, value} rows (only the cells present). */
const flatten = (j: JsonStat): Record<string, string | number>[] => {
  const dimOrder = j.id;
  const sizes = j.size;
  // Row-major strides (product of sizes to the right).
  const strides: number[] = new Array(dimOrder.length).fill(1);
  for (let i = dimOrder.length - 2; i >= 0; i--)
    strides[i] = strides[i + 1] * (sizes[i + 1] ?? 1);
  // coord → category code, per dimension.
  const codeByPos: Record<string, string[]> = {};
  for (const dim of dimOrder) {
    const idx = j.dimension[dim]?.category?.index ?? {};
    const arr: string[] = [];
    for (const [code, pos] of Object.entries(idx)) arr[pos] = code;
    codeByPos[dim] = arr;
  }
  const out: Record<string, string | number>[] = [];
  for (const [k, v] of Object.entries(j.value)) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const key = Number(k);
    const row: Record<string, string | number> = { value: v };
    for (let i = 0; i < dimOrder.length; i++) {
      const dim = dimOrder[i];
      const coord = Math.floor(key / strides[i]) % (sizes[i] ?? 1);
      const code = codeByPos[dim]?.[coord];
      if (code !== undefined) row[dim] = code;
    }
    out.push(row);
  }
  return out;
};

/** Fetch one SILC dataset pinned to the 60%-median headline, all geos, since 2015.
 *  Returns byGeo → sorted [{year, value}]. */
const fetchSilc = async (
  dataset: string,
): Promise<Record<string, { year: number; value: number }[]>> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  for (const g of GEOS) params.append("geo", EUROSTAT_GEO(g));
  params.append("statinfo", "MED_EI");
  params.append("rskpovth", "B_60");
  params.append("sex", "T");
  params.append("age", "TOTAL");
  params.append("unit", "PC");
  params.append("sinceTimePeriod", String(SINCE_YEAR));
  params.append("freq", "A");
  const url = `${EUROSTAT_BASE}/${dataset}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Eurostat ${dataset} returned ${res.status}`);
  const rows = flatten((await res.json()) as JsonStat);
  const byGeo: Record<string, { year: number; value: number }[]> = {};
  for (const r of rows) {
    const geo = FROM_EUROSTAT(String(r.geo));
    const year = Number(r.time);
    if (!Number.isFinite(year)) continue;
    (byGeo[geo] ??= []).push({ year, value: Number(r.value) });
  }
  for (const g of Object.keys(byGeo)) byGeo[g].sort((a, b) => a.year - b.year);
  return byGeo;
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

const main = async () => {
  console.log("Fetching ilc_li10 (before transfers) + ilc_li02 (after)…");
  const [before, after] = await Promise.all([
    fetchSilc("ilc_li10"),
    fetchSilc("ilc_li02"),
  ]);

  // Merge into per-geo {year, before, after} series (years where BOTH exist).
  const series: Record<
    string,
    { year: number; before: number; after: number }[]
  > = {};
  let latestYear = 0;
  for (const g of GEOS) {
    const b = new Map((before[g] ?? []).map((p) => [p.year, p.value]));
    const a = new Map((after[g] ?? []).map((p) => [p.year, p.value]));
    const years = [...b.keys()].filter((y) => a.has(y)).sort((x, y) => x - y);
    series[g] = years.map((year) => ({
      year,
      before: round1(b.get(year)!),
      after: round1(a.get(year)!),
    }));
    const last = years[years.length - 1];
    if (last && last > latestYear) latestYear = last;
  }

  // Latest-year summary per geo → the scatter (x from cofog GF10) + headline.
  const latest: Record<
    string,
    { year: number; before: number; after: number; pp: number; pct: number }
  > = {};
  for (const g of GEOS) {
    const pts = series[g];
    if (!pts.length) continue;
    // Prefer the shared latestYear; else the geo's own last point.
    const pt = pts.find((p) => p.year === latestYear) ?? pts[pts.length - 1];
    const pp = round1(pt.before - pt.after);
    const pct = pt.before > 0 ? round1(((pt.before - pt.after) / pt.before) * 100) : 0; // prettier-ignore
    latest[g] = { year: pt.year, before: pt.before, after: pt.after, pp, pct };
  }

  const out = {
    fetchedAt: new Date().toISOString(),
    source: {
      publisher: "Eurostat (EU-SILC)",
      datasets: {
        before: "ilc_li10 (AROP before social transfers, pensions excluded)",
        after: "ilc_li02 (AROP after social transfers)",
      },
      pins: { statinfo: "MED_EI", rskpovth: "B_60", sex: "T", age: "TOTAL", unit: "PC" }, // prettier-ignore
      urls: {
        before: "https://ec.europa.eu/eurostat/databrowser/view/ilc_li10/default/table", // prettier-ignore
        after: "https://ec.europa.eu/eurostat/databrowser/view/ilc_li02/default/table", // prettier-ignore
      },
    },
    geos: GEOS,
    latestYear,
    series,
    latest,
  };

  const outPath = resolve(
    dirname(new URL(import.meta.url).pathname),
    "../../data/social/poverty_impact.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  const bg = latest.BG;
  const eu = latest.EU27_2020;
  console.log(
    `Wrote ${outPath}\n  BG ${bg?.year}: ${bg?.before}% → ${bg?.after}% (−${bg?.pp}pp, ${bg?.pct}% reduction)` +
      `\n  EU ${eu?.year}: ${eu?.before}% → ${eu?.after}% (−${eu?.pp}pp, ${eu?.pct}% reduction)`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
