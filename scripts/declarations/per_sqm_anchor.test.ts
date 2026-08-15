// The price-per-m² anchor, shared by the parse-time separator-typo detector and
// check_suspicious_values.ts. Both rewrite or flag published numbers off it, so the
// precedence and the rejection rules below are load-bearing rather than cosmetic.

import { describe, expect, it } from "vitest";
import { builtAreaFromCell, perSqmAnchor } from "./parse_declaration";

describe("perSqmAnchor", () => {
  // „в колона 5 се посочва площта на парцела, а в колона 6 - на сградата".
  it("anchors on the building, not the plot", () => {
    // Касчиев's 36m² вила on a 980m² Sofia plot: 423,558/m² of building against
    // 15,559/m² of plot — the dilution that let it publish at €15.2m.
    expect(perSqmAnchor(980, 36)).toBe(36);
  });

  it("falls back to the plot when there is no building area", () => {
    expect(perSqmAnchor(980, null)).toBe(980);
    expect(perSqmAnchor(980, 0)).toBe(980);
  });

  // An apartment declares площ „0" and its real area in РЗП. 662 valued building rows
  // had no usable anchor at all before the building was consulted.
  it("uses the building when the plot is the declared zero", () => {
    expect(perSqmAnchor(0, 41)).toBe(41);
  });

  // The regression this function exists to prevent: a column-6 cell sometimes holds an
  // ideal part rather than an area, which toLooseNumber reduces to 1. Committing to a
  // present-but-unusable building area would SUPPRESS the plot fallback and stop checking
  // a row that used to be checked.
  it("falls through to the plot when the building area is below the anchor floor", () => {
    expect(perSqmAnchor(980, 1)).toBe(980);
    expect(perSqmAnchor(980, 9)).toBe(980);
  });

  it("returns null when neither area can anchor anything", () => {
    expect(perSqmAnchor(null, null)).toBeNull();
    expect(perSqmAnchor(0, 0)).toBeNull();
    expect(perSqmAnchor(5, 2)).toBeNull();
  });
});

describe("builtAreaFromCell", () => {
  it("reads an ordinary area", () => {
    expect(builtAreaFromCell("41")).toBe(41);
    expect(builtAreaFromCell("71,14")).toBeCloseTo(71.14, 6);
    expect(builtAreaFromCell(null)).toBeNull();
  });

  // Column 6 is a m² figure. "1/2" is a share someone put in the wrong cell; taking its
  // numerator as 1 m² makes any price look like a separator typo. 75 column-6 cells in
  // the corpus are fraction-shaped; 2 sit in a table-1 built-area position.
  it("does not accept an ideal-part fraction as a built area", () => {
    expect(builtAreaFromCell("1/2")).toBeNull();
    expect(builtAreaFromCell("1/1")).toBeNull();
    expect(builtAreaFromCell("1/2 - 1/2")).toBeNull();
    expect(builtAreaFromCell("12/100")).toBeNull();
    expect(builtAreaFromCell("2024/2025")).toBeNull();
  });
});
