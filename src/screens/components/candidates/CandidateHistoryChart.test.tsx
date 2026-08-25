// The chart draws every cycle a candidate has ever run in, so it must visually state
// which one the pills (and the stat cards) above it currently describe — otherwise every
// past run reads as equally "now". barCellStyle is that decision, pulled out of the JSX
// so it's directly testable — recharts' SVG output needs a measured layout jsdom doesn't
// provide, which is why this codebase's other chart tests (PersonWealthTrajectory.test.tsx)
// don't assert on rendered bar attributes either.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { barCellStyle } from "./candidateHistoryChartStyle";

describe("barCellStyle", () => {
  it("treats every cycle as current when there is no selector to tie back to (the legacy single-snapshot path)", () => {
    expect(barCellStyle(0, "2021_11_14", "#111", undefined)).toEqual({
      fillOpacity: 1,
      stroke: undefined,
      strokeWidth: 0,
    });
    // A secondary region (n > 0) keeps its pre-existing 0.55 weight, still with no stroke —
    // the highlight edge is reserved for an actual selection.
    expect(barCellStyle(1, "2021_11_14", "#111", undefined)).toEqual({
      fillOpacity: 0.55,
      stroke: undefined,
      strokeWidth: 0,
    });
  });

  it("gives the selected cycle full weight and a defining edge", () => {
    expect(barCellStyle(0, "2024_10_27", "#222", "2024_10_27")).toEqual({
      fillOpacity: 1,
      stroke: "#222",
      strokeWidth: 1.5,
    });
  });

  it("also gives a defining edge to a secondary region of the selected cycle", () => {
    // stroke/strokeWidth don't depend on n — every region of the highlighted cycle gets
    // the edge, not just the strongest one.
    expect(barCellStyle(1, "2024_10_27", "#222", "2024_10_27")).toEqual({
      fillOpacity: 0.55,
      stroke: "#222",
      strokeWidth: 1.5,
    });
  });

  it("dims a non-selected cycle further than the pre-existing weight, with no edge", () => {
    expect(barCellStyle(0, "2021_11_14", "#111", "2024_10_27")).toEqual({
      fillOpacity: 0.35,
      stroke: undefined,
      strokeWidth: 0,
    });
    expect(barCellStyle(1, "2021_11_14", "#111", "2024_10_27")).toEqual({
      fillOpacity: 0.2,
      stroke: undefined,
      strokeWidth: 0,
    });
  });
});
