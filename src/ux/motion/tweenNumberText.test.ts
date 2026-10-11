import { describe, expect, it } from "vitest";
import { tweenNumberText } from "./tweenNumberText";

const frames = (from: string, to: string, ts = [0, 0.5, 1]) => {
  const f = tweenNumberText(from, to);
  return f ? ts.map(f) : null;
};

describe("tweenNumberText", () => {
  it("rolls a bg decimal figure and lands on the target verbatim", () => {
    expect(frames("€3,3 млрд.", "€12,1 млрд.")).toEqual([
      "€3,3 млрд.",
      "€7,7 млрд.",
      "€12,1 млрд.",
    ]);
  });

  it("rolls an en decimal figure", () => {
    expect(frames("43.2%", "41.0%")).toEqual(["43.2%", "42.1%", "41.0%"]);
  });

  it("keeps space grouping, and learns bg's ungrouped 4-digit integers", () => {
    // bg: 4 digits ungrouped, 5+ grouped with a no-break space.
    const f = tweenNumberText("1200 души", "20\u00a0000 души")!;
    expect(f(0.5)).toBe("10\u00a0600 души");
    expect(f(0.01)).toBe("1388 души");
  });

  it("keeps en comma grouping across magnitudes", () => {
    expect(frames("1,234,567", "2,000,000", [0.5])).toEqual(["1,617,284"]);
  });

  it("pads the fraction so precision never flickers", () => {
    expect(frames("€0,9 млрд.", "€2,0 млрд.", [0.1])).toEqual(["€1,0 млрд."]);
  });

  it("refuses a unit change rather than rolling digits across it", () => {
    expect(tweenNumberText("€930 млн.", "€1,2 млрд.")).toBeNull();
  });

  it("refuses the locale-ambiguous lone separator before three digits", () => {
    expect(tweenNumberText("1,234", "2,345")).toBeNull();
  });

  it("refuses two numeric runs and a precision change", () => {
    expect(tweenNumberText("2019–2023", "2020–2024")).toBeNull();
    expect(tweenNumberText("3,3%", "3,35%")).toBeNull();
  });

  it("refuses non-numeric and identical values", () => {
    expect(tweenNumberText("—", "12")).toBeNull();
    expect(tweenNumberText("12", "12")).toBeNull();
  });
});
