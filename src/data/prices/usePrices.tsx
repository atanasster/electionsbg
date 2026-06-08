// React Query hooks for the КЗП "Колко струва" price layer (data/prices/).
// All artifacts are served from the GCS data bucket via dataUrl(). The feed is
// a monitoring basket index — NOT official CPI (pairs with the macro tile).
// See docs/plans/prices_kolkostruva_design.md.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

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

const getJson = async <T,>(path: string): Promise<T | null> => {
  const res = await fetch(dataUrl(path));
  if (!res.ok) return null; // not-covered settlements/munis 404 → self-hide
  return (await res.json()) as T;
};

// Full index (national/oblast/category series) — governance tiles only.
export const usePriceIndex = () =>
  useQuery({
    queryKey: ["prices", "index"],
    queryFn: () => getJson<PriceIndexFile>("/prices/index.json"),
    staleTime: Infinity,
  });

// Small dictionary + meta (no series) — place pages, instead of the full index.
export const usePriceDict = () =>
  useQuery({
    queryKey: ["prices", "dict"],
    queryFn: () => getJson<PriceDictFile>("/prices/dict.json"),
    staleTime: Infinity,
  });

export const usePriceRanking = () =>
  useQuery({
    queryKey: ["prices", "ranking"],
    queryFn: () => getJson<PriceRankingFile>("/prices/ranking.json"),
    staleTime: Infinity,
  });

export const useSettlementPrices = (ekatte?: string | null) =>
  useQuery({
    queryKey: ["prices", "settlement", ekatte],
    queryFn: () =>
      getJson<SettlementPriceFile>(`/prices/settlement/${ekatte}.json`),
    enabled: !!ekatte,
    staleTime: Infinity,
  });

export const useNationalChains = () =>
  useQuery({
    queryKey: ["prices", "chains"],
    queryFn: () => getJson<NationalChainsFile>("/prices/chains.json"),
    staleTime: Infinity,
  });

export const useMuniChains = (obshtina?: string | null) =>
  useQuery({
    queryKey: ["prices", "chains", obshtina],
    queryFn: () => getJson<MuniChainsFile>(`/prices/chains/${obshtina}.json`),
    enabled: !!obshtina,
    staleTime: Infinity,
  });

/** Look up a place's ranking row by its code (ekatte / obshtina / oblast). */
export const findRankPlace = (
  ranking: PriceRankingFile | null | undefined,
  code: string | null | undefined,
): PriceRankPlace | undefined =>
  code ? ranking?.places.find((p) => p.code === code) : undefined;

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
