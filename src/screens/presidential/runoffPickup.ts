// The runoff pickup measure and its colour bands.
//
// ⚠ A SEPARATE MODULE BECAUSE THESE ARE NOT COMPONENTS. `react-refresh/only-export-components`
// warns on a `.tsx` that exports both, and the warning is worth obeying rather than silencing:
// the measure is also what the tests assert on directly, and a rule that has to be imported
// from a component file is a rule that will eventually be re-implemented next to its caller.
//
// ⚠⚠ THE MEASURE IS ARITHMETIC, NOT AN INFERENCE. „The winner's gain here equals 62% of the
// votes the eliminated pairs held here" divides two published protocol figures. It is NOT „62%
// of those voters went to the winner" — that is a claim about individuals, and the only thing
// in this feature entitled to make one is the estimated matrix, with its caveat attached.

import type { RunoffOblast } from "@/data/presidential/useRunoffTransfer";

/**
 * The winner's gain as a fraction of the votes the eliminated pairs held here.
 *
 * ⚠ NULL RATHER THAN 0 WHERE NOBODY WAS ELIMINATED. A runoff between the only two pairs who
 * stood has no pool, and 0 would read as „the winner picked up none of it" — a statement about
 * a place, where the truth is that the question does not apply there.
 *
 * ⚠ THE DENOMINATOR IS THE POOL, NOT THE VALID VOTE. A share-point swing would mostly measure
 * the field narrowing from 23 pairs to 2 — Радев went 49.4% → 67.7% nationally, and nearly
 * that everywhere — which says nothing about anywhere in particular.
 */
export const pickupRatio = (o: RunoffOblast): number | null =>
  o.elim > 0 ? (o.w2 - o.w1) / o.elim : null;

export type PickupBand = { max: number; color: string; key: string };

/** ⚠ FIXED BANDS, NOT QUANTILES. A quantile scale re-colours the same country every cycle, so
 *  two cycles' maps could not be compared even though the measure is identical.
 *
 *  ⚠ THE FIRST BAND IS THE ONLY EXCLUSIVE ONE (`ratio < 0`); the rest are `ratio <= max`. A
 *  gain of exactly zero is not a loss, and with `<= 0` it took the band the legend labels
 *  „загуба на гласове" — a false statement about the place it coloured. Vanishingly unlikely
 *  at oblast scale, which is precisely why it would never have been noticed. */
export const PICKUP_BANDS: PickupBand[] = [
  { max: 0, color: "#b91c1c", key: "neg" }, // red-700 — the winner LOST votes here
  { max: 0.25, color: "#fde68a", key: "q1" }, // amber-200
  { max: 0.5, color: "#a3e635", key: "q2" }, // lime-400
  { max: 0.75, color: "#22c55e", key: "q3" }, // green-500
  { max: Infinity, color: "#15803d", key: "q4" }, // green-700
];

/** ⚠ NO FALLBACK ARM. The last band's `max` is `Infinity`, so `find` cannot come back empty —
 *  a `?? PICKUP_BANDS.at(-1)!` would be dead code carrying a non-null assertion that hides
 *  the day somebody changes that bound. */
export const bandFor = (ratio: number | null): PickupBand | null => {
  if (ratio === null) return null;
  if (ratio < 0) return PICKUP_BANDS[0];
  return PICKUP_BANDS.find((b) => b.key !== "neg" && ratio <= b.max) ?? null;
};

/** ⚠ EACH ROUND AGAINST ITS OWN PUBLISHED ROLL. `reg1` and `reg2` differ — by up to 6% in
 *  Софийска област in 2006 — so one denominator for both invents a turnout change. */
export const turnoutRate = (voters: number, roll: number): number | null =>
  roll > 0 ? voters / roll : null;
