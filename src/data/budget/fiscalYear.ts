// Shared presentation logic for a fiscal year's headline figures, used by
// both the /budget dashboard and the home-page summary tile.

import type { FiscalYearSummary, FiscalYearSeriesFigures } from "./types";

export type FySeries = keyof FiscalYearSeriesFigures;

export interface SeriesView {
  // The figure to headline (full-year actual, projection, or actual-so-far).
  value: number;
  // "actual"    — complete year, full-year actual
  // "projected" — incomplete year, seasonal full-year projection
  // "partial"   — incomplete year, no projection anchorable yet (actual-so-far)
  mode: "actual" | "projected" | "partial";
  planValue: number | null;
  actualSoFar: number | null;
}

export const seriesView = (
  fy: FiscalYearSummary,
  series: FySeries,
): SeriesView => {
  const actual = fy.actual[series]?.amountEur ?? 0;
  const plan = fy.planned?.[series]?.amountEur ?? null;
  if (fy.complete) {
    return {
      value: actual,
      mode: "actual",
      planValue: plan,
      actualSoFar: null,
    };
  }
  const proj = fy.projected?.[series]?.amountEur ?? null;
  if (proj != null) {
    return {
      value: proj,
      mode: "projected",
      planValue: plan,
      actualSoFar: actual,
    };
  }
  return { value: actual, mode: "partial", planValue: plan, actualSoFar: null };
};
