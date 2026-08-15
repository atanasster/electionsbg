// The establishment chart's data step — no React, no Recharts.
//
// Plan: docs/plans/budget-hub-v1.md T9.7. Its own module for the reason the
// trend and the donut have theirs: `ResponsiveContainer` draws nothing at
// width 0 and jsdom has no layout, so the arithmetic is only reachable — and
// only testable — outside the component.

import type { BudgetPersonnelPoint } from "@/data/budget/useBudgetPersonnel";

export interface PersonnelDatum {
  year: number;
  total: number | null;
  filled: number | null;
  vacantPct: number | null;
}

/** The chart's data step, exported so it can be tested — `ResponsiveContainer`
 *  draws nothing at width 0 and jsdom has no layout, so the rendered series is
 *  unreachable from a component test. */
export const buildPersonnelSeries = (
  points: BudgetPersonnelPoint[],
): PersonnelDatum[] =>
  points.map((p) => ({
    year: p.fiscalYear,
    total: p.positionsTotal,
    // DERIVED when the source does not publish it. The 2017 Доклад gives
    // `total 139 665` and `vacant 10 760` and no `filled` — and the difference
    // is exactly what „filled" means, so passing NULL through drops the first
    // bar AND moves the shared axis floor from 120 000 to 125 000, changing
    // every OTHER bar's height too. The pre-migration tile derives it the same
    // way; without this the two charts disagree about the first year, the
    // baseline and the gridlines while both are live.
    filled:
      p.positionsFilled ??
      (p.positionsVacant != null && p.positionsTotal != null
        ? p.positionsTotal - p.positionsVacant
        : null),
    // Computed from the SOURCE's own two figures rather than read from the
    // vacancy column, so the dashed line cannot disagree with the bars beneath
    // it — and NULL rather than 0 when either is missing, because „0% незаети"
    // is the healthiest number in the series and completely false.
    vacantPct:
      p.positionsVacant != null &&
      p.positionsTotal != null &&
      p.positionsTotal !== 0
        ? (p.positionsVacant / p.positionsTotal) * 100
        : null,
  }));

/** Axis ticks. Thousands, because the whole series lives between 139k and 146k
 *  and a full-precision tick label wraps a 42px gutter. */
