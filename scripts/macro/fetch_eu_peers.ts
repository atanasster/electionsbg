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
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(
    `Wrote ${OUT_FILE} — ${GEOS.length} geos × ${NA_ITEMS.length} metrics, latest year ${latestYear}`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
