// The two things this helper decides are editorial, not cosmetic: which per-MP figure the
// bars represent, and what a group with no valued filing looks like.

import { describe, expect, it } from "vitest";
import type { MpAssetsPartyGroup } from "@/data/parliament/useAssetsRankings";
import {
  orderByMetric,
  metricValue,
  complementValue,
  metricMax,
  barWidthPct,
} from "./groupAssets";

const g = (over: Partial<MpAssetsPartyGroup> = {}): MpAssetsPartyGroup => ({
  party: "ПГ на X",
  mps: 10,
  declared: 10,
  totalNetEur: 1_000_000,
  totalAssetsEur: 1_200_000,
  totalDebtsEur: 200_000,
  medianNetEur: 80_000,
  meanNetEur: 100_000,
  ...over,
});

describe("metricValue / complementValue", () => {
  it("the per-MP mode is the MEDIAN, with the mean as its complement", () => {
    // The skew case this exists for: the 52nd's ДПС group is €11.56m over 21 MPs, of which
    // one member declares €10.07m. Median €77,742, mean €550,494 — a bar drawn from the mean
    // would rank the group above every other and describe one filing.
    const dps = g({ medianNetEur: 77_742, meanNetEur: 550_494 });
    expect(metricValue(dps, "median")).toBe(77_742);
    expect(complementValue(dps, "median")).toBe(550_494);
  });

  it("the total mode is the group's summed net worth, with the median beside it", () => {
    expect(metricValue(g(), "total")).toBe(1_000_000);
    expect(complementValue(g(), "total")).toBe(80_000);
  });
});

describe("orderByMetric", () => {
  it("re-ranks when the metric changes — the biggest group is not the richest MP", () => {
    const big = g({
      party: "Б",
      totalNetEur: 20_000_000,
      medianNetEur: 50_000,
    });
    const rich = g({
      party: "А",
      totalNetEur: 5_000_000,
      medianNetEur: 400_000,
    });
    expect(orderByMetric([rich, big], "total").map((x) => x.party)).toEqual([
      "Б",
      "А",
    ]);
    expect(orderByMetric([rich, big], "median").map((x) => x.party)).toEqual([
      "А",
      "Б",
    ]);
  });

  it("a group with no median sinks to the bottom rather than sorting as zero", () => {
    const none = g({ party: "Я", medianNetEur: null });
    const some = g({ party: "А", medianNetEur: 1 });
    expect(orderByMetric([none, some], "median").map((x) => x.party)).toEqual([
      "А",
      "Я",
    ]);
  });

  it("ties break on the label, so the order does not shuffle between renders", () => {
    const a = g({ party: "А" });
    const b = g({ party: "Б" });
    expect(orderByMetric([b, a], "total").map((x) => x.party)).toEqual([
      "А",
      "Б",
    ]);
  });

  it("does not mutate its input", () => {
    const rows = [g({ party: "Б", totalNetEur: 1 }), g({ party: "А" })];
    orderByMetric(rows, "total");
    expect(rows.map((x) => x.party)).toEqual(["Б", "А"]);
  });
});

describe("metricMax / barWidthPct", () => {
  it("scales to the largest value of the ACTIVE metric", () => {
    const rows = [g({ totalNetEur: 4 }), g({ party: "Б", totalNetEur: 10 })];
    expect(metricMax(rows, "total")).toBe(10);
    expect(barWidthPct(4, 10)).toBe(40);
    expect(barWidthPct(10, 10)).toBe(100);
  });

  it("draws NOTHING for a missing or non-positive figure", () => {
    // Net worth goes negative when declared debts exceed declared assets; a minimum-width
    // hairline there would read as a small positive amount.
    expect(barWidthPct(null, 10)).toBe(0);
    expect(barWidthPct(-500, 10)).toBe(0);
    expect(barWidthPct(0, 10)).toBe(0);
    expect(barWidthPct(5, 0)).toBe(0);
  });

  it("keeps a tiny positive figure visible", () => {
    expect(barWidthPct(1, 1_000_000)).toBe(1.5);
  });

  it("a metric no group can supply has no scale", () => {
    expect(metricMax([g({ medianNetEur: null })], "median")).toBe(0);
  });
});
