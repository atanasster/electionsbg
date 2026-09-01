// The corroboration gate the /consumption deals board ships — ONE definition.
//
// It exists because a „promotion" read off a single low listing is not a promotion: it is one
// shop's typo, one broken feed, or a chain padding its declared regular across 35 stores. The
// gate's core move is that the discount is measured against a CHAIN-DEDUPED baseline regular
// (the median of one-regular-per-chain) rather than against the store's own declared reference,
// which is the manipulable field.
//
// ⚠️ IT USED TO EXIST TWICE. `scripts/db/gen_home/price_events.ts` restated all five constants
// verbatim and a data test read three of them back out of `build_payloads.ts` by regex — so the
// fourth, `PROMO_OUTLIER_FLOOR`, could drift silently, and it is exactly the constant where the
// home feed's promotion PRICE and its promotion DATE were found to be measured over different
// populations. Both consumers are Node, so there was never a reason not to share them.
//
// The home generator narrows the DISCOUNT BAND on top of this (15% off is a deal — there are
// hundreds live; 30% off is news) and states that as an override rather than as a copy.

/** A promo must be corroborated across at least this many store listings. */
export const MIN_PROMO_STORES = 3;
/** …and across at least this many distinct chains — a one-chain quirk is not a „deal". */
export const MIN_PROMO_CHAINS = 2;
/** Drop promos below this share of the product's median (chain-deduped) promo: a listing far
 *  under everyone else's promo price is an outlier, not the offer. */
export const PROMO_OUTLIER_FLOOR = 0.7;
/** Absolute floor — guards near-zero broken prices. */
export const MIN_PROMO_EUR = 0.1;
/** At least this much off the baseline to count as a deal. */
export const MIN_DISC = 0.15;
/** Above this it is, empirically, a source error rather than a promotion. */
export const MAX_DISC = 0.7;
