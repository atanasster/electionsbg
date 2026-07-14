/**
 * Household electricity price — Bulgaria vs the EU — from Eurostat nrg_pc_204
 * (household consumers, medium band 2500-4999 kWh, ALL taxes, EUR/kWh, bi-annual).
 * Writes data/energy/prices.json for the /sector/energy "what you pay" tile.
 *
 *   npx tsx scripts/energy/fetch_prices.ts
 *
 * The story: BG has among the LOWEST household electricity prices in the EU
 * (~half the EU average) — the citizen-facing counterpoint to the €9.76bn of
 * state-energy spending. (nrg_pc_205 is industrial electricity; gas household is
 * nrg_pc_202 — add later if the bill-decomposition tile grows.)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../data/energy/prices.json");
const BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_pc_204";
const QUERY =
  "siec=E7000&nrg_cons=KWH2500-4999&unit=KWH&tax=I_TAX&currency=EUR&format=JSON&lang=EN";
const FIRST_YEAR = 2007;

interface JsonStat {
  dimension: { time: { category: { index: Record<string, number> } } };
  value: Record<string, number>;
}
interface Point {
  period: string;
  value: number;
}

const fetchSeries = async (geo: string): Promise<Point[]> => {
  const r = await fetch(`${BASE}?geo=${geo}&${QUERY}`);
  if (!r.ok) throw new Error(`Eurostat ${geo} failed: HTTP ${r.status}`);
  const j = (await r.json()) as JsonStat;
  const idx = j.dimension?.time?.category?.index;
  if (!idx) throw new Error(`Eurostat ${geo}: no time dimension`);
  return Object.entries(idx)
    .map(([period, i]) => ({ period, value: j.value[i] }))
    .filter(
      (p) => p.value != null && Number(p.period.slice(0, 4)) >= FIRST_YEAR,
    )
    .sort((a, b) => a.period.localeCompare(b.period));
};

const main = async (): Promise<void> => {
  console.log("energy/prices: fetching Eurostat nrg_pc_204 (BG + EU27)…");
  const [bg, eu] = await Promise.all([
    fetchSeries("BG"),
    fetchSeries("EU27_2020"),
  ]);
  if (bg.length < 10 || eu.length < 10)
    throw new Error(
      `energy/prices: thin series (BG ${bg.length}, EU ${eu.length}) — upstream query likely rejected`,
    );

  // `latest` = the newest period present in BOTH series (EU27 aggregates can lag
  // BG), so consumers that compare BG vs EU never straddle two half-years.
  const euPeriods = new Set(eu.map((p) => p.period));
  const commonLatest =
    [...bg].reverse().find((p) => euPeriods.has(p.period))?.period ??
    bg[bg.length - 1].period;

  const out = {
    updated: process.env.INGEST_DATE ?? new Date().toISOString().slice(0, 10),
    source:
      "Eurostat — nrg_pc_204 (household electricity, all taxes, 2500-4999 kWh)",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/nrg_pc_204/default/table",
    unit: "EUR/kWh",
    latest: commonLatest,
    series: { BG: bg, EU27: eu },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + "\n");

  const lb = bg[bg.length - 1];
  const le = eu[eu.length - 1];
  console.log(
    `energy/prices: BG ${bg.length} pts (${bg[0].period}–${lb.period}) → ${path.relative(process.cwd(), OUT)}`,
  );
  console.log(
    `  latest ${lb.period}: BG €${lb.value}/kWh vs EU27 €${le.value}/kWh (${Math.round((lb.value / le.value) * 100)}% of EU avg)`,
  );
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
