// React Query hooks for the КЗП "Колко струва" price layer.
//
// Served from Postgres (migration 048) via /api/db/price-payload, not from the
// GCS bucket: data/prices/*.json no longer exists. The feed is a monitoring
// basket index — NOT official CPI (pairs with the macro tile).
// See docs/plans/consumption-pg-v1.md.

import { useQuery } from "@tanstack/react-query";
// The headline rule lives in a plain .ts so scripts/prices/build_payloads.ts —
// a Node script that must not pull in React — can import it too. Re-exported
// here because every UI consumer reaches for it through this module.
export { headlineIndex, HEADLINE_WINDOW } from "./headline";
import { fetchPricePayload } from "./fetchPricePayload";

export interface PricePoint {
  d: string;
  v: number;
  /** Products matched on this day. `n === 0` means NOT COMPUTABLE — `v` is
   *  then a 100 the builder fell back to, not a measurement. Absent on
   *  payloads built before the chain-matched basis. */
  n?: number;
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
  coverage: {
    settlements: number;
    chains: number;
    rows: number;
    /** Reporter count of the trailing COVERAGE_WINDOW_DAYS, for scale. */
    chainsTrailingMedian: number | null;
    /** Is the LATEST day's reporter count within COVERAGE_FLOOR of that? */
    chainsComplete: boolean;
    /**
     * The day a single quoted figure must be taken from — the latest day when
     * its reporter count clears the floor, else the last day that did.
     *
     * Never read `index[index.length - 1]` for a headline. The КЗП feed's
     * reporter set fell 203 → 98 chains over six days in 2026-08, and on that
     * corpus the last point reads −1.3% while this day reads +1.4%: the tail
     * flips the sign of the sentence. Use `headlinePoint()` below.
     */
    headlineDate: string;
    /** Every day below the floor — for dimming a chart's tail. */
    incompleteDates: string[];
  };
  categories: CategoryMeta[];
  products: ProductMeta[];
  national: {
    index: PricePoint[];
    byCategory: Record<string, PricePoint[]>;
    promoShare: PricePoint[];
  };
  regions: Record<string, { name: string; index: PricePoint[] }>;
}

/**
 * The single point a headline is anchored to. Prefer `headlineIndex` for a
 * value; this is for callers that need the day itself (a date caption).
 */
export const headlinePoint = (
  series: PricePoint[] | undefined,
  coverage: { headlineDate?: string } | undefined,
): PricePoint | null => {
  if (!series?.length) return null;
  const d = coverage?.headlineDate;
  if (!d) return series[series.length - 1];
  return series.find((p) => p.d === d) ?? series[series.length - 1];
};

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
  /** Matched products / chains behind `basketChangeSinceEuro`. `indexN === 0`
   *  means NOT COMPUTABLE — the figure is then the builder's 0.000 fallback,
   *  not a measurement, and renders identically to a genuinely flat basket.
   *  63 of 217 panel settlements were in that state on 2026-08-14. Optional:
   *  shards built before the chain-matched basis carry neither. */
  indexN?: number;
  indexChains?: number;
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
  /** SUM over the `nPriced` products this chain actually priced — NOT a
   *  like-for-like basket unless `comparable` is true. */
  basket: number;
  nPriced: number;
  /** May this row be ranked against the others? Published by build_index (see
   *  its `note`). Optional: payloads built before it carry none, and callers
   *  fall back to comparing nPriced themselves. */
  comparable?: boolean;
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

/**
 * The chains whose baskets may be RANKED against each other — those pricing the
 * whole common basket.
 *
 * `chains.json` scores each chain on the subset it happens to price and sorts by
 * the raw sum, so a chain missing items floats to the top. Measured on the
 * 2026-08 corpus, the four "cheapest chains" the hub showed priced 8, 7, 10 and
 * 8 of 12 — and on the same 12 products the true order is completely different:
 * ЖИЗЕЛ 14.47, Лидл 14.50, BulMag 15.25, none of which appeared. ДИМЕКС led at
 * "10.99 €" only by skipping a third of the basket.
 *
 * The builder's own note says "Compare like-with-like"; this is that, enforced.
 * 30 of 60 chains price all 12, so the leaderboard stays full.
 *
 * The partial-coverage chains are not wrong and are not hidden — they belong on
 * /consumption/chains, where each row's coverage is the point. What they cannot
 * do is sit in a top-4 captioned "cheapest" on a front page.
 */
