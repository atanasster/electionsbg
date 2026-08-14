// Gates for the composition donut's slice set (plan T9.6).
//
// A donut states shares, so every defect here is a wrong PERCENTAGE presented
// with the authority of a picture:
//
//   * BOTH LEVELS OF THE SAME BRANCH. Every depth-1 leaf is already inside its
//     depth-0 subtotal. Including both roughly doubles the total and halves
//     every share — and the chart still renders perfectly, summing to 100% of
//     a number that is twice the section.
//   * THE OPENED SUBTOTAL LEFT IN. Same failure, narrower: „Данъчни приходи"
//     beside its own children counts that branch twice.
//   * A NEGATIVE LINE AS A WEDGE. „Резерв" nets negative in several years; a
//     negative arc renders inverted or vanishes, and it drags the denominator.
//   * A TAIL THAT LOOKS LIKE A LINE. „Други" is our aggregate, not something
//     МФ publishes, so it has to be marked as one.

import { describe, it, expect } from "vitest";
import {
  buildSlices,
  slicesTotal,
  DEFAULT_MAX_SLICES,
  type SnapshotLine,
} from "./budgetSlices";

const line = (
  depth: number,
  labelBg: string | null,
  executedEur: number | null,
  groupLabelBg: string | null = null,
  isSubtotal = false,
): SnapshotLine => ({
  depth,
  isSubtotal,
  groupLabelBg,
  labelBg,
  labelEn: labelBg ? `${labelBg} EN` : null,
  executedEur,
});

/** The real shape: one subtotal with children, plus sibling subtotals. */
const REVENUE: SnapshotLine[] = [
  line(0, "Данъчни приходи", 22770, null, true),
  line(1, "Данък върху добавената стойност", 11030, "Данъчни приходи"),
  line(1, "Данъци в/у доходите на физически лица", 4180, "Данъчни приходи"),
  line(1, "Акцизи", 3800, "Данъчни приходи"),
  line(1, "Корпоративен данък", 3330, "Данъчни приходи"),
  line(1, "Мита и митнически такси", 200, "Данъчни приходи"),
  line(1, "Данък върху застрахователните премии", 40, "Данъчни приходи"),
  line(1, "Данъци върху  дивидентите", 70, "Данъчни приходи"),
  line(1, "Други данъци", 120, "Данъчни приходи"),
  line(0, "Неданъчни приходи", 2670, null, true),
  line(0, "Помощи", 260, null, true),
];

/** EXPENDITURE, which is the shape revenue does not have and where the live
 *  bug was: a depth-1 SUBTOTAL („Лихви - общо") whose own children sit at
 *  DEPTH 2, plus a sibling depth-0 group that also has depth-1 and depth-2
 *  descendants. Verbatim structure from `budget_snapshot(2025,'expenditure')`.
 *
 *  Filtering depth-1 subtotals out of the slice set — which reads like the
 *  obviously right thing, since a subtotal duplicates its children — dropped
 *  €708.9m of FY2025 interest, 2.50% of the section, and inflated every other
 *  share. The children are at depth 2 and this module never selects that depth,
 *  so a depth-1 subtotal is a LEAF here. */
const EXPENDITURE: SnapshotLine[] = [
  line(0, "Разходи", 1200, null, true),
  line(1, "Персонал", 500, "Разходи"),
  line(1, "Издръжка", 300, "Разходи"),
  line(1, "Лихви - общо", 400, "Разходи", true),
  line(2, "Лихви по външни заеми", 350, "Разходи"),
  line(2, "Лихви по вътрешни заеми", 50, "Разходи"),
  line(0, "Резерв за непредвидени", 0, null),
  line(0, "Трансфери (нето)", 1500, null, true),
  line(1, "Предоставени на:", 1520, "Трансфери (нето)", true),
  line(2, "Общини", 800, "Трансфери (нето)"),
  line(2, "Социалноосигурителни фондове", 720, "Трансфери (нето)"),
];

