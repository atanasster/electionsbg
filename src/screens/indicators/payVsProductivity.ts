import type { MacroPayload } from "@/data/macro/useMacro";

/**
 * Base year of the two index series this callout accompanies
 * (Eurostat nama_10_lp_ulc, unit I15) and of `priceIndex`. Changing it here
 * without changing the fetched `unit` would silently reframe the caption
 * against a base the chart does not use.
 */
const INDEX_BASE_YEAR = 2015;

export type PayVsProductivityCallout = {
  from: number;
  to: number;
  /** Cumulative nominal pay growth over the window, %, locale-formatted. */
  nominalPay: string;
  /** Cumulative HICP growth over the same window, %, locale-formatted. */
  prices: string;
  /** Nominal pay deflated by HICP, %, locale-formatted. */
  realPay: string;
  /** Cumulative real labour-productivity growth, %, locale-formatted. */
  productivity: string;
  /**
   * realPay ÷ productivity as a multiple, locale-formatted. Null when
   * productivity did not grow — a ratio against a flat or falling denominator
   * is either meaningless or infinite, and both render as nonsense.
   */
  multiple: string | null;
};

// Pure computation behind the pay-vs-productivity callout on
// /indicators/economy.
//
// Deliberately built from the annual PRICE INDEX rather than the `inflation`
// series: the latter is a YoY rate rounded to 2dp, and chaining a decade of
// rounded rates drifts from the true cumulative price level. `priceIndex` is
// the level itself.
//
// The comparison is honest but not a clean ratio, and the caption says so:
// `compensationPerEmployee` is per EMPLOYEE while `labourProductivity` is per
// PERSON EMPLOYED (which includes the self-employed). The series that handles
// that correctly by construction is `unitLabourCost`, which is why it — not
// this callout — is what the chart above plots. Kept pure (no React, no i18n)
// so the window selection and the guards are unit-testable; the caller
// supplies `fmt` for locale number formatting.
export const computePayVsProductivityCallout = (
  macro: MacroPayload | undefined,
  fmt: (v: number) => string,
): PayVsProductivityCallout | null => {
  const pay = macro?.series.compensationPerEmployee;
  const prices = macro?.series.priceIndex;
  const prod = macro?.series.labourProductivity;
  if (!pay?.length || !prices?.length || !prod?.length) return null;

  // The window ends at the overlap of all three series, not any single
  // series' span: they are three separate Eurostat datasets on independent
  // release calendars, so one running a year ahead must not silently compare
  // an 11-year pay rise against a 10-year productivity rise.
  const at = (s: typeof pay, y: number) => s.find((p) => p.year === y)?.value;
  const years = pay
    .map((p) => p.year)
    .filter((y) => at(prices, y) != null && at(prod, y) != null)
    .sort((a, b) => a - b);
  if (years.length < 2) return null;
  const to = years[years.length - 1];

  // It STARTS at the index base year, not at the earliest year available.
  // The two lines this caption sits under are indexed to 2015 = 100, so a
  // caption measured from 2005 contradicts the chart it explains. It is also
  // the weaker statistic: run from 2005 the same series read "+207% real pay
  // vs +63% productivity", which is mostly EU-accession convergence off a
  // 2005 wage level no productivity comparison can sensibly anchor to.
  // Falls back to the earliest common year on a series that somehow lacks the
  // base year, so the callout degrades rather than disappearing.
  const from = years.includes(INDEX_BASE_YEAR) ? INDEX_BASE_YEAR : years[0];
  if (from >= to) return null;

  const grow = (s: typeof pay) => {
    const a = at(s, from);
    const b = at(s, to);
    return a != null && b != null && a > 0 ? b / a : null;
  };
  const payG = grow(pay);
  const priceG = grow(prices);
  const prodG = grow(prod);
  if (payG == null || priceG == null || prodG == null) return null;

  const realG = payG / priceG;
  const pct = (g: number) => (g - 1) * 100;
  return {
    from,
    to,
    nominalPay: fmt(pct(payG)),
    prices: fmt(pct(priceG)),
    realPay: fmt(pct(realG)),
    productivity: fmt(pct(prodG)),
    multiple: prodG > 1 ? fmt(pct(realG) / pct(prodG)) : null,
  };
};
