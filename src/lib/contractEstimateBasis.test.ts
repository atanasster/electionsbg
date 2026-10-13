// A lot of a multi-lot procedure is compared against its OWN estimate, never the
// whole procedure's — Разград's Бели Лом lot 1 rendered „48.5% под прогнозната"
// when it was signed €285 under its lot.

import { describe, it, expect } from "vitest";
import { contractEstimateBasis, formatDeltaPct } from "./contractEstimateBasis";

describe("contractEstimateBasis", () => {
  it("uses the lot's estimate when the procedure has several lots", () => {
    expect(
      contractEstimateBasis({
        lotsCount: 2,
        lotEstimatedValueEur: 6_797_883.84,
        estimatedValueEur: 13_208_373.89,
      }),
    ).toEqual({ multiLot: true, estimated: 6_797_883.84 });
  });

  it("shows no estimate rather than the whole procedure's when the lot is unmatched", () => {
    expect(
      contractEstimateBasis({ lotsCount: 3, estimatedValueEur: 13_208_373.89 }),
    ).toEqual({ multiLot: true, estimated: null });
  });

  it("uses the procedure estimate for a single-lot procedure", () => {
    expect(
      contractEstimateBasis({ lotsCount: 1, estimatedValueEur: 500_000 }),
    ).toEqual({ multiLot: false, estimated: 500_000 });
    expect(contractEstimateBasis({ estimatedValueEur: 500_000 })).toEqual({
      multiLot: false,
      estimated: 500_000,
    });
  });
});

describe("formatDeltaPct", () => {
  it("never prints 0.0% for a real, tiny difference", () => {
    // Бели Лом lot 1: €284.79 under a €6,797,883.84 estimate.
    const d = ((6_797_599.05 - 6_797_883.84) / 6_797_883.84) * 100;
    expect(formatDeltaPct(d, false)).toBe("<0.1%");
    expect(formatDeltaPct(d, true)).toBe("-<0.1%");
    expect(formatDeltaPct(0.01, true)).toBe("+<0.1%");
  });

  it("prints one decimal otherwise, with the same minus in both branches", () => {
    expect(formatDeltaPct(-48.53, true)).toBe("-48.5%");
    expect(formatDeltaPct(12.04, true)).toBe("+12.0%");
    expect(formatDeltaPct(-48.53, false)).toBe("48.5%");
  });
});