describe("buildSlices", () => {
  it("opens ONE group and drops the subtotal it replaced", () => {
    const slices = buildSlices(REVENUE, "Данъчни приходи");
    const labels = slices.map((s) => s.labelBg);
    // The children are there…
    expect(labels).toContain("Данък върху добавената стойност");
    // …and the subtotal they add up to is NOT, or that branch counts twice.
    expect(labels).not.toContain("Данъчни приходи");
    // The sibling subtotals stay whole.
    expect(labels).toContain("Неданъчни приходи");
    expect(labels).toContain("Помощи");
  });

  it("totals to the section, not to twice it", () => {
    const slices = buildSlices(REVENUE, "Данъчни приходи");
    // 22 770 + 2 670 + 260 = 25 700. Both levels together would give 48 470.
    expect(slicesTotal(slices)).toBe(25700);
  });

  it("collapses the tail by VALUE and marks it as an aggregate", () => {
    const slices = buildSlices(REVENUE, "Данъчни приходи");
    expect(slices).toHaveLength(DEFAULT_MAX_SLICES + 1);
    const other = slices[slices.length - 1];
    expect(other.isOther).toBe(true);
    expect(other.labelBg).toBe("Други");
    // The named slices are exactly the seven LARGEST, so nothing big hides
    // inside the tail. Stated as the label set, because „the min is >= X" is
    // satisfiable by orderings that are not the ranking.
    const named = slices.filter((s) => !s.isOther).map((s) => s.labelBg);
    expect(named).toEqual([
      "Данък върху добавената стойност",
      "Данъци в/у доходите на физически лица",
      "Акцизи",
      "Корпоративен данък",
      "Неданъчни приходи",
      "Помощи",
      "Мита и митнически такси",
    ]);
    // The tail is the three smallest: 120 + 70 + 40 = 230.
    expect(other.value).toBe(230);
    // …and it says how many lines it folds, so it does not read as one.
    expect(other.lineCount).toBe(3);
  });

  it("keeps the slices in descending value order", () => {
    // The legend order IS the ranking — it is what the arc is for.
    const named = buildSlices(REVENUE, "Данъчни приходи").filter(
      (s) => !s.isOther,
    );
    const values = named.map((s) => s.value);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it("drops a negative line rather than drawing an inverted wedge", () => {
    const withReserve = [...REVENUE, line(0, "Резерв", -500, null, true)];
    const slices = buildSlices(withReserve, "Данъчни приходи");
    expect(slices.map((s) => s.labelBg)).not.toContain("Резерв");
    // …and the denominator does not move, so the shares still reach 100%.
    expect(slicesTotal(slices)).toBe(25700);
  });

  it("drops a zero line", () => {
    const withZero = [...REVENUE, line(0, "Нулево перо", 0, null, true)];
    expect(
      buildSlices(withZero, "Данъчни приходи").map((s) => s.labelBg),
    ).not.toContain("Нулево перо");
  });

  it("normalises the source's padded labels", () => {
    // МФ pads with runs of spaces — „Данъци върху  дивидентите" carries a
    // double one, and the same habit („Трансфери  (нето)") already cost this
    // module family a lookup that matched nothing.
    const slices = buildSlices(REVENUE, "Данъчни приходи", 20);
    expect(slices.map((s) => s.labelBg)).toContain("Данъци върху дивидентите");
  });

  it("matches the expanded group even when ITS label is padded", () => {
    const padded = REVENUE.map((l) =>
      l.labelBg === "Данъчни приходи"
        ? { ...l, labelBg: "Данъчни  приходи" }
        : l,
    );
    const slices = buildSlices(padded, "Данъчни приходи");
    // The subtotal is still dropped, so the branch is not double-counted.
    expect(slices.map((s) => s.labelBg)).not.toContain("Данъчни приходи");
    expect(slicesTotal(slices)).toBe(25700);
  });

  it("drops an unlabelled line instead of drawing a nameless wedge", () => {
    const withBlank = [...REVENUE, line(0, null, 900, null, true)];
    const slices = buildSlices(withBlank, "Данъчни приходи");
    expect(slices.every((s) => s.labelBg !== "")).toBe(true);
    // Its money goes with it, which is why shares are taken against
    // `slicesTotal` and never against the section's own executed figure.
    expect(slicesTotal(slices)).toBe(25700);
  });

  it("falls back to the Bulgarian label when the English one is missing", () => {
    const noEn = REVENUE.map((l) => ({ ...l, labelEn: null }));
    const slices = buildSlices(noEn, "Данъчни приходи");
    // Never an empty legend row on /en.
    expect(slices.every((s) => s.labelEn.length > 0)).toBe(true);
  });

  it("renders nothing when every value is zero or absent", () => {
    const empty = REVENUE.map((l) => ({ ...l, executedEur: 0 }));
    expect(buildSlices(empty, "Данъчни приходи")).toEqual([]);
    expect(buildSlices([], "Данъчни приходи")).toEqual([]);
  });

  it("leaves every group whole when asked to open none", () => {
    const slices = buildSlices(REVENUE, null);
    expect(slices.map((s) => s.labelBg)).toContain("Данъчни приходи");
    // Still the section total — the children are not added on top.
    expect(slicesTotal(slices)).toBe(25700);
  });

  // ── expenditure: the shape revenue does not have ─────────────────────────
  it("keeps a depth-1 SUBTOTAL as a slice, because its children are at depth 2", () => {
    // The live bug. „Лихви - общо" is a depth-1 subtotal under „Разходи"; its
    // two children sit at depth 2, which this module never selects. Filtering
    // it out as „a subtotal duplicates its children" dropped €708.9m of FY2025
    // interest with nothing to replace it.
    const slices = buildSlices(EXPENDITURE, "Разходи");
    expect(slices.map((s) => s.labelBg)).toContain("Лихви - общо");
    // …and its depth-2 children are NOT slices, or that branch counts twice.
    expect(slices.map((s) => s.labelBg)).not.toContain("Лихви по външни заеми");
  });

  it("reconciles expenditure to the section, interest included", () => {
    // 1200 (Разходи, via its children 500+300+400) + 1500 (Трансфери) = 2700.
    // Dropping the interest subtotal gives 2300 — every other share inflated.
    expect(slicesTotal(buildSlices(EXPENDITURE, "Разходи"))).toBe(2700);
  });

  it("never selects depth 2, so a sibling group's grandchildren stay out", () => {
    // „Трансфери (нето)" is left whole, and its depth-1 and depth-2 rows carry
    // `groupLabelBg` = the depth-0 grandparent — so a builder that matched on
    // that column without checking depth would pull them in beside their own
    // ancestor.
    const labels = buildSlices(EXPENDITURE, "Разходи").map((s) => s.labelBg);
    expect(labels).toContain("Трансфери (нето)");
    expect(labels).not.toContain("Предоставени на:");
    expect(labels).not.toContain("Общини");
  });

  it("finds the opened group when the SOURCE pads groupLabelBg", () => {
    // МФ pads that column too — the corpus carries „Трансфери  (нето)" and
    // „Външно финансиране  (нето)". Compared raw, the whole opened branch
    // silently disappears and the donut shows only the siblings.
    const padded = EXPENDITURE.map((l) =>
      l.groupLabelBg === "Разходи" ? { ...l, groupLabelBg: "Раз ходи" } : l,
    ).map((l) =>
      l.groupLabelBg === "Раз ходи" ? { ...l, groupLabelBg: "Разходи " } : l,
    );
    const slices = buildSlices(padded, "Разходи");
    expect(slices.map((s) => s.labelBg)).toContain("Персонал");
    expect(slicesTotal(slices)).toBe(2700);
  });
});
