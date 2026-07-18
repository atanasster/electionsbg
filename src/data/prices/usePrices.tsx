// React Query hooks for the КЗП "Колко струва" price layer.
//
// Served from Postgres (migration 048) via /api/db/price-payload, not from the
// GCS bucket: data/prices/*.json no longer exists. The feed is a monitoring
// basket index — NOT official CPI (pairs with the macro tile).
// See docs/plans/consumption-pg-v1.md.

import { useQuery } from "@tanstack/react-query";
import { fetchPricePayload } from "./fetchPricePayload";

export interface PricePoint {
  d: string;
  v: number;
}
export interface ProductMeta {
  id: number;
  cat: number;
  bg: string;
  en: string;
}
export interface CategoryMeta {
  id: number;
  bg: string;
  en: string;
}

export interface PriceIndexFile {
  source: { name: string; nameEn: string; url: string };
  fetchedAt: string;
  firstDate: string;
  latestDate: string;
  baseline: string;
  note: string;
  coverage: { settlements: number; chains: number; rows: number };
  categories: CategoryMeta[];
  products: ProductMeta[];
  national: {
    index: PricePoint[];
    byCategory: Record<string, PricePoint[]>;
    promoShare: PricePoint[];
  };
  regions: Record<string, { name: string; index: PricePoint[] }>;
}

/** Small product/category dictionary + meta (no series) for place pages. */
export interface PriceDictFile {
  source: { name: string; nameEn: string; url: string };
  fetchedAt: string;
  firstDate: string;
  latestDate: string;
  baseline: string;
  coverage: { settlements: number; chains: number; rows: number };
  categories: CategoryMeta[];
  products: ProductMeta[];
  commonBasket: number[];
  commonBasketSize: number;
}

/** Per-place rank summary, embedded into each settlement / município shard. */
export interface PlaceRankSummary {
  basketLevel: number | null;
  nPriced: number;
  indexSinceEuro: number;
  change30d: number;
  popBand?: "XL" | "L" | "M" | "S" | null;
  rank: RankTriple;
  rankChange: RankTriple;
  peers: RankTriple;
}

export interface SettlementProduct {
  id: number;
  min: number;
  avg: number;
  max: number;
  median: number;
  cheapestEik: string;
  cheapestChain: string;
  /** Free-text store name+address behind the cheapest price (КЗП "Търговски
   * обект"). Optional — absent on shards built before store text was retained. */
  cheapestStore?: string;
  stores: number;
  promoMin: number | null;
}
export interface SettlementPriceFile {
  ekatte: string;
  name: string;
  nameEn: string;
  obshtina: string;
  oblast: string;
  latestDate: string;
  baselineDate: string;
  basketChangeSinceEuro: number;
  basketChange30d: number;
  basketSeriesWeekly: PricePoint[];
  byCategory: { id: number; changeSinceEuro: number; change30d: number }[];
  topMovers: {
    up: { id: number; change: number }[];
    down: { id: number; change: number }[];
  };
  products: SettlementProduct[];
  rank?: PlaceRankSummary | null;
}

export interface RankTriple {
  national?: number | null;
  sizeClass?: number | null;
  oblast?: number | null;
}
export interface PriceRankPlace {
  code: string;
  tier: "settlement" | "muni" | "oblast";
  name: string;
  oblast: string;
  muni?: string;
  popBand?: "XL" | "L" | "M" | "S";
  basketLevel: number | null;
  nPriced: number;
  indexSinceEuro: number;
  change30d: number;
  rank: RankTriple;
  rankChange: RankTriple;
  peers: RankTriple;
}
export interface PriceRankingFile {
  latestDate: string;
  baseline: string;
  commonBasket: number[];
  commonBasketSize: number;
  places: PriceRankPlace[];
}

export interface DealRow {
  slug: string;
  title: string;
  /** current promo price (EUR). */
  promo: number;
  /** regular price it's discounted from (EUR). */
  reg: number;
  /** discount as a whole-number percent. */
  discPct: number;
  eik: string;
  chain: string;
}
export interface DealsFile {
  latestDate: string;
  deals: DealRow[];
}

export interface ChainRow {
  eik: string;
  chain: string;
  basket: number;
  nPriced: number;
  products?: number;
}
export interface NationalChainsFile {
  latestDate: string;
  commonBasketSize: number;
  note: string;
  national: ChainRow[];
}
export interface MuniChainsFile {
  obshtina: string;
  latestDate: string;
  coreBasketSize?: number;
  rank?: PlaceRankSummary | null;
  chains: ChainRow[];
}

