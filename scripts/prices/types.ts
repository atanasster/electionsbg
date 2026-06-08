// Shared types for the KZP "Колко струва" price ingest.
// See docs/plans/prices_kolkostruva_design.md.

/** One normalized price observation (one store × one product). */
export interface PriceRow {
  ekatte: string; // normalized 5-digit EKATTE
  store: string; // store name + address (free text)
  product: string; // chain's product label
  productId: number; // KZP product-group id (CSV col "Категория"); 0 if outside 1..101
  price: number; // retail price, EUR
  promo: number | null; // promo price, EUR, or null
  eik: string; // chain EIK (from filename)
  chain: string; // chain display name (from filename)
}

/** Per (settlement, product) aggregate for a single day. */
export interface CellAgg {
  min: number;
  avg: number;
  max: number;
  median: number;
  cheapestEik: string;
  stores: number; // distinct stores priced
  chains: number; // distinct chains priced
  promoMin: number | null;
}

/**
 * One day's aggregated grid. Lives in data/prices/_cache/daily/<date>.json
 * (local only — excluded from bucket:sync). build_index.ts reads the whole
 * series of these to produce the shipped artifacts.
 */
export interface DailyGrid {
  date: string; // YYYY-MM-DD
  // ekatte -> productId -> aggregate
  cells: Record<string, Record<string, CellAgg>>;
  // ekatte -> eik -> productId -> chain's min price (for chain comparison)
  chainCells: Record<string, Record<string, Record<string, number>>>;
  chainNames: Record<string, string>; // eik -> display name
  stats: { chains: number; rows: number; settlements: number };
}

export type PopBand = "XL" | "L" | "M" | "S";

export interface PlaceLoc {
  ekatte: string;
  name: string;
  nameEn: string;
  obshtina: string;
  oblast: string;
  population: number | null;
  popBand: PopBand;
}

export interface ProductDict {
  categories: { id: number; bg: string; en: string }[];
  products: { id: number; cat: number; bg: string; en: string }[];
}
