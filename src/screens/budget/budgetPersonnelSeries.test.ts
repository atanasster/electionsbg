// Gates for the establishment chart's data step (plan T9.7).
//
// `ResponsiveContainer` draws nothing at width 0 and jsdom has no layout, so
// the rendered series cannot be reached from a component test. The arithmetic
// is tested here instead, and it is where the one real trap lives:
//
//   * A ZERO VACANCY RATE IS THE HEALTHIEST NUMBER IN THE SERIES AND WOULD BE
//     FALSE. A `?? 0` on a year the source cannot support draws the dashed
//     line to the floor and reads as a year with no vacancies at all.
//     (NOTE: 2017 is NOT that year — an earlier draft of this comment said it
//     was. 2017 publishes `filled: NULL` but `vacant: 10 760`, so the rate is
//     perfectly computable at 7.70% and it is the BAR that needs deriving.)
//   * A MISSING `filled` DROPPED RATHER THAN DERIVED. 2017 gives total and
//     vacant and no filled; the difference is exactly what „filled" means.
//     Passing NULL through loses the first bar AND — because the bars share
//     the left axis — moves its floor from 120 000 to 125 000, changing every
//     other bar's height. The pre-migration tile derives it, and both charts
//     are live.

import { describe, it, expect } from "vitest";
import { buildPersonnelSeries } from "./budgetPersonnelSeries";
import type { BudgetPersonnelPoint } from "@/data/budget/useBudgetPersonnel";

const pt = (
  fiscalYear: number,
  positionsTotal: number | null,
  positionsFilled: number | null,
  positionsVacant: number | null,
): BudgetPersonnelPoint =>
  ({
    fiscalYear,
    positionsTotal,
    positionsFilled,
    positionsVacant,
    nsiHeadcount: null,
    payrollEur: null,
  }) as BudgetPersonnelPoint;

describe("buildPersonnelSeries", () => {
  it("computes the vacancy rate from the source's own two figures", () => {
    // FY2025 verbatim: 12 348 / 145 623 = 8.4794…%, which the page rounds to
    // 8.5% — the same figure the vacancy sentence above the chart prints, so
    // the two cannot disagree.
    const [d] = buildPersonnelSeries([pt(2025, 145623, 133275, 12348)]);
    expect(d.vacantPct).toBeCloseTo(8.4794, 3);
    expect((d.vacantPct as number).toFixed(1)).toBe("8.5");
    expect(d.total).toBe(145623);
    expect(d.filled).toBe(133275);
  });

  it("leaves the rate NULL when the source cannot support one", () => {
    // Not 0. A zero draws the dashed line to the floor and reads as a year
    // with no vacancies — the best number in the series, and false.
    expect(
      buildPersonnelSeries([pt(2017, 139665, null, null)])[0].vacantPct,
    ).toBeNull();
    expect(
      buildPersonnelSeries([pt(2017, null, null, 6316)])[0].vacantPct,
    ).toBeNull();
  });

  it("does not divide by a zero establishment", () => {
    expect(buildPersonnelSeries([pt(2030, 0, 0, 0)])[0].vacantPct).toBeNull();
  });

  it("keeps the years in the order it was given", () => {
    // The chart's X axis is categorical, so the array order IS the axis order.
    // DESCENDING input on purpose: given an already-ascending fixture a
    // `sort()` inside the builder survives this test, which is exactly what a
    // mutation check found.
    const out = buildPersonnelSeries([
      pt(2025, 145623, 133275, 12348),
      pt(2024, 145802, 132392, 13410),
      pt(2023, 143502, 130000, 13502),
    ]);
    expect(out.map((d) => d.year)).toEqual([2025, 2024, 2023]);
  });

  it("derives `filled` when the source publishes only total and vacant", () => {
    // FY2017 verbatim: 139 665 total, 10 760 vacant, filled NULL. The bar is
    // 128 905 — and without it the shared left axis floors 5 000 lower, so
    // every other bar in the chart changes height too.
    const [d] = buildPersonnelSeries([pt(2017, 139665, null, 10760)]);
    expect(d.filled).toBe(128905);
    // …and the rate is computable there, from total and vacant.
    expect(d.vacantPct).toBeCloseTo(7.704, 3);
  });

  it("does not invent `filled` when there is nothing to derive it from", () => {
    // No vacant figure means no difference to take. A 0 bar beside 145k reads
    // as the administration having been abolished that year.
    expect(
      buildPersonnelSeries([pt(2019, 142747, null, null)])[0].filled,
    ).toBeNull();
  });

  it("carries a null total through rather than substituting zero", () => {
    // A zero bar beside 145k reads as the administration having been abolished.
    const [d] = buildPersonnelSeries([pt(2019, null, null, null)]);
    expect(d.total).toBeNull();
    expect(d.filled).toBeNull();
  });
});