// The payload SHAPES are unchanged — these are the same objects build_index.ts
// always produced, now stored verbatim in price_payloads and fetched by one
// primary-key seek. That is why not a single consuming tile had to change.
// A place outside the ~245 covered settlements returns `null` (HTTP 200),
// exactly as its missing shard used to 404, so the tiles still self-hide.

// Full index (national/oblast/category series) — governance tiles only.
export const usePriceIndex = () =>
  useQuery({
    queryKey: ["prices", "index"],
    queryFn: () => fetchPricePayload<PriceIndexFile>("index"),
    staleTime: Infinity,
  });

// Small dictionary + meta (no series) — place pages, instead of the full index.
export const usePriceDict = () =>
  useQuery({
    queryKey: ["prices", "dict"],
    queryFn: () => fetchPricePayload<PriceDictFile>("dict"),
    staleTime: Infinity,
  });

export const usePriceRanking = () =>
  useQuery({
    queryKey: ["prices", "ranking"],
    queryFn: () => fetchPricePayload<PriceRankingFile>("ranking"),
    staleTime: Infinity,
  });

export const useSettlementPrices = (ekatte?: string | null) =>
  useQuery({
    queryKey: ["prices", "settlement", ekatte],
    queryFn: () => fetchPricePayload<SettlementPriceFile>("place", ekatte),
    enabled: !!ekatte,
    staleTime: Infinity,
  });

export const useNationalChains = () =>
  useQuery({
    queryKey: ["prices", "chains"],
    queryFn: () => fetchPricePayload<NationalChainsFile>("chains"),
    staleTime: Infinity,
  });

export const useMuniChains = (obshtina?: string | null) =>
  useQuery({
    queryKey: ["prices", "chains", obshtina],
    queryFn: () => fetchPricePayload<MuniChainsFile>("chains-muni", obshtina),
    enabled: !!obshtina,
    staleTime: Infinity,
  });

export const useDeals = () =>
  useQuery({
    queryKey: ["prices", "deals"],
    queryFn: () => fetchPricePayload<DealsFile>("deals"),
    staleTime: Infinity,
  });

/** Promotions scoped to one município ("промоции край вас"). Returns null for
 *  an obshtina with no covered stores/promos — callers fall back to the
 *  national feed. Shares the DealsFile shape with the national blob. */
export const useMuniDeals = (obshtina?: string | null) =>
  useQuery({
    queryKey: ["prices", "deals", obshtina],
    queryFn: () => fetchPricePayload<DealsFile>("deals-muni", obshtina),
    enabled: !!obshtina,
    staleTime: Infinity,
  });

/** Per-tile headline numbers for the /consumption hub (mirrors the sectors
 *  hub's sector_stats.json) — a single precomputed hub-stats blob, one PK seek.
 *  Nulls where a stat is unavailable. */
export interface HubStats {
  products: number | null;
  dearerPct: number | null;
  cheaperPct: number | null;
  chains: number | null;
  settlements: number | null;
  categories: number | null;
  basketChangePct: number | null;
  biggestDealPct: number | null;
  fuelGapPct: number | null;
  euFoodPli: number | null;
  foodInflationPct: number | null;
}
export const useHubStats = () =>
  useQuery({
    queryKey: ["prices", "hub-stats"],
    queryFn: () => fetchPricePayload<HubStats>("hub-stats"),
    staleTime: Infinity,
  });

/** One product a chain sells: the chain's own min price + the market min. */
export interface ChainProduct {
  slug: string;
  title: string;
  netQty: number | null;
  netUnit: string | null;
  price: number;
  marketMin: number | null;
  pctSinceEuro: number | null;
}
export interface ChainProductsFile {
  products: ChainProduct[];
}
/** A retail chain's own products (top 100 by popularity), precomputed per EIK. */
export const useChainProducts = (eik: string | undefined) =>
  useQuery({
    queryKey: ["prices", "chain-products", eik],
    queryFn: () => fetchPricePayload<ChainProductsFile>("chain-products", eik),
    enabled: !!eik,
    staleTime: Infinity,
  });

/** The cheapest chain in each município (over the common basket) — the source
 *  for the categorical "who wins where" choropleth on /prices/map. `code` is the
 *  ranking muni code (Sofia = SOF46; the map remaps to SOF00). */
export interface ChainMapMuni {
  code: string;
  eik: string;
  chain: string;
  basket: number;
  nPriced: number;
}
export interface ChainMapFile {
  latestDate: string;
  munis: ChainMapMuni[];
}
export const useChainMap = () =>
  useQuery({
    queryKey: ["prices", "chain-map"],
    queryFn: () => fetchPricePayload<ChainMapFile>("chain-map"),
    staleTime: Infinity,
  });

