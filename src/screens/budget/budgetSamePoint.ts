// „At this point in the year" — the cross-year comparison, data half.
//
// Plan: docs/plans/budget-hub-v1.md T9.3. The pre-migration screen carried this
// beside the trend and the hub migration dropped it entirely; no new page had
// it. It answers the one question the trend cannot: is this year unusual, or
// does it only look unusual because it is half-finished?
//
// THE WHOLE POINT IS THE ANCHOR. КФП figures are cumulative year-to-date, so
// comparing a June figure against previous DECEMBERS shows a collapse every
// time. Every year here is cut at the SAME calendar month the current year has
// reached, which is the only comparison that means anything mid-year — and the
// reason a „% of plan" badge sits beside it, since the nominal figures grow
// with inflation and the budget alike.

import { fyOf, monthOf, type TrendPoint } from "./budgetTrend";

/** A trend point that also carries the year's statutory plan. `budget_series()`
 *  ships `plannedEur` on every row; the „% of plan" badge is the whole reason
 *  this module takes the richer shape instead of `TrendPoint`. */
export interface SamePointInput extends TrendPoint {
  plannedEur?: number | null;
}

export interface SamePointRow {
  fiscalYear: number;
  isCurrent: boolean;
  /** Cumulative execution through the anchor month, or null when that year
   *  never published it. */
  value: number | null;
  /** The full-year plan, for the „% of plan" badge. Null on a year running
   *  under an interim law — FY2026 has no plan on any series. */
  plan: number | null;
}

export interface SamePointSeries {
  series: string;
  rows: SamePointRow[];
  /** Median of the PRIOR years' values — the current year is excluded, or it
   *  would be compared against a set containing itself. Null with fewer than
   *  two priors: a „median" of one is that one year, and calling it a norm
   *  invites a verdict the data cannot support. */
  priorMedian: number | null;
  /** The current year against that median, as a percentage — computed on
   *  MAGNITUDES, so a deficit that doubled reads +100% („twice as big") rather
   *  than −100% („half as much"). Null when either side is missing, when the
   *  median is zero, or when `signMismatch` is set. */
  deltaPct: number | null;
  /** True when the current year's SIGN differs from the priors' — a surplus
   *  year against deficit years. The magnitude comparison is meaningless
   *  there („the deficit grew 40%" about a year with no deficit), so the
   *  verdict is withheld and the reason is published rather than looking like
   *  missing data. */
  signMismatch: boolean;
}

export interface SamePoint {
  /** The calendar month every year is cut at, 1-12. */
  month: number;
  currentFiscalYear: number;
  series: SamePointSeries[];
}

/** The minimum prior years for a median to be worth calling one. */
export const MIN_PRIORS_FOR_MEDIAN = 2;

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
};

/**
 * Cut every fiscal year at the current year's latest month and compare.
 *
 * Returns null — meaning „do not render this" — in the two cases where the
 * comparison is not a comparison:
 *
 *   * THE CURRENT YEAR IS COMPLETE. At December there is nothing to anchor:
 *     every year is cut at its own year-end, which is just the annual series
 *     and is already on the page.
 *   * THERE IS NOTHING TO COMPARE AGAINST. One year of data is a bar chart
 *     with one bar.
 *
 * @param points   the WHOLE corpus, every year and every month.
 * @param seriesKeys which series to build panels for, in render order.
 */
export const buildSamePoint = (
  points: SamePointInput[],
  seriesKeys: string[],
): SamePoint | null => {
  if (points.length === 0) return null;

  // The current year is the newest one present, and the anchor is the newest
  // month IT has — never the newest month in the corpus, which on a mixed feed
  // could belong to an older year.
  const currentFiscalYear = Math.max(...points.map((p) => fyOf(p.period)));
  const month = Math.max(
    ...points
      .filter((p) => fyOf(p.period) === currentFiscalYear)
      .map((p) => monthOf(p.period)),
  );
  if (!Number.isFinite(month) || month >= 12) return null;

  const at = new Map<string, number | null>();
  const plan = new Map<string, number | null>();
  for (const p of points) {
    if (monthOf(p.period) !== month) continue;
    const k = `${fyOf(p.period)}|${p.series}`;
    at.set(k, p.executedEur);
    // The plan is a FULL-YEAR figure repeated on every monthly row, so reading
    // it at the anchor month is reading the year's plan — not a month's share
    // of it. That is what makes „% of plan" comparable across years cut at
    // June: each is the same fraction question against the same denominator.
    plan.set(k, p.plannedEur ?? null);
  }

  const years = [...new Set(points.map((p) => fyOf(p.period)))].sort(
    (a, b) => a - b,
  );
  if (years.length < 2) return null;

  const series = seriesKeys.map((key): SamePointSeries => {
    const rows = years.map((fy): SamePointRow => {
      const v = at.get(`${fy}|${key}`);
      return {
        fiscalYear: fy,
        isCurrent: fy === currentFiscalYear,
        value: v ?? null,
        plan: plan.get(`${fy}|${key}`) ?? null,
      };
    });
    const priors = rows
      .filter((r) => !r.isCurrent && r.value != null)
      .map((r) => r.value as number);
    const priorMedian =
      priors.length >= MIN_PRIORS_FOR_MEDIAN ? median(priors) : null;
    const current = rows.find((r) => r.isCurrent)?.value ?? null;

    // BOTH SIDES ON MAGNITUDE, which is not the same as an absolute
    // denominator and the difference is a SIGN, not a rounding.
    //
    // The balance is negative in every year of this corpus. Taking
    // `(current − median) / |median|` gives −257% for a deficit that grew from
    // a −€0.5bn median to −€1.9bn — it reads „257% smaller" about a deficit
    // that nearly quadrupled. Comparing |current| against median(|priors|)
    // gives +257%, which is what the pre-migration tile prints today and what
    // the number means. Both pages are live at once, so they have to agree.
    //
    // For revenue and expenditure every value is positive and the two forms
    // are identical, so this is one rule rather than a per-series special case.
    const priorMedianAbs =
      priors.length >= MIN_PRIORS_FOR_MEDIAN
        ? median(priors.map((v) => Math.abs(v)))
        : null;
    // A surplus year against deficit years: the magnitudes are comparable and
    // the comparison is still nonsense.
    const signMismatch =
      current != null &&
      priorMedian != null &&
      Math.sign(current) !== Math.sign(priorMedian);
    const deltaPct =
      current != null &&
      priorMedianAbs != null &&
      priorMedianAbs !== 0 &&
      !signMismatch
        ? ((Math.abs(current) - priorMedianAbs) / priorMedianAbs) * 100
        : null;
    return { series: key, rows, priorMedian, deltaPct, signMismatch };
  });

  return { month, currentFiscalYear, series };
};
