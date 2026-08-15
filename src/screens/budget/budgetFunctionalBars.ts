// The COFOG chart's rows — the data half.
//
// Plan: docs/plans/budget-hub-v1.md T9.1. Extracted rather than inlined in the
// screen for the reason `budgetSlices` and `budgetPersonnelSeries` were:
// `ResponsiveContainer` renders nothing at width 0 and the headless environment
// reports exactly that, so a chart's correctness is only ever testable at its
// data layer. Inline in the screen, the two properties that matter here — that
// nothing is collapsed, and that the bars are shares of the WHOLE — are
// satisfied by the ranked `<ul>` beside the chart whatever the chart does.

/** The subset of a `budget_cofog_list` row this needs. */
export interface FunctionalRow {
  code: string;
  amount: number | null;
  /** Share of the total, 0-100. Basis-independent — the page offers euro and
   *  %-of-GDP and this is the same on both, which is what lets the axis stay a
   *  fixed 0-100%. */
  pctOfTotal: number | null;
}

export interface FunctionalBar {
  code: string;
  label: string;
  pct: number;
  /** Already formatted in the SELECTED basis by the caller. Re-deriving it here
   *  would be a second copy of a basis rule. */
  amountLabel: string;
}

/**
 * Build the bar set.
 *
 * ⚠️ EVERY ROW WITH A SHARE, AND NO TAIL COLLAPSE. This is the one place the
 * decision lives, and it is the reason the page uses a bar chart rather than
 * the composition donut: that one folds everything past seven slices into
 * „Други", and on the real corpus the bottom three are Жилищно строителство
 * (2.6%), Култура, отдих и религия (1.8%) and Опазване на околната среда
 * (1.6%) — 6.0%
 * between them, and three policy areas a reader may have come specifically to
 * find. Length encodes the share, so ten bars need no colour vocabulary and
 * nothing has to be hidden to keep the picture readable.
 *
 * A row with no share is dropped: there is no length to draw, and drawing it at
 * zero would say the function received nothing.
 *
 * Sorted descending — the order IS the finding. `budget_cofog_list` orders by
 * `amount DESC NULLS LAST`, so on any basis that cannot resolve every amount the
 * rows tie at NULL and silently fall back to CODE order: „Общи държавни служби
 * 7,5%" above „Социална закрила 36,8%", with both percentages correct.
 * `pctOfTotal` is basis-independent and always present, so it is the safe key.
 * The list on `/budget/functional` sorts by the same rule and defers to this
 * comment for the why.
 */
export const functionalBars = (
  rows: FunctionalRow[],
  label: (code: string) => string,
  amountLabel: (amount: number | null) => string,
): FunctionalBar[] =>
  rows
    .filter((r) => r.pctOfTotal != null && Number.isFinite(r.pctOfTotal))
    .map((r) => ({
      code: r.code,
      label: label(r.code),
      pct: r.pctOfTotal as number,
      amountLabel: amountLabel(r.amount),
    }))
    .sort((a, b) => b.pct - a.pct);

/** The Y axis is 150px wide and the longest COFOG label is „Жилищно
 *  строителство и благоустройство" — 38 characters, roughly 205px at 11px.
 *  Recharts neither wraps nor ellipsises a category tick: the `<text>` runs to a
 *  negative x and the SVG's `overflow: hidden` clips it, so a third of that name
 *  disappeared with nothing to show it had. This is the count that fits. */
export const TICK_MAX_CHARS = 24;

/**
 * Shorten an axis label that the axis cannot hold, and MARK that it was
 * shortened.
 *
 * Truncation is defensible here and would not be elsewhere: the ranked `<ul>`
 * directly beneath the chart carries every full label, figure and share, and the
 * tick's `<title>` carries the full name too. What is not defensible is clipping
 * silently at a pixel boundary — which is what shipped first, on one of the
 * three small functions the whole „bar, not donut" argument is built on.
 *
 * Lives here rather than beside the component so the component file exports
 * components only (react-refresh), and so the guarantee is testable over the
 * whole label set rather than over a fixture.
 */
export const truncateTick = (s: string): string =>
  s.length > TICK_MAX_CHARS ? `${s.slice(0, TICK_MAX_CHARS - 1)}…` : s;
