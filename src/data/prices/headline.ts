// The figure a headline must quote, for any /prices series.
//
// A PLAIN .ts on purpose: scripts/prices/build_payloads.ts computes the same
// number server-side for the /consumption hub tile, and it is a Node script
// that must not import React. It was a hand-copy until 2026-08-18, and the two
// drifted immediately — the blob shipped the raw last point while the page
// showed a trailing mean, so the two surfaces read -1.3% and +1.3% one click
// apart. (Precedent: scripts/video/build_risk.ts imports
// src/data/riskScore/computeRiskComposite for exactly this reason.)

import type { PricePoint } from "./usePrices";

/** Days averaged for a headline figure. */
export const HEADLINE_WINDOW = 7;

/**
 * The figure a headline must quote, for any series in this payload — a trailing
 * mean of the usable days ending at the payload's own `headlineDate`.
 *
 * TWO corrections, and a headline needs both:
 *
 *  * the right DAY. `series[series.length - 1]` is whatever the КЗП feed
 *    happened to report; when its reporter set collapsed in 2026-08 that was
 *    98 chains against a normal 203, and the last point read −1.3% while the
 *    last COMPLETE day read +1.4%. `coverage.headlineDate` names the day the
 *    publisher will stand behind.
 *  * the right VALUE. Even on complete days the daily series carries ~±0.5
 *    points of sampling noise, so a single day is not a number worth printing
 *    to one decimal — and the chart beside it was already drawn as a 7-day
 *    moving average, so the headline and the line disagreed by construction.
 *
 * Incomplete days and days with nothing matched (`n === 0`, a builder fallback
 * rather than a measurement) are dropped from the window rather than averaged
 * in. Returns null only when no usable day exists at all.
 */
export const headlineIndex = (
  series: PricePoint[] | undefined,
  // Only the two fields it actually reads, so a caller holding a narrower
  // payload type (the AI tool's own) can pass its coverage without widening.
  coverage: { headlineDate?: string; incompleteDates?: string[] } | undefined,
  window = HEADLINE_WINDOW,
): {
  /** The mean, on the index's 100 base. */
  v: number;
  /** The day the window ENDS on — what a caption must name. */
  d: string;
  /** How many points were averaged (≤ window). */
  days: number;
  /** The day the window STARTS on. Not `d` minus `window`: skipped days are
   *  reached back past, so on the 2026-08 shape a "7-day mean" spans 13
   *  calendar days. A caption that says "7 дни" without this is wrong. */
  from: string;
} | null => {
  if (!series?.length) return null;
  const withheld = new Set(coverage?.incompleteDates ?? []);
  const end = coverage?.headlineDate
    ? series.findIndex((p) => p.d === coverage.headlineDate)
    : series.length - 1;
  // A headlineDate the series does not carry should be impossible (one date
  // axis), but a stale number beats a blank one.
  const last = end >= 0 ? end : series.length - 1;

  const usable: PricePoint[] = [];
  for (let i = last; i >= 0 && usable.length < window; i--) {
    const p = series[i];
    if (withheld.has(p.d)) continue;
    if (p.n === 0) continue;
    usable.push(p);
  }
  if (!usable.length) return null;
  return {
    v: usable.reduce((a, p) => a + p.v, 0) / usable.length,
    d: series[last].d,
    days: usable.length,
    // usable is filled newest-first, so its last element is the oldest.
    from: usable[usable.length - 1].d,
  };
};
