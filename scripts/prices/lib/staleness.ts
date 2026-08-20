// How old a last-known price may be before it stops being shown at all — the
// ONE definition, shared by the payload builder and anything that renders or
// filters on `price_last_seen.as_of`.
//
// It exists because "never delete a chain" and "never show a stale price as
// current" pull against each other, and the resolution is a bounded middle: a
// chain that stops filing keeps its page and its prices, each labelled with the
// day it was observed, until the label stops meaning anything.
//
// Beyond the ceiling the page says "no data since <date>" and shows no prices.
// That is not a deletion — `price_last_seen`, `price_facts`, `price_chain_days`
// and the dimensions all still hold the chain's whole history, and the page
// still exists and still names the chain. It is the point at which quoting a
// number would be a worse answer than declining to.
//
// ⚠️ A retained price is NEVER eligible for a minimum, a ranking, or a
// cross-chain comparison, at ANY age. `chain-map` (cheapest chain per
// município) and `basketLevel` read `price_current` and the per-day grids
// precisely so a stale value cannot win a "cheapest" board. This ceiling
// governs DISPLAY only; it is not a licence to aggregate anything under it.

/** Days a last-known price may be shown, labelled, after its chain went quiet.
 *
 *  30 is the plan's recommendation (docs/plans/prices-chain-absence-v1.md §7
 *  Q2) and is a PRODUCT decision rather than a measured one: long enough to ride
 *  out the multi-day КЗП outages the corpus actually shows (the 2026-08 Билла
 *  break was 5 days and counting), short enough that "последно подадена цена"
 *  still describes something a shopper could act on. */
export const STALE_DAYS = 30;

/** Is a price observed on `asOf` stale relative to the corpus's latest day?
 *  Both are ISO `YYYY-MM-DD`, which compares correctly as a string. */
export const isStale = (asOf: string | null, latest: string | null): boolean =>
  !!(asOf && latest && asOf < latest);

/** Whole days between two ISO dates. Null when either is missing. */
export const daysBetween = (
  from: string | null,
  to: string | null,
): number | null => {
  if (!from || !to) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
};

/** Past the display ceiling — show the chain and its last-filed date, but no
 *  prices. */
export const beyondCeiling = (
  asOf: string | null,
  latest: string | null,
): boolean => {
  const d = daysBetween(asOf, latest);
  return d != null && d > STALE_DAYS;
};
