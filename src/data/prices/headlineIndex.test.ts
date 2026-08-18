// The headline figure: the right DAY and the right VALUE.
//
// Both corrections exist because of the same 2026-08 event — the КЗП feed's
// reporter set fell 203 → 98 chains over six days, /prices headlined the raw
// last point, and production and localhost disagreed by 2.3 points on the same
// corpus one day apart.

import { describe, it, expect } from "vitest";
import {
  headlineIndex,
  headlinePoint,
  HEADLINE_WINDOW,
  type PricePoint,
  type PriceIndexFile,
} from "./usePrices";

type Coverage = PriceIndexFile["coverage"];

const pts = (...vals: [string, number, number?][]): PricePoint[] =>
  vals.map(([d, v, n]) => ({ d, v, ...(n === undefined ? {} : { n }) }));

const cov = (o: Partial<Coverage>): Coverage =>
  ({
    settlements: 1,
    chains: 1,
    rows: 1,
    chainsTrailingMedian: null,
    chainsComplete: true,
    headlineDate: "",
    incompleteDates: [],
    ...o,
  }) as Coverage;

describe("headlineIndex", () => {
  it("ends at headlineDate, not at the last point", () => {
    const series = pts(
      ["2026-08-06", 101],
      ["2026-08-07", 101],
      ["2026-08-08", 101],
      ["2026-08-09", 90], // withheld
    );
    const r = headlineIndex(
      series,
      cov({ headlineDate: "2026-08-08", incompleteDates: ["2026-08-09"] }),
    );
    expect(r!.d).toBe("2026-08-08");
    expect(r!.v).toBe(101); // the 90 is not in the mean
  });

  it("drops withheld days from INSIDE the window, not just the tail", () => {
    // A thin day earlier in the window would otherwise be averaged in.
    const series = pts(
      ["2026-08-01", 100],
      ["2026-08-02", 10], // withheld, mid-window
      ["2026-08-03", 100],
      ["2026-08-04", 100],
    );
    const r = headlineIndex(
      series,
      cov({ headlineDate: "2026-08-04", incompleteDates: ["2026-08-02"] }),
    );
    expect(r!.v).toBe(100);
    expect(r!.days).toBe(3);
  });

  it("drops days with nothing matched — n=0 is a fallback, not a measurement", () => {
    const series = pts(
      ["2026-08-01", 97, 101],
      ["2026-08-02", 100, 0], // the builder's ?? 100
      ["2026-08-03", 97, 101],
    );
    const r = headlineIndex(series, cov({ headlineDate: "2026-08-03" }));
    expect(r!.v).toBe(97);
    expect(r!.days).toBe(2);
  });

  it("averages at most HEADLINE_WINDOW days", () => {
    const series = Array.from({ length: 30 }, (_, i) => ({
      d: `2026-08-${String(i + 1).padStart(2, "0")}`,
      v: i < 23 ? 0 : 100, // only the last 7 are 100
    }));
    const r = headlineIndex(series, cov({ headlineDate: "2026-08-30" }));
    expect(r!.days).toBe(HEADLINE_WINDOW);
    expect(r!.v).toBe(100);
  });

  it("smooths — a single spiking day cannot carry the headline", () => {
    // This is the whole point of the VALUE half. Raw last point = 106.
    const series = pts(
      ["2026-08-01", 100],
      ["2026-08-02", 100],
      ["2026-08-03", 100],
      ["2026-08-04", 106],
    );
    const r = headlineIndex(series, cov({ headlineDate: "2026-08-04" }));
    expect(r!.v).toBe(101.5);
    // …and the control: the raw last point, which is what shipped before.
    expect(series[series.length - 1].v).toBe(106);
  });

  it("falls back to the last point when the payload predates the gate", () => {
    const series = pts(["2026-08-01", 100], ["2026-08-02", 102]);
    const r = headlineIndex(series, undefined);
    expect(r!.d).toBe("2026-08-02");
    expect(r!.v).toBe(101);
  });

  it("falls back when headlineDate names a day the series lacks", () => {
    const series = pts(["2026-08-01", 100], ["2026-08-02", 100]);
    const r = headlineIndex(series, cov({ headlineDate: "2020-01-01" }));
    expect(r!.d).toBe("2026-08-02");
  });

  it("returns null rather than 0 when nothing is usable", () => {
    expect(headlineIndex([], cov({}))).toBeNull();
    expect(headlineIndex(undefined, cov({}))).toBeNull();
    const allWithheld = pts(["2026-08-01", 100]);
    expect(
      headlineIndex(
        allWithheld,
        cov({ headlineDate: "2026-08-01", incompleteDates: ["2026-08-01"] }),
      ),
    ).toBeNull();
  });
});

describe("headlinePoint", () => {
  it("names the anchor day without averaging", () => {
    const series = pts(["2026-08-01", 100], ["2026-08-02", 106]);
    expect(headlinePoint(series, cov({ headlineDate: "2026-08-01" }))!.v).toBe(
      100,
    );
  });
});

describe("headlineIndex — mutants the first cut survived", () => {
  it("MUTATION CHECK: the anchor is not decorative", () => {
    // An implementation that took the last `window` points and merely REPORTED
    // headlineDate as `d` passes most of this file. Here the anchor is
    // mid-series with distinct values either side, so only an implementation
    // that actually ends the window at the anchor gets 100.
    const series = pts(
      ["2026-08-01", 100],
      ["2026-08-02", 100],
      ["2026-08-03", 100], // ← anchor
      ["2026-08-04", 400],
      ["2026-08-05", 400],
    );
    const r = headlineIndex(series, cov({ headlineDate: "2026-08-03" }));
    expect(r!.v).toBe(100);
    // the mutant (last 5 points regardless of anchor) would give 220
    expect(series.reduce((a, p) => a + p.v, 0) / series.length).toBe(220);
  });

  it("MUTATION CHECK: the window counts USABLE days, not calendar days", () => {
    // A fixed calendar window ending at the anchor would include the withheld
    // days and average 55; reaching back past them keeps 4 usable days at 100.
    const series = pts(
      ["2026-08-01", 100],
      ["2026-08-02", 100],
      ["2026-08-03", 10], // withheld
      ["2026-08-04", 10], // withheld
      ["2026-08-05", 100],
      ["2026-08-06", 100],
    );
    const r = headlineIndex(
      series,
      cov({
        headlineDate: "2026-08-06",
        incompleteDates: ["2026-08-03", "2026-08-04"],
      }),
      4,
    );
    expect(r!.v).toBe(100);
    expect(r!.days).toBe(4);
    // …and it reports how far back it had to reach to find them.
    expect(r!.from).toBe("2026-08-01");
  });

  it("reports the window's start, which is not `d` minus the window", () => {
    const series = pts(
      ["2026-08-01", 100],
      ["2026-08-02", 100],
      ["2026-08-03", 100],
    );
    const r = headlineIndex(series, cov({ headlineDate: "2026-08-03" }), 2);
    expect(r!.d).toBe("2026-08-03");
    expect(r!.from).toBe("2026-08-02");
  });
});
