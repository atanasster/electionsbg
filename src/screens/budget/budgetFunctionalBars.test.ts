// Gates for the COFOG chart's data layer (plan T9.1).

import { describe, it, expect } from "vitest";
import { functionalBars, type FunctionalRow } from "./budgetFunctionalBars";

/** FY2024, verbatim shares from `budget_cofog`. Ten rows, so the donut's
 *  seven-slice collapse threshold is genuinely crossed — with seven the
 *  assertion below would pass under either shape. */
const FY2024: FunctionalRow[] = [
  { code: "GF10", amount: 15_091_900_000, pctOfTotal: 36.8 },
  { code: "GF04", amount: 6_105_900_000, pctOfTotal: 14.9 },
  { code: "GF07", amount: 5_618_400_000, pctOfTotal: 13.7 },
  { code: "GF09", amount: 4_460_000_000, pctOfTotal: 10.9 },
  { code: "GF01", amount: 3_080_000_000, pctOfTotal: 7.5 },
  { code: "GF03", amount: 2_910_000_000, pctOfTotal: 7.1 },
  { code: "GF02", amount: 1_340_000_000, pctOfTotal: 3.3 },
  { code: "GF06", amount: 1_070_000_000, pctOfTotal: 2.6 },
  { code: "GF08", amount: 750_000_000, pctOfTotal: 1.8 },
  { code: "GF05", amount: 640_000_000, pctOfTotal: 1.6 },
];

const label = (c: string) => `L:${c}`;
const amount = (v: number | null) => (v == null ? "—" : `€${v}`);

describe("functionalBars", () => {
  it("keeps ALL ten functions — nothing collapses into an other bucket", () => {
    // ⚠️ THE REASON THIS PAGE IS NOT THE COMPOSITION DONUT. That one folds
    // everything past seven slices; here the bottom three are Жилищно
    // строителство, Култура, отдих и религия and Опазване на околната среда — 6.0%
    // between them, and three policy areas a reader may have come specifically
    // to find.
    const bars = functionalBars(FY2024, label, amount);
    expect(bars).toHaveLength(10);
    expect(bars.map((b) => b.code)).toContain("GF05");
    expect(bars.map((b) => b.code)).toContain("GF08");
    expect(bars.map((b) => b.code)).toContain("GF06");
    expect(bars.some((b) => b.code === "other" || b.label === "Други")).toBe(
      false,
    );
  });

  it("ranks by share, whatever order the server sent", () => {
    // `budget_cofog_list` orders by AMOUNT, which ties at NULL on any basis
    // that cannot resolve every figure — and the list then silently falls back
    // to code order, „Общи държавни служби 7.5%" above „Социална закрила 36.8%"
    // with both percentages correct.
    const shuffled = [FY2024[7], FY2024[0], FY2024[4], FY2024[9]];
    expect(functionalBars(shuffled, label, amount).map((b) => b.pct)).toEqual([
      36.8, 7.5, 2.6, 1.6,
    ]);
  });

  it("drops a row with no share rather than drawing it at zero", () => {
    // There is no length to draw, and a zero-length bar beside a label says the
    // function received nothing.
    const withNull: FunctionalRow[] = [
      ...FY2024.slice(0, 2),
      { code: "GFXX", amount: 5, pctOfTotal: null },
    ];
    expect(functionalBars(withNull, label, amount).map((b) => b.code)).toEqual([
      "GF10",
      "GF04",
    ]);
  });

  it("carries the caller's formatted amount, not a re-derived one", () => {
    // The page offers euro and %-of-GDP; formatting here would be a second copy
    // of a basis rule, which is what §7.1 forbids.
    const [top] = functionalBars(FY2024, label, () => "42% от БВП");
    expect(top.amountLabel).toBe("42% от БВП");
    // …and it survives a NULL amount, which a %-of-GDP basis produces for every
    // row on a year before 2021.
    const [nullAmt] = functionalBars(
      [{ code: "GF10", amount: null, pctOfTotal: 36.8 }],
      label,
      amount,
    );
    expect(nullAmt.amountLabel).toBe("—");
  });

  it("returns [] for an empty corpus — the caller renders nothing at all", () => {
    // Not a tautology in context: the CHART turns [] into `return null`, and an
    // empty framed box under a heading reads as „nothing was spent on
    // anything" on a year COFOG does not cover. The all-null case is covered by
    // „drops a row with no share" above and is deliberately not repeated here.
    expect(functionalBars([], label, amount)).toEqual([]);
  });

  it("drops a non-finite share rather than drawing NaN", () => {
    // `pctOfTotal` is computed server-side from a division; a total of 0 gives
    // Infinity, and Recharts draws a bar of NaN width as a zero-length one
    // beside a real label.
    const bad = [
      { code: "GF10", amount: 1, pctOfTotal: Number.POSITIVE_INFINITY },
      { code: "GF04", amount: 1, pctOfTotal: Number.NaN },
      { code: "GF07", amount: 1, pctOfTotal: 12.5 },
    ];
    expect(functionalBars(bad, label, amount).map((b) => b.code)).toEqual([
      "GF07",
    ]);
  });
});
