// The shape of `data/home/price_events.json` — the price adapter's INPUT.
//
// ⚠️ WHY AN INTERMEDIATE FILE EXISTS AT ALL, when every other adapter reads its source
// directly: the retail price corpus lives ONLY in Postgres (`price_grid_days`,
// `price_current`, `price_product_days` — nothing under `data/prices/` but the slug and
// override maps), while `scripts/db/gen_home/feed.ts` is required to build on a fresh clone
// with no database. Letting the price arm read Postgres would make the feed's own output
// depend on whether a database happened to be up, so two rebuilds of one corpus would differ
// and price rows would silently vanish from a clone — the exact determinism the artifact's
// `computedAt` contract exists to guarantee.
//
// So `db:gen-home-price-events` measures, commits the MEASUREMENTS here, and the adapter
// turns them into events with no database in sight. The split also puts every threshold in
// one reviewable place: this file is the audit trail for what the 90-day replay accepted.
//
// This module is deliberately IMPORT-FREE so both halves can read it.

/** One crossing of the basket-move threshold, already collapsed to a single episode. */
export interface PriceBasketMove {
  /** The day inside the run whose measured move is largest — the event's date and id. */
  peakDay: string;
  /** The run's bounds, so copy can say „over the week ending…" honestly. */
  startDay: string;
  endDay: string;
  /** Signed, in percent, of the trailing week against the week before it. */
  pctChange: number;
  /** The two window means, in EUR, for the twelve-product basket. */
  costEur: number;
  prevCostEur: number;
  /** How many (settlement, product) cells were priced on EVERY day of the span. */
  cohortCells: number;
  /** …as a share of the mean daily cell count, i.e. how much of the corpus held still. */
  cohortShare: number;
}

/** One corroborated live promotion whose price level appeared inside the measured window. */
export interface PricePromotion {
  slug: string;
  title: string;
  /**
   * Since when the cheapest promo for this product has been AT OR BELOW `promoEur`.
   *
   * ⚠️ IT IS NOT „when the promotion started", and the name says so deliberately. The history
   * this is walked over (`price_product_days.min_promo_eur`) is a per-day MINIMUM across every
   * store, which cannot establish that an offer began — only that nothing was cheaper. It was
   * called `startDay` and read as the offer's start, which published „€1.28, since 31 August"
   * for a level live since 21 August.
   */
  atOrBelowSince: string;
  promoEur: number;
  /** The chain-deduped baseline regular the discount is measured against. */
  regularEur: number;
  discountPct: number;
  /** The corroboration: distinct store listings and distinct chains running it. */
  stores: number;
  chains: number;
}

export interface PriceEventsV1 {
  schemaVersion: 1;
  /** The corpus's newest day. This adapter's vintage. */
  computedAt: string;
  /**
   * Every threshold the measurements above were taken under, so a reader of the artifact can
   * tell a rule change from a corpus change.
   *
   * ⚠️ „EVERY" IS THE CONTRACT, and it was a subset once — the level tolerance, the promotion
   * cap and the two inherited gate constants were missing while this comment and the audit both
   * claimed completeness. It is now written from ONE object (`THRESHOLDS` in `price_events.ts`)
   * rather than a literal at the write site, so the two cannot drift again.
   */
  thresholds: {
    basketPids: readonly number[];
    basketWindowDays: number;
    basketMovePct: number;
    minCohortCells: number;
    minCohortShare: number;
    measureWindowDays: number;
    promoMinDiscountPct: number;
    promoMaxDiscountPct: number;
    promoMinStores: number;
    promoMinChains: number;
    promoOutlierFloor: number;
    promoMinEur: number;
    promoLevelTolerance: number;
    promoStartWindowDays: number;
    promoMaxEvents: number;
  };
  basketMoves: PriceBasketMove[];
  promotions: PricePromotion[];
}
