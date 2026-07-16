// Phase 3a — fetch Bulgarian RAIL RIDERSHIP from Eurostat (rail_pa_total) for the rail
// subsidy-dependency tile on /sector/transport: the denominator of "state subsidy per
// passenger". National rail passengers ≈ БДЖ (the dominant operator). Writes
// data/transport/rail_ridership.json. Mirrors scripts/macro/fetch_cofog.ts's fetch/decode.
//
//   THS_PAS  → thousand passengers carried
//   MIO_PKM  → million passenger-kilometres
//
// See docs/plans/transport-view-v1.md "Phase 3 scope". Wire into update-macro (or a
// eurostat_rail watcher). Run: npx tsx scripts/transport/fetch_rail_ridership.ts

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const OUT_DIR = path.join(ROOT, "data/transport");
const OUT_FILE = path.join(OUT_DIR, "rail_ridership.json");

const DATASET = "rail_pa_total";
const EUROSTAT_BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const SOURCE_URL =
  "https://ec.europa.eu/eurostat/databrowser/view/rail_pa_total/default/table";
const START_YEAR = 2011;

interface EurostatResponse {
  value: Record<string, number>;
  dimension: {
    unit: { category: { index: Record<string, number> } };
    time: { category: { index: Record<string, number> } };
  };
  size?: number[];
  id?: string[];
}

const fetchUnit = async (unit: string): Promise<EurostatResponse> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  params.append("geo", "BG");
  params.append("freq", "A");
  params.append("unit", unit);
  const url = `${DATASET}?${params.toString()}`;
  const res = await fetch(`${EUROSTAT_BASE}/${url}`);
  if (!res.ok) throw new Error(`Eurostat ${url} returned ${res.status}`);
  return (await res.json()) as EurostatResponse;
};

// geo is pinned to BG, so the only multi-valued dimension is time.
const decodeByYear = (json: EurostatResponse): Map<number, number> => {
  const dimOrder = json.id ?? ["freq", "unit", "geo", "time"];
  const sizes = json.size ?? [];
  const timeIdx = json.dimension.time.category.index;
  const yearByPos: string[] = [];
  for (const [label, idx] of Object.entries(timeIdx)) yearByPos[idx] = label;

  const strides: number[] = new Array(dimOrder.length).fill(1);
  for (let i = dimOrder.length - 2; i >= 0; i--)
    strides[i] = strides[i + 1] * (sizes[i + 1] ?? 1);
  const timeDim = dimOrder.indexOf("time");

  const out = new Map<number, number>();
  for (const [keyStr, value] of Object.entries(json.value)) {
    if (typeof value !== "number") continue;
    const key = Number(keyStr);
    const pos = Math.floor(key / strides[timeDim]) % (sizes[timeDim] ?? 1);
    const year = Number(yearByPos[pos]);
    if (Number.isFinite(year) && year >= START_YEAR) out.set(year, value);
  }
  return out;
};

const main = async (): Promise<void> => {
  console.log(`Fetching ${DATASET} (BG, THS_PAS + MIO_PKM)…`);
  const [pas, pkm] = await Promise.all([
    fetchUnit("THS_PAS").then(decodeByYear),
    fetchUnit("MIO_PKM").then(decodeByYear),
  ]);

  const yearsSet = new Set<number>([...pas.keys(), ...pkm.keys()]);
  const series = [...yearsSet]
    .sort((a, b) => a - b)
    .map((year) => ({
      year,
      // Passengers, absolute (THS_PAS is thousands → ×1000).
      passengers: pas.has(year)
        ? Math.round((pas.get(year) as number) * 1000)
        : null,
      passengerKmMio: pkm.get(year) ?? null,
    }));
  if (!series.length)
    throw new Error("Eurostat returned no rail ridership rows");

  const withPas = series.filter((s) => s.passengers != null);
  const latest = withPas[withPas.length - 1] ?? null;

  const payload = {
    source: {
      name: "Eurostat",
      dataset: DATASET,
      url: SOURCE_URL,
      note: "Национален железопътен транспорт (≈ БДЖ, доминиращият оператор). THS_PAS → пътници; MIO_PKM → пътнико-километри.",
    },
    fetchedAt: new Date().toISOString(),
    series,
    latest,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(
    `Wrote ${OUT_FILE} — ${series.length} years, latest ${latest?.year}: ` +
      `${latest?.passengers?.toLocaleString("en-US")} passengers`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
