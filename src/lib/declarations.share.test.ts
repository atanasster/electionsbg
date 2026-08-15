// Unit gate for assetShareMultiplier — the ideal-part (идеална част) rule.
//
// The SQL twin is checked against this one over the whole corpus in
// scripts/db/tests/asset_share_multiplier.data.test.ts. This file pins the behaviour that
// matters at the boundaries, none of which is obvious from the regexes.

import { describe, expect, it } from "vitest";
import { assetShareMultiplier, assetWeightedEur } from "./declarations";

const m = (share: string | null, category = "real_estate") =>
  assetShareMultiplier({ category, share });

describe("assetShareMultiplier", () => {
  it("reads a proper fraction", () => {
    expect(m("1/2")).toBe(0.5);
    expect(m("1/4")).toBe(0.25);
    expect(m("3/4")).toBe(0.75);
    expect(m("5/12")).toBeCloseTo(5 / 12, 12);
    expect(m(" 1 / 2 ")).toBe(0.5);
  });

  it("strips the ид.ч. / идеална част suffix declarants add", () => {
    expect(m("1/2 ид.ч.")).toBe(0.5);
    expect(m("1/2 ид. ч.")).toBe(0.5);
    expect(m("1/2 идеална част")).toBe(0.5);
  });

  it("reads unambiguous percentages and decimals", () => {
    expect(m("50%")).toBe(0.5);
    expect(m("25 %")).toBe(0.25);
    expect(m("0,5")).toBe(0.5);
    expect(m("0.25")).toBe(0.25);
  });

  // A percentage is a percentage. An early draft of this rule mapped "50%" to 50 rather
  // than 0.5 and inflated the executive tier from €1.36bn to €2.06bn before it was caught.
  it("never returns a multiplier above 1", () => {
    for (const s of ["50%", "0,5", "1/2", "99%", "0.99"]) {
      expect(m(s)).toBeLessThanOrEqual(1);
      expect(m(s)).toBeGreaterThan(0);
    }
  });

  it("treats whole ownership as unweighted", () => {
    expect(m("1/1")).toBe(1);
    expect(m("1")).toBe(1);
    expect(m("100%")).toBe(1);
    expect(m("100 %")).toBe(1);
  });

  // Each of these already represents the household's WHOLE holding on one row, so halving
  // it would under-state. They must fall through to 1, not be parsed.
  it("leaves one-row-covers-both spellings alone", () => {
    expect(m("СИО")).toBe(1);
    expect(m("сио")).toBe(1);
    expect(m("1/2 СИО")).toBe(1);
    expect(m("по 1/2")).toBe(1);
    expect(m("1/2 - 1/2")).toBe(1);
    expect(m("1/2-1/2")).toBe(1);
    expect(m("1/2+1/2")).toBe(1);
    expect(m("една втора")).toBe(1);
  });

  // "50" is unreadable — percent or ideal part? — and "0" would zero a real asset.
  it("refuses bare integers and degenerate values", () => {
    expect(m("50")).toBe(1);
    expect(m("25")).toBe(1);
    expect(m("0")).toBe(1);
    expect(m("1000")).toBe(1);
    expect(m("1/0")).toBe(1);
    expect(m("0%")).toBe(1);
    expect(m("да")).toBe(1);
    expect(m("")).toBe(1);
    expect(m(null)).toBe(1);
  });

  // The share column on the table-9/10 securities forms is a COUNT of дялове.
  it("never weights a category whose share is not an ideal part", () => {
    expect(m("1/2", "security")).toBe(1);
    expect(m("369476", "security")).toBe(1);
    expect(m("1/2", "bank")).toBe(1);
    expect(m("1/2", "cash")).toBe(1);
    expect(m("1/2", "debt")).toBe(1);
  });

  it("weights vehicles, which inherit table 1's rules", () => {
    expect(m("1/2", "vehicle")).toBe(0.5);
  });
});

describe("assetWeightedEur", () => {
  // The case that started this: one villa, two co-owner rows, each repeating the WHOLE
  // price. Summing raw values published 2× the household's actual holding.
  it("collapses a spousal 1/2 + 1/2 pair to the property's value", () => {
    const row = { category: "real_estate", share: "1/2", valueEur: 15248 };
    const spouse = { ...row };
    expect(assetWeightedEur(row) + assetWeightedEur(spouse)).toBe(15248);
  });

  it("leaves a solely-owned property whole", () => {
    expect(
      assetWeightedEur({
        category: "real_estate",
        share: "1/1",
        valueEur: 15248,
      }),
    ).toBe(15248);
  });

  // The non-household co-owner case: nobody else files a row, so half is all the
  // declarant holds and nothing can restore the rest.
  it("halves a share held with a non-household co-owner", () => {
    expect(
      assetWeightedEur({
        category: "real_estate",
        share: "1/2",
        valueEur: 15248,
      }),
    ).toBe(7624);
  });

  it("treats a missing value as zero", () => {
    expect(
      assetWeightedEur({
        category: "real_estate",
        share: "1/2",
        valueEur: null,
      }),
    ).toBe(0);
  });
});
