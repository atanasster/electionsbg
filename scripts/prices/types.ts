// Shared types for the KZP "Колко струва" price ingest.
// See docs/plans/prices_kolkostruva_design.md.

/** One normalized price observation (one store × one product). */
export interface PriceRow {
  ekatte: string; // normalized 5-digit EKATTE
  store: string; // store name + address (free text)
  storeNorm: string; // normLabel(store) — backs price_stores UNIQUE
  product: string; // the chain's own SKU name, e.g. "КАФЕ ЛАВАЦА 1КГ КУАЛИТА РОСА ЗЪРНА"
  productNorm: string; // normName(product) — backs price_skus UNIQUE
  productId: number; // KZP product id 1..101 (CSV col "Категория"); 0 if outside
  // CSV col "Код на продукта" — chain-INTERNAL, NOT an EAN. Code '000006' is
  // three unrelated products at three chains; 15.2% of codes map to >1 name.
  // Never join SKUs on it across chains.
  chainCode: string;
  price: number; // retail price, EUR (the feed is already in euro — no conversion)
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
  cheapestStore: string; // free-text store name+address of the cheapest observation
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
