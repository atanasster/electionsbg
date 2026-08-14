// The ONE rule for reading a ministry's expenditure ACROSS years.
//
// `MinistryRollupYear` carries two appropriation figures and they are not
// interchangeable:
//
//   `expenditure`     — the отчет's own „Закон" column where a report exists,
//                       the ЗДБ otherwise. Same scope as `execution`, so it is
//                       the right basis for THIS year's variance.
//   `expenditureLaw`  — the State Budget Law's own section II figure, written
//                       only where the two disagree.
//
// A ministry's отчет often restates the appropriation at a CONSOLIDATED scope
// (own + EU funds + transfers) that is materially wider than the law's section
// II. That is correct within a row — it keeps law→amended→executed
// like-with-like (see scripts/budget/execution_facts.ts) — and wrong across
// years, because only отчет-years carry it. A trend built on `expenditure`
// therefore steps up in whichever years a report happened to land, and the step
// reads as budget growth.
//
// Measured 2026-08-13 over the whole facts tree, exactly one ministry-year
// diverges: МОСВ 2024, ЗДБ €60,325,488 vs отчет €104,230,071 (+72.8%). It was
// the tallest bar in the МОСВ budget chart and, once /governance/sectors moved
// the environment tile onto a budget basis, would have been its `y:2024`
// headline.

/** The euro figure to plot for one year of a ministry expenditure SERIES.
 *  Returns null when the year carries no appropriation at all.
 *
 *  Structurally typed rather than taking `MinistryRollupYear`, so the Node-side
 *  generator (which reads the raw JSON and has its own `Money` shape) and the
 *  browser both call the ONE implementation instead of restating the rule. */
export const ministryYearSeriesEur = (y: {
  expenditure?: { amountEur?: number | null } | null;
  expenditureLaw?: { amountEur?: number | null } | null;
}): number | null =>
  y.expenditureLaw?.amountEur ?? y.expenditure?.amountEur ?? null;
