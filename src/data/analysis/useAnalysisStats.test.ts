import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import {
  AnalysisStat,
  formatAnalysisMetric,
  analysisMetricCaption,
} from "./useAnalysisStats";

// A minimal t() that echoes the key and interpolates {{total}} — enough to
// assert the caption wiring without pulling in i18next.
const t = ((key: string, opts?: { total?: string }) =>
  opts?.total ? `${key}|${opts.total}` : key) as unknown as TFunction;

const stat = (o: Partial<AnalysisStat>): AnalysisStat => ({
  kind: "count",
  value: 0,
  captionKey: "cap",
  ...o,
});

describe("formatAnalysisMetric", () => {
  it("returns undefined for a missing stat or null value", () => {
    expect(formatAnalysisMetric(undefined, "en")).toBeUndefined();
    expect(
      formatAnalysisMetric(stat({ value: null as unknown as number }), "en"),
    ).toBeUndefined();
  });

  it("returns undefined for a zero-value eur (nothing to show)", () => {
    expect(formatAnalysisMetric(stat({ kind: "eur", value: 0 }), "en")).toBe(
      undefined,
    );
  });

  it("formats a score to exactly two decimals", () => {
    expect(
      formatAnalysisMetric(stat({ kind: "score", value: 1.76 }), "en"),
    ).toBe("1.76");
    expect(formatAnalysisMetric(stat({ kind: "score", value: 2 }), "en")).toBe(
      "2.00",
    );
  });

  it("formats a percent with one fixed decimal and a % suffix", () => {
    expect(
      formatAnalysisMetric(stat({ kind: "percent", value: 18.02 }), "en"),
    ).toBe("18.0%");
    expect(
      formatAnalysisMetric(stat({ kind: "percent", value: 50.7 }), "en"),
    ).toBe("50.7%");
  });

  it("formats a count as a grouped integer", () => {
    expect(
      formatAnalysisMetric(stat({ kind: "count", value: 12705 }), "en"),
    ).toBe("12,705");
  });
});

describe("analysisMetricCaption", () => {
  it("interpolates a grouped {{total}} for a count-of-total stat", () => {
    const cap = analysisMetricCaption(
      stat({ kind: "count", value: 10, total: 12705, captionKey: "risk" }),
      t,
      "en",
    );
    expect(cap).toBe("risk|12,705");
  });

  it("passes an empty total when the stat has no total", () => {
    const cap = analysisMetricCaption(
      stat({ kind: "percent", value: 43.2, captionKey: "persist" }),
      t,
      "en",
    );
    expect(cap).toBe("persist");
  });

  it("returns undefined for a missing stat", () => {
    expect(analysisMetricCaption(undefined, t, "en")).toBeUndefined();
  });
});
