// Donut slices for a КФП section — the data half.
//
// Plan: docs/plans/budget-hub-v1.md T9.6. The pre-migration screen showed
// revenue as a donut of tax TYPES; the migrated page ranks the four depth-0
// groups as bars, which is a coarser cut — „Данъчни приходи €22.8bn" is 86% of
// the section and answers almost nothing.
//
// THE SLICE SET IS NOT THE LINE SET, and the difference is the whole module:
//
//   * DEPTH 0 AND DEPTH 1 ARE THE SAME MONEY. Every depth-1 line is already
//     inside its depth-0 subtotal, so a donut built from all lines double-counts
//     by roughly 2x and every percentage is half what it should be. The slices
//     are the depth-1 lines of ONE chosen group plus the OTHER depth-0
//     subtotals — never both levels of the same branch.
//   * THERE IS A THIRD LEVEL, and it is why depth-1 SUBTOTALS belong in the
//     slice set rather than being filtered out. Expenditure carries nine
//     depth-2 rows: „Лихви - общо" is a depth-1 subtotal whose two children
//     („Лихви по външни/вътрешни заеми") sit at depth 2, and „Предоставени на:"
//     is another under „Трансфери (нето)". Excluding depth-1 subtotals dropped
//     €708.9m of FY2025 interest — 2.50% of the section — with nothing to
//     replace it, and inflated every other share to compensate. Their children
//     are at depth 2 and this module never selects that depth, so including
//     them cannot double-count.
//   * A DONUT WITH TWENTY SLICES IS A LEGEND. The tail collapses into one
//     „other" slice, and the collapse is by VALUE so the named slices are
//     always the ones worth naming.

/** One КФП line, as `budget_snapshot()` ships it — labels NULLABLE, which is
 *  the payload's real shape (`BudgetSnapshotLine`). A line with no Bulgarian
 *  label has no name to put in a legend, so it is dropped rather than rendered
 *  as an unlabelled wedge. */
export interface SnapshotLine {
  depth: number;
  isSubtotal: boolean;
  groupLabelBg: string | null;
  labelBg: string | null;
  labelEn: string | null;
  executedEur: number | null;
}

export interface Slice {
  labelBg: string;
  labelEn: string;
  value: number;
  /** True for the collapsed tail, so a consumer can style or caption it as an
   *  aggregate rather than as a line the Ministry publishes. */
  isOther: boolean;
  /** How many source lines this slice folds. 1 for a real line. */
  lineCount: number;
}

/** Named slices before the tail collapses. Seven plus „other" is the most a
 *  donut reads at a glance; the legacy tile used the same number. */
export const DEFAULT_MAX_SLICES = 7;

/**
 * Build the slice set.
 *
 * @param lines      every line of ONE section, both depths.
 * @param expandGroup the depth-0 subtotal to open up — its depth-1 children
 *                    become slices and the subtotal itself is dropped, since
 *                    it is exactly their sum. Every OTHER depth-0 line stays
 *                    whole.
 * @param maxSlices  named slices before the tail collapses.
 *
 * Returns [] when there is nothing to draw: no lines, or every value null or
 * zero. A snapshot exists for a period too early to carry revenue, and a donut
 * of zeroes renders as one full circle of „other".
 */
export const buildSlices = (
  lines: SnapshotLine[],
  expandGroup: string | null,
  maxSlices: number = DEFAULT_MAX_SLICES,
): Slice[] => {
  const positive = (v: number | null | undefined): number =>
    v != null && Number.isFinite(v) && v > 0 ? v : 0;
  const norm = (v: string | null | undefined): string =>
    (v ?? "").replace(/\s+/g, " ").trim();

  // The expanded group's children…
  const children = expandGroup
    ? lines.filter(
        (l) =>
          l.depth === 1 &&
          // NORMALISED on both sides. `groupLabelBg` carries the same padding
          // as `labelBg` — the corpus has „Трансфери  (нето)" and „Външно
          // финансиране  (нето)" with double spaces — so a raw comparison here
          // would silently match nothing and drop the whole opened branch.
          norm(l.groupLabelBg) === expandGroup,
      )
    : [];
  // …and every depth-0 line EXCEPT the one we just opened. Dropping it is what
  // keeps the total right: it is the sum of the children now standing in for it.
  const others = lines.filter(
    (l) =>
      l.depth === 0 && (expandGroup == null || norm(l.labelBg) !== expandGroup),
  );

  const all = [...children, ...others]
    .map((l) => ({
      // The source pads labels with runs of spaces — „Данъци върху  дивидентите"
      // carries a double space, and МФ's own „Трансфери  (нето)" is the reason
      // an earlier lookup in this module family matched nothing.
      labelBg: norm(l.labelBg),
      labelEn: norm(l.labelEn),
      value: positive(l.executedEur),
    }))
    // An unlabelled line cannot be a legend row. Dropping it also drops its
    // money, which is why the shares are taken against `slicesTotal` and never
    // against the section total.
    .filter((s) => s.labelBg !== "")
    .map((s) => ({ ...s, labelEn: s.labelEn || s.labelBg }))
    // A negative or zero line cannot be a wedge. „Резерв" nets negative in
    // several years and would render as an inverted arc.
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  // No early return for an empty `all`: `top` and `tail` are then both empty,
  // no „other" slice is pushed, and the result is [] by construction. A guard
  // here would be dead code that reads like a decision.
  const top = all.slice(0, maxSlices);
  const tail = all.slice(maxSlices);
  const slices: Slice[] = top.map((s) => ({
    ...s,
    isOther: false,
    lineCount: 1,
  }));

  if (tail.length > 0) {
    slices.push({
      labelBg: "Други",
      labelEn: "Other",
      value: tail.reduce((sum, s) => sum + s.value, 0),
      isOther: true,
      lineCount: tail.length,
    });
  }
  return slices;
};

/** The slices' own sum. A consumer must caption against THIS, not against the
 *  section total: negative and zero lines are dropped above, so on a section
 *  carrying a negative reserve the two differ and percentages taken against
 *  the section total would not reach 100%. */
export const slicesTotal = (slices: Slice[]): number =>
  slices.reduce((sum, s) => sum + s.value, 0);
