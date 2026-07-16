/**
 * Fetch general-government expenditure by function (COFOG) for Bulgaria —
 * Eurostat gov_10a_exp, sector S13. Writes data/cofog.json. Consumed by the
 * budget functional-classification tile on /budget.
 *
 * COFOG-99 has ten top-level functions (GF01..GF10) covering everything from
 * Defence to Social protection. We pull annual MIO_NAC millions.
 *
 * UNIT HAZARD (fixed 2026-06): post-euro-changeover Eurostat RE-DENOMINATED BG's
 * whole gov_10a_exp series to EUR and now serves identical values under MIO_NAC
 * and MIO_EUR (verified against the live API: BG TOTAL 2024 = 41,059.6 under
 * both = €41.06B ≈ 40% of GDP — the correct figure). So the value is ALREADY in
 * euros — do NOT divide by 1.95583. An earlier ÷1.95583 here halved every BG
 * figure (e.g. social protection read €7.7B, below the €11.1B pension mass
 * alone). See [[reference-nsi-regional-access]] on the BG MNAC unit hazard.
 *
 * Usage:
 *   tsx scripts/macro/fetch_cofog.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

// EU-27 member states for peer-band ranking. Includes Bulgaria (1× our own
// value re-fetched here on PC_GDP grain) and the EU27_2020 aggregate so the
// tile chip can show the EU average alongside BG's rank.
const EU27_GEOS = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
] as const;
const EU_AGGREGATE_GEO = "EU27_2020" as const;

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
    geo?: { category: { index: Record<string, number> } };
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

// Same dataset, PC_GDP unit, fetched for all 27 member states + the EU27
// aggregate. We want absolute % of GDP so a country's size doesn't confound
// the peer-band comparison ("BG spends X% of GDP on education vs EU 4.7%").
// `lastTimePeriod=3` keeps the payload small — the latest year is what the
// chip surfaces; the trailing two years are kept as a fallback when the
// reporting calendar staggers (some countries lag others by a year).
const fetchCofogPeers = async (): Promise<EurostatResponse> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  for (const g of EU27_GEOS) params.append("geo", g);
  params.append("geo", EU_AGGREGATE_GEO);
  params.append("sector", "S13");
  params.append("na_item", "TE");
  params.append("freq", "A");
  params.append("unit", "PC_GDP");
  // Full time series (no lastTimePeriod clamp) so the EU compare dashboard
  // can pick a year matching the selected election cycle. Eurostat's
  // gov_10a_exp goes back to 2010 for most member states — ~14 years × 27
  // geos × 11 functions = ~4k data points, still negligible payload.
  const url = `${DATASET}?${params.toString()}`;
  const res = await fetch(`${EUROSTAT_BASE}/${url}`);
  if (!res.ok) {
    throw new Error(`Eurostat peers ${url} returned ${res.status}`);
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

// Decoder for the peer fetch — same JSON-stat shape but the `geo` dimension
// is now multi-valued, so we recover it alongside cofog + year.
const decodePeers = (
  json: EurostatResponse,
): { geo: string; cofog: string; year: number; value: number }[] => {
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
          : dim === "geo"
            ? (json.dimension.geo?.category.index ?? null)
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
  const out: { geo: string; cofog: string; year: number; value: number }[] = [];
  for (const [keyStr, value] of Object.entries(json.value)) {
    if (typeof value !== "number") continue;
    const key = Number(keyStr);
    let geo = "";
    let cofog = "";
    let year = 0;
    for (let i = 0; i < dimOrder.length; i++) {
      const dim = dimOrder[i];
      const coord = Math.floor(key / strides[i]) % (sizes[i] ?? 1);
      const label = labelByDim[dim]?.[coord];
      if (label === undefined) continue;
      if (dim === "geo") geo = label;
      else if (dim === "cofog99") cofog = label;
      else if (dim === "time") year = Number(label);
    }
    if (!geo || !cofog || !Number.isFinite(year)) continue;
    out.push({ geo, cofog, year, value });
  }
  return out;
};

// Per (cofog code) build the latest-year peer band:
//   bgPctGdp:   Bulgaria's spend as % of GDP
//   euAvgPctGdp: EU27 aggregate value
//   rank:       1 = highest spender among the 27 member states; 27 = lowest
//   total:      number of member states with a value at the chosen year
//   year:       the year these figures are pinned to
// Walks the peer rows back from `latestYear` to find a year where BG has
// data — Eurostat sometimes leaves BG blank for the most recent year while
// other countries have already reported.
interface PeerBand {
  year: number;
  bgPctGdp: number;
  euAvgPctGdp: number | null;
  rank: number;
  total: number;
  // The highest-spending member state at `year` (rank 1) — geo code + its
  // value as % of GDP. Lets a tile show "who is above Bulgaria". null when BG
  // is itself the top spender (no country ranks higher).
  top: { geo: string; pctGdp: number } | null;
}

// Per-peer composition at the latest year where BG and ≥20 EU members both
// report. Keyed first by peer geo (from the EU compare dashboard roster),
// then by COFOG code → % of GDP. Reuses the peer fetch payload — the same
// rows already carry the data for all 27 members, we just pick out the
// dashboard's six and pin to a single year.
type EuComparePeerGeo = "BG" | "EU27_2020" | "RO" | "GR" | "HU" | "HR";
const EU_COMPARE_GEOS: EuComparePeerGeo[] = [
  "BG",
  "EU27_2020",
  "RO",
  "GR",
  "HU",
  "HR",
];
const COFOG_FUNCTIONS_ONLY = [
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
  // GF0405 (Transport) — a GF04 sub-code, kept alongside the ten top-level
  // functions so the /sector/transport EU-peer tile can compare transport spend
  // as % of GDP. Additive: the /budget + /indicators/compare consumers read only
  // the ten top-levels and ignore this extra key. The peer fetch leaves the
  // cofog99 dimension open, so these rows are already in the payload.
  "GF0405",
] as const;
type CofogFunctionCode = (typeof COFOG_FUNCTIONS_ONLY)[number];

// COFOG sub-codes (beyond the ten top-levels) we also build a peer band for.
const PEER_EXTRA_CODES: readonly string[] = ["GF0405"];

// Build per-year, per-peer COFOG composition for the EU compare dashboard.
// Output shape: { [year]: { [geo]: { [code]: pctGdp } } }. Keeps every year
// the peer fetch returned so the dashboard can pick the year matching the
// selected election (or fall back to the latest year ≤ election year).
const buildPeerSeriesByYear = (
  rows: { geo: string; cofog: string; year: number; value: number }[],
): Record<
  string,
  Partial<Record<EuComparePeerGeo, Partial<Record<CofogFunctionCode, number>>>>
> => {
  const out: Record<
    string,
    Partial<
      Record<EuComparePeerGeo, Partial<Record<CofogFunctionCode, number>>>
    >
  > = {};
  for (const r of rows) {
    if (!(COFOG_FUNCTIONS_ONLY as readonly string[]).includes(r.cofog))
      continue;
    if (!(EU_COMPARE_GEOS as readonly string[]).includes(r.geo)) continue;
    const ykey = String(r.year);
    if (!out[ykey]) out[ykey] = {};
    const geo = r.geo as EuComparePeerGeo;
    const code = r.cofog as CofogFunctionCode;
    if (!out[ykey][geo]) out[ykey][geo] = {};
    out[ykey][geo]![code] = Math.round(r.value * 100) / 100;
  }
  return out;
};

const buildPeerBands = (
  rows: { geo: string; cofog: string; year: number; value: number }[],
): Record<string, PeerBand> => {
  // Group by (cofog, year, geo) → value
  type ByYear = Map<string, number>; // geo → value
  const byCofogYear = new Map<string, Map<number, ByYear>>();
  for (const r of rows) {
    if (!byCofogYear.has(r.cofog)) byCofogYear.set(r.cofog, new Map());
    const years = byCofogYear.get(r.cofog)!;
    if (!years.has(r.year)) years.set(r.year, new Map());
    years.get(r.year)!.set(r.geo, r.value);
  }
  const out: Record<string, PeerBand> = {};
  for (const [cofog, years] of byCofogYear) {
    if (
      !(COFOG_TOP_LEVEL as readonly string[]).includes(cofog) &&
      !PEER_EXTRA_CODES.includes(cofog)
    )
      continue;
    // Newest year first; pick the first one that has BG + at least 20
    // member-state observations.
    const candidates = [...years.keys()].sort((a, b) => b - a);
    for (const y of candidates) {
      const byGeo = years.get(y)!;
      const bg = byGeo.get("BG");
      if (bg == null) continue;
      const memberValues: number[] = [];
      let top: { geo: string; pctGdp: number } | null = null;
      for (const g of EU27_GEOS) {
        const v = byGeo.get(g);
        if (v != null) {
          memberValues.push(v);
          if (!top || v > top.pctGdp) top = { geo: g, pctGdp: v };
        }
      }
      if (memberValues.length < 20) continue;
      // Rank: 1 = highest spender as % of GDP, total = members with data.
      const higher = memberValues.filter((v) => v > bg).length;
      const rank = higher + 1;
      const euAvg = byGeo.get(EU_AGGREGATE_GEO) ?? null;
      out[cofog] = {
        year: y,
        bgPctGdp: bg,
        euAvgPctGdp: euAvg,
        rank,
        total: memberValues.length,
        // Drop `top` when BG is itself #1 (nobody spends more) — the tile then
        // has no "above Bulgaria" row to show.
        top: top && top.pctGdp > bg ? top : null,
      };
      break;
    }
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
    // Eurostat already serves BG in euros (re-denominated post-changeover; see
    // header) — the value is millions of EUR, so scale to units, do NOT convert.
    const eur = r.value * 1_000_000;
    if (!Number.isFinite(eur)) continue;
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

  console.log(`Fetching ${DATASET} peers (EU27 member states, PC_GDP)…`);
  const peerJson = await fetchCofogPeers();
  const peerRows = decodePeers(peerJson);
  const peers = buildPeerBands(peerRows);
  const peerCount = Object.keys(peers).length;
  if (peerCount < COFOG_TOP_LEVEL.length - 1) {
    console.warn(
      `⚠ peer bands missing for some codes — built ${peerCount}/${COFOG_TOP_LEVEL.length}`,
    );
  }

  // Per-peer composition for the EU compare dashboard — full multi-year
  // map so the dashboard can pick a year matching the selected election
  // cycle (or the latest year ≤ election year). `peerSeriesLatestYear`
  // remains a convenience for consumers that want the headline year
  // without picking a specific election.
  const peerSeriesByYear = buildPeerSeriesByYear(peerRows);
  const peerSeriesLatestYear = Math.max(
    ...Object.keys(peerSeriesByYear).map((y) => Number(y)),
    0,
  );

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
        unit: "MIO_NAC (already EUR — BG re-denominated post-changeover; no /1.95583)",
        sector: "S13",
        na_item: "TE",
        geo: "BG",
      },
      peerFilters: {
        unit: "PC_GDP",
        sector: "S13",
        na_item: "TE",
        geos: [...EU27_GEOS, EU_AGGREGATE_GEO],
      },
    },
    cofogTopLevel: COFOG_TOP_LEVEL,
    latestYear,
    series,
    // Per-code peer band: BG's % of GDP, EU27 average, rank among the 27
    // member states. Pinned to the latest year where BG and ≥20 peers both
    // report. Empty object if Eurostat hasn't refreshed in time.
    peers,
    // Per-peer composition (BG + EU27 + 4 CEE peers) across all available
    // years, for the EU compare dashboard side-by-side stacked bars. Keyed
    // by year-as-string so JSON serialisation is stable. Each year holds a
    // per-geo map of the 10 top-level COFOG functions as % of GDP.
    peerSeriesByYear,
    peerSeriesLatestYear,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  const peerYearCount = Object.keys(peerSeriesByYear).length;
  console.log(
    `Wrote ${OUT_FILE} — ${COFOG_TOP_LEVEL.length} codes, latest year ${latestYear}, peer bands for ${peerCount} codes, peerSeriesByYear: ${peerYearCount} years (latest ${peerSeriesLatestYear})`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
