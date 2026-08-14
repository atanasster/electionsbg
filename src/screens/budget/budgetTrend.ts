// The КФП execution trend, and the seasonal projection that extends it to
// December — the data half, with no React and no Recharts in it.
//
// Plan: docs/plans/budget-hub-v1.md T9.2. This is the pre-migration
// `BudgetTrendTile`'s arithmetic, lifted out so the legacy tile (on
// /budget/deep-dive, fed by kfp.json) and the new `/budget/execution` chart (fed
// by `budget_series()` out of Postgres) cannot drift apart. T9's own audit
// warned about exactly that: nine legacy tiles now have PG-backed twins, and a
// projection computed twice is a page that disagrees with itself about how the
// year ends.
//
// THE SERIES IS CUMULATIVE YEAR-TO-DATE and resets every January. That is not a
// rendering detail: summing periods double-counts by roughly n(n+1)/2, and a
// chart that runs across a year boundary without the reset looks like a
// collapse every 1 January. `budget_series()` carries `cumulative: true` in its
// payload rather than leaving it to a consumer's memory.

/** One observation, normalised. Both feeds reduce to this: the JSON tile maps
 *  `executed.amountEur`, the PG route already ships `executedEur`. */
export interface TrendPoint {
  fiscalYear: number;
  period: string;
  series: string;
  executedEur: number | null;
}

export interface TrendDatum {
  period: string;
  revenue: number | null;
  expenditure: number | null;
  /** ONE bar series, carrying the actual on past months and the projection on
   *  future ones. Two parallel `<Bar>`s would make Recharts group them
   *  side-by-side and shift the actual bars off their line dots; the projected
   *  slice is dimmed per-cell via `isProjected` instead. */
  balanceBar: number | null;
  /** Null on actual months, populated on projected ones PLUS the join month,
   *  so the dashed path starts on the last solid point instead of a gap. */
  revenueProj: number | null;
  expenditureProj: number | null;
  isProjected: boolean;
}

/** Curated lifetime markers — events with a dateable fiscal-execution
 *  implication. Keep the list tight (≤10 lifetime) so the chart stays a chart
 *  and not a timeline. Each `period` must match a rendered "YYYY-MM" tick
 *  exactly or the ReferenceLine lands off-axis. */
export const BUDGET_EVENTS: Array<{
  period: string;
  labelBg: string;
  labelEn: string;
}> = [
  { period: "2020-03", labelBg: "COVID", labelEn: "COVID" },
  { period: "2022-02", labelBg: "Война", labelEn: "Ukraine war" },
  { period: "2024-06", labelBg: "Избори", labelEn: "Election" },
  { period: "2024-10", labelBg: "Избори", labelEn: "Election" },
  { period: "2026-01", labelBg: "Еврозона", labelEn: "Eurozone" },
  { period: "2026-04", labelBg: "Избори", labelEn: "Election" },
];

export const fyOf = (period: string): number =>
  parseInt(period.slice(0, 4), 10);
export const monthOf = (period: string): number =>
  parseInt(period.slice(5, 7), 10);

interface MonthlyValues {
  revenue: number | null;
  expenditure: number | null;
  euContribution: number | null;
  balance: number | null;
}

/** Index a flat point list by [fy, month]. The projection reads prior-year
 *  months the in-progress year has not reached yet. */
const indexByFyMonth = (points: TrendPoint[]): Map<string, MonthlyValues> => {
  const out = new Map<string, MonthlyValues>();
  for (const p of points) {
    const k = `${p.fiscalYear}-${monthOf(p.period)}`;
    let v = out.get(k);
    if (!v) {
      v = {
        revenue: null,
        expenditure: null,
        euContribution: null,
        balance: null,
      };
      out.set(k, v);
    }
    if (p.series === "revenue") v.revenue = p.executedEur;
    else if (p.series === "expenditure") v.expenditure = p.executedEur;
    else if (p.series === "euContribution") v.euContribution = p.executedEur;
    else if (p.series === "balance") v.balance = p.executedEur;
  }
  return out;
};

const emptyDatum = (period: string, isProjected: boolean): TrendDatum => ({
  period,
  revenue: null,
  expenditure: null,
  balanceBar: null,
  revenueProj: null,
  expenditureProj: null,
  isProjected,
});

/**
 * Build the chart series.
 *
 * @param points     what to DRAW — already narrowed to the window on screen.
 * @param allPoints  what to project FROM — the whole corpus, because the
 *                   seasonal anchor is the prior fiscal year and that year may
 *                   be outside the drawn window entirely.
 *
 * The projection scales the prior complete year's monthly shape by how far
 * ahead or behind this year is at the same month:
 *
 *     ratio            = actualAtLatestMonth / priorAtLatestMonth
 *     projectedAtMonth = priorAtMonth × ratio
 *
 * PER SERIES, not once — revenue is corporate-tax-backloaded while expenditure
 * runs closer to linear, so one shared ratio would bend them the same way and
 * make the projected deficit an artefact of the arithmetic. The balance is then
 * the RESIDUAL of the projected terms (rev − exp − EU) rather than its own
 * scaled series, so the projected months satisfy the same identity as the
 * actual ones.
 *
 * Returns actuals unchanged when there is nothing to project from: a complete
 * year, or a prior year missing either the anchor month or December. Silently —
 * a chart with no dashed tail is the honest rendering of „we cannot say".
 */
