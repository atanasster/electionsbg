/**
 * Fetch general-government revenue, expenditure, and balance (% of GDP) for
 * Bulgaria, the EU27 average, and three CEE peers — Romania, Hungary, Poland.
 * Writes data/macro_peers.json. Consumed by the budget peer-comparison tile.
 *
 * Source: Eurostat gov_10a_main (annual, sector S13 = general government).
 *
 * Usage:
 *   tsx scripts/macro/fetch_eu_peers.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_FILE = path.resolve(__dirname, "../../data/macro_peers.json");

const EUROSTAT_BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

const DATASET = "gov_10a_main";
const SOURCE_URL =
  "https://ec.europa.eu/eurostat/databrowser/view/gov_10a_main/default/table";

const START_YEAR = 2010;

const GEOS = ["BG", "EU27_2020", "RO", "HU", "PL"] as const;
const NA_ITEMS = ["TR", "TE", "B9"] as const;

// All 27 member states for the peer-band distribution that powers the
// budget-screen headline-card chips. Larger query than the 5-country series
// view; we fetch only the most recent year via `lastTimePeriod=2` to keep
// the payload bounded.
const EU27_MEMBERS = [
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

type Geo = (typeof GEOS)[number];
type NaItem = (typeof NA_ITEMS)[number];

type Point = { year: number; value: number };

type EurostatResponse = {
  value: Record<string, number>;
  dimension: {
    geo: { category: { index: Record<string, number> } };
    na_item: { category: { index: Record<string, number> } };
    time: { category: { index: Record<string, number> } };
  };
  size?: number[];
  id?: string[];
};

const round = (x: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

const fetchPeers = async (): Promise<EurostatResponse> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  for (const g of GEOS) params.append("geo", g);
  for (const n of NA_ITEMS) params.append("na_item", n);
  params.append("unit", "PC_GDP");
  params.append("sector", "S13");
  params.append("freq", "A");
  const url = `${DATASET}?${params.toString()}`;
  const res = await fetch(`${EUROSTAT_BASE}/${url}`);
  if (!res.ok) {
    throw new Error(`Eurostat ${url} returned ${res.status}`);
  }
  return (await res.json()) as EurostatResponse;
};

// Same dataset, all 27 member states + EU27 aggregate, latest few years only.
// Powers the peer-band chip on each /budget headline card (BG vs EU27 average
// + rank within the 27). The 5-country `series` above stays the source of
// the multi-year sparklines on the governance peer-comparison tile.
const fetchDistribution = async (): Promise<EurostatResponse> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  for (const g of EU27_MEMBERS) params.append("geo", g);
  params.append("geo", "EU27_2020");
  for (const n of NA_ITEMS) params.append("na_item", n);
  params.append("unit", "PC_GDP");
  params.append("sector", "S13");
  params.append("freq", "A");
  params.append("lastTimePeriod", "3");
  const url = `${DATASET}?${params.toString()}`;
  const res = await fetch(`${EUROSTAT_BASE}/${url}`);
  if (!res.ok) {
    throw new Error(`Eurostat distribution ${url} returned ${res.status}`);
  }
  return (await res.json()) as EurostatResponse;
};

// Walk the JSON-stat 2.0 indexed value map into {geo, na_item, year, value}
// triples. JSON-stat encodes a multi-dim array as a flat dict keyed by the
// linearized index — recover the per-dim coordinates from the size vector.
const decode = (
  json: EurostatResponse,
): { geo: string; naItem: string; year: number; value: number }[] => {
  const dimOrder = json.id ?? [
    "freq",
    "unit",
    "sector",
    "na_item",
    "geo",
    "time",
  ];
  const sizes = json.size ?? [];
  const indexByDim: Record<string, Record<string, number>> = {};
  const labelByDim: Record<string, string[]> = {};
  for (const dim of dimOrder) {
    const cat =
      dim === "geo"
        ? json.dimension.geo.category.index
        : dim === "na_item"
          ? json.dimension.na_item.category.index
          : dim === "time"
            ? json.dimension.time.category.index
            : null;
    if (!cat) continue;
    indexByDim[dim] = cat;
    const arr: string[] = [];
    for (const [label, idx] of Object.entries(cat)) arr[idx] = label;
    labelByDim[dim] = arr;
  }

  const strides: number[] = new Array(dimOrder.length).fill(1);
  for (let i = dimOrder.length - 2; i >= 0; i--) {
    strides[i] = strides[i + 1] * (sizes[i + 1] ?? 1);
  }

  const out: { geo: string; naItem: string; year: number; value: number }[] =
    [];
  for (const [keyStr, value] of Object.entries(json.value)) {
    if (typeof value !== "number") continue;
    const key = Number(keyStr);
    let geo = "";
    let naItem = "";
    let year = 0;
    for (let i = 0; i < dimOrder.length; i++) {
      const dim = dimOrder[i];
      const coord = Math.floor(key / strides[i]) % (sizes[i] ?? 1);
      const label = labelByDim[dim]?.[coord];
      if (label === undefined) continue;
      if (dim === "geo") geo = label;
      else if (dim === "na_item") naItem = label;
      else if (dim === "time") year = Number(label);
    }
    if (!geo || !naItem || !Number.isFinite(year)) continue;
    if (year < START_YEAR) continue;
    out.push({ geo, naItem, year, value });
  }
  return out;
};

// Per-naItem peer band built from the 27-member distribution. `rank=1` is the
// highest value (highest revenue / highest expenditure / highest balance); a
// surplus country ranks 1 for B9. The chip turns this into "above/below EU
// average · rank N/27" copy on the headline cards.
interface PeerBand {
  year: number;
  bgPctGdp: number;
  euAvgPctGdp: number | null;
  rank: number;
  total: number;
}

const buildDistribution = (
  rows: { geo: string; naItem: string; year: number; value: number }[],
): Partial<Record<NaItem, PeerBand>> => {
  type ByYear = Map<string, number>;
  const byNaYear = new Map<NaItem, Map<number, ByYear>>();
  for (const r of rows) {
    if (!(NA_ITEMS as readonly string[]).includes(r.naItem)) continue;
    const key = r.naItem as NaItem;
    if (!byNaYear.has(key)) byNaYear.set(key, new Map());
    const years = byNaYear.get(key)!;
    if (!years.has(r.year)) years.set(r.year, new Map());
    years.get(r.year)!.set(r.geo, r.value);
  }
  const out: Partial<Record<NaItem, PeerBand>> = {};
  for (const [naItem, years] of byNaYear) {
    const candidates = [...years.keys()].sort((a, b) => b - a);
    for (const y of candidates) {
      const byGeo = years.get(y)!;
      const bg = byGeo.get("BG");
      if (bg == null) continue;
      const memberValues: number[] = [];
      for (const g of EU27_MEMBERS) {
        const v = byGeo.get(g);
        if (v != null) memberValues.push(v);
      }
      if (memberValues.length < 20) continue;
      const higher = memberValues.filter((v) => v > bg).length;
      const rank = higher + 1;
      const euAvg = byGeo.get("EU27_2020") ?? null;
      out[naItem] = {
        year: y,
        bgPctGdp: round(bg, 2),
        euAvgPctGdp: euAvg != null ? round(euAvg, 2) : null,
        rank,
        total: memberValues.length,
      };
      break;
    }
  }
  return out;
};

const main = async () => {
  console.log(
    `Fetching ${DATASET} for geos=[${GEOS.join(",")}], na_item=[${NA_ITEMS.join(",")}]…`,
  );
  const json = await fetchPeers();
  const rows = decode(json);

  // Pivot: series[geo][naItem] = [{year, value}]
  const series: Record<Geo, Record<NaItem, Point[]>> = {} as Record<
    Geo,
    Record<NaItem, Point[]>
  >;
  for (const g of GEOS) {
    series[g] = { TR: [], TE: [], B9: [] };
  }
  for (const r of rows) {
    if (!(GEOS as readonly string[]).includes(r.geo)) continue;
    if (!(NA_ITEMS as readonly string[]).includes(r.naItem)) continue;
    series[r.geo as Geo][r.naItem as NaItem].push({
      year: r.year,
      value: round(r.value, 2),
    });
  }
  for (const g of GEOS) {
    for (const n of NA_ITEMS) {
      series[g][n].sort((a, b) => a.year - b.year);
    }
  }

  // Sanity: every geo should have at least 10 BG-era observations for B9.
  for (const g of GEOS) {
    const n = series[g].B9.length;
    if (n < 10) {
      throw new Error(`Too few B9 observations for ${g}: ${n} < 10`);
    }
  }

  const latestYear = Math.max(
    ...GEOS.flatMap((g) =>
      NA_ITEMS.flatMap((n) => series[g][n].map((p) => p.year)),
    ),
  );

  console.log("Fetching distribution (27 member states, latest year)…");
  const distJson = await fetchDistribution();
  const distRows = decode(distJson);
  const distribution = buildDistribution(distRows);

  const payload = {
    fetchedAt: new Date().toISOString(),
    source: {
      name: "Eurostat",
      dataset: DATASET,
      url: SOURCE_URL,
      unit: "PC_GDP",
      sector: "S13",
      filters: { freq: "A", unit: "PC_GDP", sector: "S13" },
    },
    geos: GEOS,
    naItems: NA_ITEMS,
    latestYear,
    series,
    // Peer-band per naItem from the full 27-member distribution — used by the
    // headline-card chips on /budget. Latest year only (the chip surfaces "BG
    // vs EU27 today", not a trend).
    distribution,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(
    `Wrote ${OUT_FILE} — ${GEOS.length} geos × ${NA_ITEMS.length} metrics, latest year ${latestYear}, distribution for ${Object.keys(distribution).length} metrics`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
