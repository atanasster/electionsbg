// The КФП identity, in one place — imported by BOTH `lawPlan.ts` and
// `fy2026Frame.ts`.
//
// The monthly отчет publishes five series and only three of them are flows:
//
//   IV. Бюджетно салдо  =  I. Приходи
//                        − II. Разходи и трансфери
//                        − III. Вноска в общия бюджет на ЕС
//
// `financing` is −IV. So `balance` and `financing` are DERIVED and must be
// recomputed from the three sides, never extrapolated on their own.
//
// This module exists because the identity was open-coded four times across the
// two modules above, and `fy2026Frame.ts` imports `lawPlan.ts` — so the
// "one definition" `FRAME_SIDES` was created to be could not be reached from
// half of the code that needed it. Both now import from here.
//
// Measured across the whole committed feed (60 periods, 2021-07 … 2026-06) the
// identity holds with a maximum residual of €1 — a rounding residue on figures
// in the tens of billions, not a tolerance band.

/** The three КФП flow sections, in the order of the identity above. Every
 *  guard, derivation, thrown message and caption reads this, so a fourth
 *  section cannot be added to one derivation and missed in the other three. */
export const FRAME_SIDES = [
  "revenue",
  "expenditure",
  "euContribution",
] as const;

export type FrameSide = (typeof FRAME_SIDES)[number];

/** "revenue - expenditure - euContribution", derived from `FRAME_SIDES` so the
 *  prose cannot drift from the arithmetic. */
export const BALANCE_FORMULA = FRAME_SIDES.join(" - ");

/** `IV = I − II − III`. The ONE arithmetic definition. */
export const kfpBalance = (
  revenueEur: number,
  expenditureEur: number,
  euContributionEur: number,
): number => revenueEur - expenditureEur - euContributionEur;

/** The largest disagreement between a derived balance and the feed's own
 *  published one that is still rounding rather than a re-scoped section.
 *  Measured residual across the corpus: €1. */
export const KFP_IDENTITY_TOLERANCE_EUR = 1000;