export const buildTrendData = (
  points: TrendPoint[],
  allPoints: TrendPoint[],
): TrendDatum[] => {
  const byPeriod = new Map<string, TrendDatum>();
  for (const p of points) {
    let d = byPeriod.get(p.period);
    if (!d) {
      d = emptyDatum(p.period, false);
      byPeriod.set(p.period, d);
    }
    if (p.series === "revenue") d.revenue = p.executedEur;
    else if (p.series === "expenditure") d.expenditure = p.executedEur;
    else if (p.series === "balance") d.balanceBar = p.executedEur;
  }
  const sorted = [...byPeriod.values()].sort((a, b) =>
    a.period.localeCompare(b.period),
  );
  if (sorted.length === 0) return sorted;

  const last = sorted[sorted.length - 1];
  const currentFy = fyOf(last.period);
  const currentLatestMonth = monthOf(last.period);
  // Month 12 is the whole year; there is no tail to draw.
  if (currentLatestMonth >= 12) return sorted;

  const idx = indexByFyMonth(allPoints);

  // WALK BACK to the newest prior year that can actually anchor, rather than
  // hard-coding FY−1. Two reasons, both from the corpus:
  //
  //   * A YEAR CAN HAVE A HOLE. FY2021 publishes 06,07,08,10,11,12 — no
  //     September. Anchored on FY−1 alone, a FY2022 chart at September finds
  //     no same-month figure and silently loses its tail, while the table
  //     beside it still prints a projected December.
  //   * IT MATCHES THE INGEST. `scripts/budget/kfp.ts:projectFigures()` — the
  //     producer of the `projected` rows this page's own table renders — walks
  //     back to the newest COMPLETE prior year and publishes which one it used
  //     in `budget_fiscal_year.projection_basis`. A chart on a different anchor
  //     is a dashed line that disagrees with the number above it.
  //
  // ONE object, not two variables: the ratio's denominator (the same month)
  // and the year-end it scales toward (December) are a PAIR, and returning
  // them together makes „both or neither" structural instead of a condition
  // somebody has to keep re-checking. Written as two nullable locals, half the
  // guard was redundant and a mutation deleting it stayed green.
  //
  // Bounded at five years: past that the seasonal shape is not the same
  // country's budget, and no tail beats a tail scaled from 2019.
  const anchor = ((): {
    fy: number;
    atLatest: MonthlyValues;
    atDec: MonthlyValues;
  } | null => {
    for (let back = 1; back <= 5; back++) {
      const fy = currentFy - back;
      const atLatest = idx.get(`${fy}-${currentLatestMonth}`);
      const atDec = idx.get(`${fy}-12`);
      if (atLatest && atDec) return { fy, atLatest, atDec };
    }
    return null;
  })();
  if (!anchor) return sorted;
  const { fy: priorFy, atLatest: priorAtLatest } = anchor;

  const ratio = (actual: number | null, prior: number | null): number | null =>
    actual == null || prior == null || prior === 0 ? null : actual / prior;

  const ratioRev = ratio(last.revenue, priorAtLatest.revenue);
  const ratioExp = ratio(last.expenditure, priorAtLatest.expenditure);
  // The EU contribution is never drawn but feeds the balance residual, and the
  // „it is small" argument has to name the RIGHT denominator: it is 3.3-5.0% of
  // expenditure but 24.5-38.4% of the BALANCE, which is what the bar draws.
  // The fallback is safe because the ratio itself is near 1 (1.076 on the live
  // corpus, so using 1 moves the projected bar by 2.3%), not because the term
  // is small. Falling back rather than dropping the balance is deliberate: a
  // missing EU ratio would otherwise blank the bar on exactly the months the
  // reader is asking about.
  const currentEu = idx.get(
    `${currentFy}-${currentLatestMonth}`,
  )?.euContribution;
  const ratioEu = ratio(currentEu ?? null, priorAtLatest.euContribution) ?? 1;

  // Join the dashed path to the last solid point. NOT for the bar: a bar is a
  // discrete rect per month, so painting the join month twice renders two
  // stacked rects — visible as one doubled, darker bar.
  last.revenueProj = last.revenue;
  last.expenditureProj = last.expenditure;

  for (let m = currentLatestMonth + 1; m <= 12; m++) {
    const priorMonth = idx.get(`${priorFy}-${m}`);
    if (!priorMonth) continue;
    const period = `${currentFy}-${String(m).padStart(2, "0")}`;
    const projRev =
      ratioRev != null && priorMonth.revenue != null
        ? Math.round(priorMonth.revenue * ratioRev)
        : null;
    const projExp =
      ratioExp != null && priorMonth.expenditure != null
        ? Math.round(priorMonth.expenditure * ratioExp)
        : null;
    const projEu =
      priorMonth.euContribution != null
        ? Math.round(priorMonth.euContribution * ratioEu)
        : 0;
    const datum = emptyDatum(period, true);
    datum.revenueProj = projRev;
    datum.expenditureProj = projExp;
    datum.balanceBar =
      projRev != null && projExp != null ? projRev - projExp - projEu : null;
    sorted.push(datum);
  }

  return sorted;
};
