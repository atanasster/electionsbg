/**
 * Полиция / МВР — road-safety outcome ingest (plan §7a #1, the cheapest and most
 * on-thesis outcome). Fetches Bulgaria's national road-traffic-death time series
 * from Eurostat `sdg_11_40` (Road traffic deaths, by type of roads; unit=NR,
 * tra_infr=TOTAL) → data/security/road_safety.json.
 *
 * This is the outcome the МВР traffic police (Пътна полиция / КАТ) and the patrol-
 * car procurement (Road-Safety-Fund financed) are meant to move — the accountability
 * pairing on /sector/security. National only (Eurostat carries no per-oblast road
 * fatalities for BG); pair it with МВР vehicle procurement, honestly framed
 * (correlation, not causation — many factors drive road safety).
 *
 * Usage: tsx scripts/security/fetch_road_safety.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/security/road_safety.json",
);

const DATASET = "sdg_11_40";
const API =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

interface EurostatJson {
  label: string;
  updated?: string;
  value: Record<string, number>;
  dimension: { time: { category: { index: Record<string, number> } } };
}

const main = async () => {
  const url = `${API}/${DATASET}?geo=BG&unit=NR&tra_infr=TOTAL&format=JSON&sinceTimePeriod=2011`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Eurostat ${DATASET} HTTP ${r.status}`);
  const j = (await r.json()) as EurostatJson;

  const idx = j.dimension.time.category.index;
  const series = Object.keys(idx)
    .sort()
    .map((year) => ({ year: Number(year), deaths: j.value[idx[year]] }))
    .filter((d) => d.deaths != null);

  if (series.length === 0) throw new Error("no road-death values parsed");

  const first = series[0];
  const last = series[series.length - 1];
  const peak = series.reduce(
    (m, d) => (d.deaths > m.deaths ? d : m),
    series[0],
  );

  const payload = {
    source: {
      name: "Eurostat",
      dataset: DATASET,
      label: j.label,
      unit: "number of deaths (all roads)",
      sourceUrl: `https://ec.europa.eu/eurostat/databrowser/view/${DATASET}/default/table`,
      eurostatUpdated: j.updated ?? null,
      fetchedAt: new Date().toISOString(),
    },
    series,
    // Precomputed headline facts (so the tile never recomputes provenance-sensitive numbers).
    latest: last,
    peak,
    changeSincePeakPct:
      peak.deaths > 0
        ? Math.round(((last.deaths - peak.deaths) / peak.deaths) * 100)
        : null,
    changeSinceFirstPct:
      first.deaths > 0
        ? Math.round(((last.deaths - first.deaths) / first.deaths) * 100)
        : null,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `wrote ${OUT_FILE} — ${series.length} yrs, ${first.year}=${first.deaths} → ${last.year}=${last.deaths} ` +
      `(peak ${peak.year}=${peak.deaths}, ${payload.changeSincePeakPct}% vs peak)`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