/** Normalized €/kg (from g) and €/L (from ml) per KZP category — the value
 *  explorer. `eurPerUnit` is €/kg or €/L; a basis is present only with enough
 *  products to make the median meaningful. */
export interface UnitPriceLeader {
  slug: string;
  title: string;
  netQty: number;
  eurPerUnit: number;
}
export interface UnitPriceBasis {
  median: number;
  n: number;
  best: UnitPriceLeader[];
  worst: UnitPriceLeader[];
}
export interface UnitPriceCategory {
  cat: number;
  bg: string;
  en: string;
  kg: UnitPriceBasis | null;
  l: UnitPriceBasis | null;
}
export interface UnitPricesFile {
  latestDate: string;
  categories: UnitPriceCategory[];
}
export const useUnitPrices = () =>
  useQuery({
    queryKey: ["prices", "unit-prices"],
    queryFn: () => fetchPricePayload<UnitPricesFile>("unit-prices"),
    staleTime: Infinity,
  });

/** Look up a place's ranking row by its code (ekatte / obshtina / oblast). */
export const findRankPlace = (
  ranking: PriceRankingFile | null | undefined,
  code: string | null | undefined,
): PriceRankPlace | undefined =>
  code ? ranking?.places.find((p) => p.code === code) : undefined;

/**
 * Google Maps directions URL to a store we only know by free text. We have no
 * coordinates — just the chain, the КЗП store label (name + street), and the
 * settlement — so we hand Google a destination query and let it geocode +
 * route from the user's location. Drops empty parts.
 */
export const mapsDirectionsUrl = (
  parts: (string | null | undefined)[],
): string => {
  const q = parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
};

/** Format a euro amount per the project convention (`${n} €` bg / `€${n}` en). */
export const fmtEur = (n: number, lang: "bg" | "en", dp = 2): string => {
  const s = n.toLocaleString(lang === "bg" ? "bg-BG" : "en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  return lang === "bg" ? `${s} €` : `€${s}`;
};

/** Signed percent string, e.g. +4.1% / −2.3%. `frac` is a fraction (0.041). */
export const fmtPct = (frac: number, dp = 1): string => {
  const pct = frac * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(dp)}%`;
};

// A grocery item cannot credibly move more than ~100% since euro-day (Jan 2026);
// values beyond that are data artifacts — a thin/glitchy euro-day baseline, a
// per-piece↔per-kg unit change, or product-identity drift under one canon_key.
// Treat them as "no reliable baseline" so the UI never shows a "+429%".
export const EURO_PCT_ARTIFACT = 100;
/** pct_since_euro (a PERCENT), or null when it's an implausible artifact. */
export const euroPctSafe = (pct: number | null | undefined): number | null =>
  pct == null || Math.abs(pct) > EURO_PCT_ARTIFACT ? null : pct;

/** Tailwind text class for a price change: red up, green down, muted flat. */
export const priceChangeColor = (frac: number): string =>
  frac > 0.001
    ? "text-red-600 dark:text-red-400"
    : frac < -0.001
      ? "text-green-600 dark:text-green-400"
      : "text-muted-foreground";

/** Format an ISO date (`YYYY-MM-DD`) as "2 яну 2026" / "2 Jan 2026". */
export const fmtPriceDate = (
  iso: string | undefined | null,
  lang: "bg" | "en",
): string =>
  iso
    ? new Date(iso).toLocaleDateString(lang === "bg" ? "bg-BG" : "en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

/**
 * Trailing moving average over a {d,v} series. The daily КЗП basket is
 * recomputed each day from whichever stores reported, so it swings on
 * reporting/promo noise — plotted raw it reads as a squiggle, not a trend.
 * Averaging over a trailing window (default 7 points ≈ one week of daily data)
 * calms that noise so the line shows the underlying path. The window ramps up
 * over the first few points (uses however many are available) so the series
 * keeps its original length and endpoints. `window` is in points, not days.
 */
export const movingAverage = (
  points: PricePoint[],
  window = 7,
): PricePoint[] => {
  if (points.length === 0) return points;
  const w = Math.max(1, Math.min(window, points.length));
  const out: PricePoint[] = [];
  const q: number[] = [];
  let sum = 0;
  for (const p of points) {
    q.push(p.v);
    sum += p.v;
    if (q.length > w) sum -= q.shift()!;
    out.push({ d: p.d, v: sum / q.length });
  }
  return out;
};