export const comparableChains = (
  chains: ChainRow[] | undefined,
  basketSize: number | undefined,
): { rows: ChainRow[]; excluded: number; fellBack: boolean } => {
  const all = chains ?? [];
  // Prefer the published flag; compute it only for a payload that predates it.
  const isComparable = (c: ChainRow) =>
    c.comparable ?? (basketSize ? c.nPriced >= basketSize : true);
  const rows = all.filter(isComparable);
  // A place where NO chain prices the full basket would otherwise render an
  // empty tile. Measured: 32 of 130 município payloads are in that state, so
  // this is an ordinary case rather than an edge one — which is exactly why it
  // must be reported. `fellBack` is what lets a caller say "not comparable"
  // instead of silently re-publishing the defect.
  if (!rows.length) return { rows: all, excluded: 0, fellBack: all.length > 0 };
  return { rows, excluded: all.length - rows.length, fellBack: false };
};

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
  electricityGapPct: number | null;
  gasGapPct: number | null;
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
/**
 * Household pack ceiling for the KG basis, in grams. Above it a pack is
 * catering/wholesale.
 *
 * ⚠️ KG ONLY. Do not reuse it for the L basis: the ordinary household liquid
 * pack is a 6×1.5 L water стек (9,000 ml) or a 5 L detergent, so 3,000 would
 * exclude the normal case rather than the bulk one. Measured 2026-08-18, of the
 * 27 live L products above 3,000 ml, 20 are legitimate 6×1.5 L multipacks and
 * only 7 are mis-sized — so a 3 L ceiling here suppresses correct rows almost
 * three to one, which is the opposite of what it does on the kg basis.
 *
 * The ingest defect this used to cite is FIXED (rules 8 and 9 in
 * scripts/prices/lib/canon.ts): "1. 5 Л." no longer parses as 5,000 ml and the
 * "075Л" wines no longer parse as 75,000 ml. Three narrow shapes survive, all
 * verified as the complete residue and none reaching this board today — a
 * SPACED lost separator ("Сайкъл Вионие 0 75л", 4 rows, deliberately not fixed
 * because "БРАШНО … ТИП 0 1 КГ" is the same shape and is correct), a bare "75Л"
 * for 0.75 L (2 rows, not separable from a genuine 75 L without a plausibility
 * clamp) and a Cyrillic "О" typed for a zero ("ОЦЕТ … О,7L", 1 row).
 *
 * €/kg is the right way to compare a 400g jar with a 700g one. It is NOT a way
 * to compare either with a 10kg sack: bulk is cheaper per kilo by definition,
 * so an unfiltered "най-много храна за парите" board ranks pack size, not
 * value. Measured on the 2026-08 corpus, the top six were 5–10kg catering packs
 * (olives at 5kg, onions and potatoes at 10kg) and the first item a household
 * would actually buy — 1kg flour at 0.92 €/kg — sat seventh.
 *
 * 3kg/3L is the line: it admits the largest ordinary grocery pack (a 3kg
 * washing powder, a 2L oil) and excludes the catering tier.
 */
export const HOUSEHOLD_PACK_MAX_G = 3000;

/** Items at a size a household actually buys — see HOUSEHOLD_PACK_MAX_G.
 *
 *  Call it PER CATEGORY, not over a flattened corpus: `bulkOnly` is a statement
 *  about one category ("sold here only in catering sizes"), and evaluated over
 *  everything at once it can only ever say "the whole corpus is bulk", which is
 *  never true and hides the categories that individually are. Measured:
 *  Зеленчуци loses 8 of 8 items to the ceiling. */
export const householdPacks = <T extends { netQty: number }>(
  items: T[],
): { rows: T[]; bulkOnly: boolean } => {
  const rows = items.filter(
    (p) => p.netQty > 0 && p.netQty <= HOUSEHOLD_PACK_MAX_G,
  );
  if (rows.length) return { rows, bulkOnly: false };
  // An EMPTY input suppressed nothing, so it is not "bulk only" — that flag is
  // a sentence the caller renders, and it must not be asserted about no data.
  // The fallback copies rather than handing back the caller's array, since
  // callers sort the result.
  return { rows: [...items], bulkOnly: items.length > 0 };
};

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
/** Fractional change within ±this reads as "no change" — a monitoring basket
 *  wobbles below it. Exported because a CHART tinting its line has to use the
 *  same band as the NUMBER beside it: at ±0.05 against ±0.1 a basket between
 *  the two drew a coloured line under a grey figure. */
export const PRICE_FLAT_BAND = 0.001;

export const priceChangeColor = (frac: number): string =>
  frac > PRICE_FLAT_BAND
    ? "text-red-600 dark:text-red-400"
    : frac < -PRICE_FLAT_BAND
      ? "text-green-600 dark:text-green-400"
      : "text-muted-foreground";

/** Format an ISO date (`YYYY-MM-DD`) as "2 яну 2026" / "2 Jan 2026". */
/**
 * Parse a bare `YYYY-MM-DD` from this corpus as a CALENDAR DAY.
 *
 * `new Date("2026-08-08")` is a UTC-midnight parse per spec, and every
 * formatter here renders in the viewer's zone — so west of Greenwich the label
 * came out a day early. Measured: the /prices caption read "7.08.2026" for a
 * headlineDate of 2026-08-08, and the euro-day baseline rendered as 1.01.2026
 * for a corpus that starts 2026-01-02. Appending a time makes it a LOCAL parse,
 * which is what a bare day from this corpus means. (Same class as the
 * funds_wire `checked_on` hazard CLAUDE.md documents on the server side; the
 * repo's other idiom, `T00:00:00Z` + `timeZone: "UTC"`, is equivalent and is
 * what src/ux/feed/calendarDay.test.ts polices.)
 *
 * ONE definition on purpose: hand-copying the regex into each formatter is how
 * a fix like this survives in one place and is deleted in another.
 */
export const parseCalendarDay = (iso: string): Date =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);

export const fmtPriceDate = (
  iso: string | undefined | null,
  lang: "bg" | "en",
): string => {
  if (!iso) return "";
  const local = parseCalendarDay(iso);
  return local.toLocaleDateString(lang === "bg" ? "bg-BG" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

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
