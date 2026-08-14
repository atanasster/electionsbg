// The ONE place for the rules of reading a ministry expenditure series. Three
// exports, and a caller usually needs more than one:
//
//   `ministryEurSeries`        — HOW to turn `data.years` into plottable points.
//                                Every consumer wants the same map+filter+sort, and
//                                before this it was retyped in six tiles.
//   `ministryYearSeriesEur`    — WHICH FIGURE for one year (expenditureLaw ??
//                                expenditure). Every cross-year read needs it; see
//                                the МОСВ 2024 case below.
//   `latestCompleteFiscalYear` — WHICH YEAR, when that figure will be DIVIDED by
//                                something measured from the contracts corpus.
//                                Reading a series alone does not need it; ANY
//                                budget÷corpus ratio does, and picking the year by
//                                hand is how the regional hero came to publish a
//                                0,9% pass-through share that was really 2,4%.
//
// ── Rule 1: which figure ────────────────────────────────────────────────────
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

/** One plottable point of a ministry expenditure series. */
export interface MinistryYearPoint {
  fiscalYear: number;
  eur: number;
}

/** `data.years` → the (fiscalYear, €) points, ascending, years with no
 *  appropriation dropped. The ONE way to build the series, so a change to what
 *  counts as a plottable year (dropping €0 shells, say — which
 *  scripts/db/gen_procurement/sector_stats.ts deliberately does) lands in one
 *  place instead of in six tiles that each retyped the same hand-written type
 *  predicate.
 *
 *  Callers that want a specific ROW pass the result to
 *  `latestCompleteFiscalYear`; callers that want a trend use it directly. */
export const ministryEurSeries = (
  years:
    | readonly {
        fiscalYear: number;
        expenditure?: { amountEur?: number | null } | null;
        expenditureLaw?: { amountEur?: number | null } | null;
      }[]
    | undefined
    | null,
): MinistryYearPoint[] =>
  (years ?? [])
    .map((y) => ({ fiscalYear: y.fiscalYear, eur: ministryYearSeriesEur(y) }))
    .filter((p): p is MinistryYearPoint => p.eur != null)
    .sort((a, b) => a.fiscalYear - b.fiscalYear);

// ── Rule 3: which year, for a budget ÷ corpus ratio ─────────────────────────

/** The newest fiscal year whose CALENDAR year has fully elapsed, plus whether that
 *  is actually what it found — the only year a ministry's annual appropriation may
 *  be divided by something measured from the contracts corpus.
 *
 *  The appropriation is a whole-year figure the moment the budget law passes, while
 *  anything counted from the register stops at the last ingested contract. So the
 *  CURRENT year pairs twelve months of budget with however much of the year has
 *  happened, and the ratio is short by the remaining fraction with nothing marking
 *  it. Measured 2026-08-13 on МРРБ: 2026 gave €9.18M / €1,058.6M = 0.87% against
 *  2025's €25.72M / €1,058.6M = 2.43% — the pass-through share, which is that
 *  sector's whole thesis, understated 2.8× on its own hero tile.
 *
 *  Reading a budget series ALONE needs no such filter — the current year's enacted
 *  line is a real figure and belongs in a trend. This is only for the like-for-like
 *  case, which is why it is a separate helper rather than a change to the series
 *  rule above.
 *
 *  ⚠ RETURNS `{ row, complete }` RATHER THAN THE ROW, and `complete` is the whole
 *  point of the shape. When every year present is current-or-later it falls back to
 *  the newest one so a just-started series still renders — and on that branch the
 *  year is NOT complete and any ratio built from it is understated exactly as above.
 *  A caller that CAPTIONS its basis must branch on this and say which it got:
 *  asserting „последната приключила година" over the fallback certifies in words the
 *  very defect this helper exists to prevent. Destructuring is the point — a caller
 *  cannot reach the row without stepping past the flag.
 *
 *  ⚠ `currentYear` is a PROXY for „the corpus covers that year", and the two are not
 *  the same date. The register lags the calendar by the ingest cadence (contracts is
 *  a ~68-minute reload, not a stream; measured 2026-08-14 the lag was 3 days), so in
 *  the first weeks of January the just-ended year is itself slightly short and the
 *  ratio is understated by roughly that fraction. Accepted deliberately: the
 *  alternative pins every such tile a whole year behind for eleven months. One feed
 *  widens it — `aop-legacy-` is an ANNUAL CSV published after year end — so
 *  re-measure if that arm still contributes to recent years. Pass a corpus-derived
 *  year instead of the clock if a tile ever needs the residual gone.
 *
 *  On a duplicate `fiscalYear` the first row in input order wins; a rollup carries
 *  one row per year, so that is arbitrary rather than meaningful. */
export const latestCompleteFiscalYear = <T extends { fiscalYear: number }>(
  years: readonly T[],
  currentYear: number,
): { row: T; complete: boolean } | null => {
  const newest = (rows: readonly T[]): T | null =>
    rows.reduce<T | null>(
      (best, y) => (best == null || y.fiscalYear > best.fiscalYear ? y : best),
      null,
    );
  const complete = newest(years.filter((y) => y.fiscalYear < currentYear));
  if (complete) return { row: complete, complete: true };
  const fallback = newest(years);
  return fallback ? { row: fallback, complete: false } : null;
};
