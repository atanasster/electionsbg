/**
 * Household energy prices — Bulgaria vs the EU vs the neighbour peers — from
 * Eurostat, ALL taxes, EUR/kWh, bi-annual. Two datasets share this fetcher:
 *   • electricity → nrg_pc_204 (medium band 2500-4999 kWh) → data/energy/prices.json
 *   • natural gas → nrg_pc_202 (medium band 20-199 GJ)     → data/energy/gas_prices.json
 *
 *   npx tsx scripts/energy/fetch_prices.ts
 *
 * The story: BG has among the LOWEST household electricity AND gas prices in the
 * EU (~half the EU average) — the citizen-facing counterpoint to the state-energy
 * spending. (nrg_pc_205 is industrial electricity — add later if the
 * bill-decomposition tile grows.)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, "../../data/energy");
const API =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const FIRST_YEAR = 2007;

interface JsonStat {
  dimension: { time: { category: { index: Record<string, number> } } };
  value: Record<string, number>;
}
interface Point {
  period: string;
  value: number;
}

// The two household-energy datasets, each keyed by its Eurostat cube + the query
// selecting the medium consumption band, all-taxes, EUR/kWh.
interface Dataset {
  id: string;
  out: string;
  cube: string;
  query: string;
  source: string;
  sourceUrl: string;
}
const DATASETS: Dataset[] = [
  {
    id: "electricity",
    out: "prices.json",
    cube: "nrg_pc_204",
    query:
      "siec=E7000&nrg_cons=KWH2500-4999&unit=KWH&tax=I_TAX&currency=EUR&format=JSON&lang=EN",
    source:
      "Eurostat — nrg_pc_204 (household electricity, all taxes, 2500-4999 kWh)",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/nrg_pc_204/default/table",
  },
  {
    id: "gas",
    out: "gas_prices.json",
    cube: "nrg_pc_202",
    query:
      "siec=G3000&nrg_cons=GJ20-199&unit=KWH&tax=I_TAX&currency=EUR&format=JSON&lang=EN",
    source:
      "Eurostat — nrg_pc_202 (household natural gas, all taxes, 20-199 GJ)",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/nrg_pc_202/default/table",
  },
];

// Neighbour peers for the trend chart. Keyed by our canonical geo code, valued by
// the Eurostat geo (Greece is EL upstream, GR in our peer set). BG + EU27 stay
// separate (they anchor the KPI + `latest`); peers are best-effort (an upstream
// gap for one country must not fail the whole ingest).
const PEERS: { key: "RO" | "GR" | "HU" | "HR"; geo: string }[] = [
  { key: "RO", geo: "RO" },
  { key: "GR", geo: "EL" },
  { key: "HU", geo: "HU" },
  { key: "HR", geo: "HR" },
];

const fetchSeries = async (
  cube: string,
  query: string,
  geo: string,
): Promise<Point[]> => {
  const r = await fetch(`${API}/${cube}?geo=${geo}&${query}`);
  if (!r.ok)
    throw new Error(`Eurostat ${cube}/${geo} failed: HTTP ${r.status}`);
  const j = (await r.json()) as JsonStat;
  const idx = j.dimension?.time?.category?.index;
  if (!idx) throw new Error(`Eurostat ${cube}/${geo}: no time dimension`);
  return Object.entries(idx)
    .map(([period, i]) => ({ period, value: j.value[i] }))
    .filter(
      (p) => p.value != null && Number(p.period.slice(0, 4)) >= FIRST_YEAR,
    )
    .sort((a, b) => a.period.localeCompare(b.period));
};

const buildOne = async (ds: Dataset): Promise<void> => {
  console.log(`energy/${ds.id}: fetching ${ds.cube} (BG + EU27 + peers)…`);
  const [bg, eu] = await Promise.all([
    fetchSeries(ds.cube, ds.query, "BG"),
    fetchSeries(ds.cube, ds.query, "EU27_2020"),
  ]);
  if (bg.length < 10 || eu.length < 10)
    throw new Error(
      `energy/${ds.id}: thin series (BG ${bg.length}, EU ${eu.length}) — upstream query likely rejected`,
    );

  // Fetch peers concurrently but ASSEMBLE the series object in the fixed PEERS
  // order — Promise.all preserves input order in its result array, so iterating
  // it gives deterministic key order (inserting inside the async callbacks would
  // key the object by resolution order → non-reproducible JSON, noisy diffs).
  const fetched = await Promise.all(
    PEERS.map(
      async ({ key, geo }): Promise<{ key: string; s: Point[] | null }> => {
        try {
          const s = await fetchSeries(ds.cube, ds.query, geo);
          return { key, s: s.length ? s : null };
        } catch (e) {
          console.warn(
            `energy/${ds.id}: peer ${key} (${geo}) skipped — ${e instanceof Error ? e.message : e}`,
          );
          return { key, s: null };
        }
      },
    ),
  );
  const peerSeries: Record<string, Point[]> = {};
  for (const { key, s } of fetched) if (s) peerSeries[key] = s;

  // `latest` = the newest period present in BOTH series (EU27 aggregates can lag
  // BG), so consumers that compare BG vs EU never straddle two half-years.
  const euPeriods = new Set(eu.map((p) => p.period));
  const commonLatest =
    [...bg].reverse().find((p) => euPeriods.has(p.period))?.period ??
    bg[bg.length - 1].period;

  const out = {
    updated: process.env.INGEST_DATE ?? new Date().toISOString().slice(0, 10),
    source: ds.source,
    sourceUrl: ds.sourceUrl,
    unit: "EUR/kWh",
    latest: commonLatest,
    series: { BG: bg, EU27: eu, ...peerSeries },
  };
  const outPath = path.join(DIR, ds.out);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out) + "\n");

  const lb = bg[bg.length - 1];
  const le = eu[eu.length - 1];
  console.log(
    `energy/${ds.id}: BG ${bg.length} pts (${bg[0].period}–${lb.period}) → ${path.relative(process.cwd(), outPath)}`,
  );
  console.log(
    `  latest ${lb.period}: BG €${lb.value}/kWh vs EU27 €${le.value}/kWh (${Math.round((lb.value / le.value) * 100)}% of EU avg) · peers ${Object.keys(peerSeries).join("/")}`,
  );
};

const main = async (): Promise<void> => {
  for (const ds of DATASETS) await buildOne(ds);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
