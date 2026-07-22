// Fetch helpers for the PG-served КЗП „Колко струва" price payloads.
//
// The whole data/prices/*.json tree is gone: every dashboard payload now lives
// verbatim in price_payloads(kind, key) and is served by /api/db/price-payload
// as a single primary-key seek. Mirrors src/data/agri/fetchAgriPayload.ts.
//
//   index | ranking | chains | dict   → key ''
//   place                             → key = ekatte
//   chains-muni                       → key = obshtina
//
// A route returns the payload jsonb or `null` (HTTP 200, never 404). `null`
// means the place is outside the ~245 covered settlements, so the tile
// self-hides exactly as it did when the shard 404'd.

const getJson = async <T>(url: string): Promise<T | null> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`prices fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as T | null;
};

export const fetchPricePayload = <T>(
  kind: string,
  key?: string | null,
): Promise<T | null> => {
  const qs = key ? `&key=${encodeURIComponent(key)}` : "";
  return getJson<T>(`/api/db/price-payload?kind=${kind}${qs}`);
};

// ── the new, product-grain surfaces (no JSON equivalent ever existed) ──────

export interface ProductHit {
  slug: string;
  title: string;
  pid: number;
  brand: string | null;
  net_qty: number | null;
  net_unit: string | null;
  chain_count: number;
  current_min_eur: number | null;
  pct_since_euro: number | null;
}

export interface ChainLadderRow {
  eik: string;
  chain: string;
  price_eur: number;
  promo_eur: number | null;
  stores: number;
  /** The chain's cheapest store for this product — КЗП label + settlement,
   *  free text (no coordinates). Feeds a Google Maps directions link. Absent on
   *  payloads built before the store fields were added. */
  store?: string | null;
  settlement?: string | null;
}

export interface ProductDetail {
  product: ProductHit & {
    product_id: number;
    unit_priced: boolean;
    confidence: number;
    attrs: Record<string, string>;
    sku_count: number;
  };
  chains: ChainLadderRow[];
}

/** A day with no row is a REPORTING GAP, not a flat line — never interpolate. */
export interface HistoryPoint {
  day: string;
  min_eur: number; // regular (list) price min that day
  /** effective min incl. promos — dips below min_eur on a real promo. May be
   *  absent for rows built before the promo series was added. */
  min_promo_eur?: number | null;
  chains: number;
}

/** The five buckets. `no_baseline` = products with no euro-day observation;
 *  they are neither "unchanged" nor droppable. */
export interface EuroVerdict {
  cheaper: number;
  dearer: number;
  unchanged: number;
  no_baseline: number;
  total: number;
}

export const fetchProduct = (slug: string, ekatte?: string | null) =>
  getJson<ProductDetail>(
    `/api/db/price-product?slug=${encodeURIComponent(slug)}` +
      (ekatte ? `&ekatte=${encodeURIComponent(ekatte)}` : ""),
  );

export const fetchProductHistory = (slug: string) =>
  getJson<HistoryPoint[]>(
    `/api/db/price-history?slug=${encodeURIComponent(slug)}`,
  );

export const fetchEuroVerdict = () =>
  getJson<EuroVerdict>("/api/db/price-verdict");
