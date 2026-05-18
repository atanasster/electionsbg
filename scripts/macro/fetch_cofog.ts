/**
 * Fetch general-government expenditure by function (COFOG) for Bulgaria —
 * Eurostat gov_10a_exp, sector S13. Writes data/cofog.json. Consumed by the
 * budget functional-classification tile on /budget.
 *
 * COFOG-99 has ten top-level functions (GF01..GF10) covering everything from
 * Defence to Social protection. We pull annual MIO_NAC (national-currency
 * millions = BGN historically) and convert to euros at the locked parity
 * 1 EUR = 1.95583 BGN — same convention as the rest of the budget pillar.
 *
 * Eurostat publishes a parallel MIO_EUR series for BG that uses the same
 * numeric values as MIO_NAC (Eurostat treats BG as if BGN ≡ EUR pre-changeover,
 * which is wrong). Hence MIO_NAC + manual conversion, not MIO_EUR.
 *
 * Usage:
 *   tsx scripts/macro/fetch_cofog.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { toEur } from "../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_FILE = path.resolve(__dirname, "../../data/cofog.json");

const EUROSTAT_BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

const DATASET = "gov_10a_exp";
const SOURCE_URL =
  "https://ec.europa.eu/eurostat/databrowser/view/gov_10a_exp/default/table";

const START_YEAR = 2010;

// Top-level COFOG-99 functions plus the rolled-up TOTAL the dataset emits.
// Sub-codes (GF0101 etc.) exist but are noisy at the dashboard level; the
// /budget tile only consumes top-level for the headline composition view.
const COFOG_TOP_LEVEL = [
  "GF01",
  "GF02",
  "GF03",
  "GF04",
  "GF05",
  "GF06",
  "GF07",
  "GF08",
  "GF09",
  "GF10",
  "TOTAL",
] as const;

type CofogCode = (typeof COFOG_TOP_LEVEL)[number];

type Point = { year: number; valueEur: number };

type EurostatResponse = {
  value: Record<string, number>;
  dimension: {
    cofog99: {
      category: {
        index: Record<string, number>;
        label: Record<string, string>;
      };
    };
    time: { category: { index: Record<string, number> } };
  };
  size?: number[];
  id?: string[];
};

const fetchCofog = async (): Promise<EurostatResponse> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  // Filter to general government (S13), total expenditure (TE), annual cadence,
  // national-currency millions. Cofog dimension stays open so we get all
  // sub-codes; we project to the ten top-levels client-side.
  params.append("geo", "BG");
  params.append("sector", "S13");
  params.append("na_item", "TE");
  params.append("freq", "A");
  params.append("unit", "MIO_NAC");
  const url = `${DATASET}?${params.toString()}`;
  const res = await fetch(`${EUROSTAT_BASE}/${url}`);
  if (!res.ok) {
    throw new Error(`Eurostat ${url} returned ${res.status}`);
  }
  return (await res.json()) as EurostatResponse;
};

// Walk the JSON-stat 2.0 indexed value map into {cofog, year, value} triples.
// Strides recover per-dim coordinates from the linearized key — same trick as
// fetch_eu_peers.ts but we only care about two dimensions (cofog × time);
// the others are pinned to a single value by our filters.
const decode = (
  json: EurostatResponse,
): { cofog: string; year: number; value: number }[] => {
  const dimOrder = json.id ?? [
    "freq",
    "unit",
    "sector",
    "cofog99",
    "na_item",
    "geo",
    "time",
  ];
  const sizes = json.size ?? [];
  const labelByDim: Record<string, string[]> = {};
  for (const dim of dimOrder) {
    const cat =
      dim === "cofog99"
        ? json.dimension.cofog99.category.index
        : dim === "time"
          ? json.dimension.time.category.index
          : null;
    if (!cat) continue;
    const arr: string[] = [];
    for (const [label, idx] of Object.entries(cat)) arr[idx] = label;
    labelByDim[dim] = arr;
  }

  const strides: number[] = new Array(dimOrder.length).fill(1);
  for (let i = dimOrder.length - 2; i >= 0; i--) {
    strides[i] = strides[i + 1] * (sizes[i + 1] ?? 1);
  }

  const out: { cofog: string; year: number; value: number }[] = [];
  for (const [keyStr, value] of Object.entries(json.value)) {
    if (typeof value !== "number") continue;
    const key = Number(keyStr);
    let cofog = "";
    let year = 0;
    for (let i = 0; i < dimOrder.length; i++) {
      const dim = dimOrder[i];
      const coord = Math.floor(key / strides[i]) % (sizes[i] ?? 1);
      const label = labelByDim[dim]?.[coord];
      if (label === undefined) continue;
      if (dim === "cofog99") cofog = label;
      else if (dim === "time") year = Number(label);
    }
    if (!cofog || !Number.isFinite(year)) continue;
    if (year < START_YEAR) continue;
    out.push({ cofog, year, value });
  }
  return out;
};

const main = async (): Promise<void> => {
  console.log(`Fetching ${DATASET} (BG, S13, TE, annual)…`);
  const json = await fetchCofog();
  const rows = decode(json);

  const series: Record<CofogCode, Point[]> = {} as Record<CofogCode, Point[]>;
  for (const c of COFOG_TOP_LEVEL) series[c] = [];

  for (const r of rows) {
    if (!(COFOG_TOP_LEVEL as readonly string[]).includes(r.cofog)) continue;
    // Eurostat reports millions of national currency. Convert to euros (units,
    // not millions) at the locked parity; the tile rescales for display.
    const eur = toEur(r.value * 1_000_000, "BGN");
    if (eur == null) continue;
    series[r.cofog as CofogCode].push({ year: r.year, valueEur: eur });
  }
  for (const c of COFOG_TOP_LEVEL) {
    series[c].sort((a, b) => a.year - b.year);
  }

  // Sanity: every top-level function should have at least 10 years of data
  // and the function totals should add up to TOTAL within 1% per year.
  for (const c of COFOG_TOP_LEVEL) {
    if (series[c].length < 10) {
      throw new Error(
        `Too few observations for ${c}: ${series[c].length} < 10`,
      );
    }
  }
  const tot = new Map<number, number>();
  for (const p of series.TOTAL) tot.set(p.year, p.valueEur);
  for (const [year, total] of tot) {
    const fnSum = (
      [
        "GF01",
        "GF02",
        "GF03",
        "GF04",
        "GF05",
        "GF06",
        "GF07",
        "GF08",
        "GF09",
        "GF10",
      ] as const
    ).reduce((acc, c) => {
      const pt = series[c].find((p) => p.year === year);
      return acc + (pt?.valueEur ?? 0);
    }, 0);
    if (total > 0) {
      const drift = Math.abs(fnSum - total) / total;
      if (drift > 0.01) {
        console.warn(
          `⚠ COFOG ${year}: GF01..GF10 sum (${(fnSum / 1e9).toFixed(2)}B) differs from TOTAL (${(total / 1e9).toFixed(2)}B) by ${(drift * 100).toFixed(1)}%`,
        );
      }
    }
  }

  const latestYear = Math.max(...series.TOTAL.map((p) => p.year));

  const payload = {
    fetchedAt: new Date().toISOString(),
    source: {
      name: "Eurostat",
      dataset: DATASET,
      url: SOURCE_URL,
      unit: "EUR",
      sector: "S13",
      filters: {
        freq: "A",
        unit: "MIO_NAC (converted to EUR at 1 EUR = 1.95583 BGN)",
        sector: "S13",
        na_item: "TE",
        geo: "BG",
      },
    },
    cofogTopLevel: COFOG_TOP_LEVEL,
    latestYear,
    series,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(
    `Wrote ${OUT_FILE} — ${COFOG_TOP_LEVEL.length} codes, latest year ${latestYear}`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
