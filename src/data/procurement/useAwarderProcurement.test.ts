// The tile's whole point is that its numbers are labelled with the years they
// cover, so the span and latest-year helpers are what keep it honest.

import { describe, it, expect } from "vitest";
import {
  awarderYearSpan,
  latestAwarderYear,
  type AwarderYear,
} from "./useAwarderProcurement";

// A real shape from awarder_procurement: years arrive as strings and are not
// contiguous — this school bought nothing in 2015-2018, 2020 or 2022-2024.
const BY_YEAR: AwarderYear[] = [
  { year: "2014", totalEur: 42514.89, contractCount: 1 },
  { year: "2019", totalEur: 64376.76, contractCount: 1 },
  { year: "2021", totalEur: 121797.52, contractCount: 3 },
  { year: "2025", totalEur: 52809.8, contractCount: 1 },
  { year: "2026", totalEur: 228574.4, contractCount: 2 },
];

describe("awarderYearSpan", () => {
  it("spans first to last, across the gaps", () => {
    expect(awarderYearSpan(BY_YEAR)).toEqual({ from: 2014, to: 2026 });
  });

  it("does not assume the rows arrive sorted", () => {
    expect(awarderYearSpan([...BY_YEAR].reverse())).toEqual({
      from: 2014,
      to: 2026,
    });
  });

  it("collapses to a single year", () => {
    expect(awarderYearSpan([BY_YEAR[0]])).toEqual({ from: 2014, to: 2014 });
  });

  it("is null with nothing to span", () => {
    expect(awarderYearSpan([])).toBeNull();
    expect(awarderYearSpan(null)).toBeNull();
    expect(awarderYearSpan(undefined)).toBeNull();
  });

  it("ignores unparseable years rather than rendering NaN", () => {
    expect(
      awarderYearSpan([
        { year: "", totalEur: 1, contractCount: 1 },
        ...BY_YEAR,
      ]),
    ).toEqual({ from: 2014, to: 2026 });
  });
});

describe("latestAwarderYear", () => {
  it("returns the newest year, not the last row", () => {
    expect(latestAwarderYear([...BY_YEAR].reverse())?.year).toBe("2026");
  });

  it("carries that year's own figures", () => {
    const l = latestAwarderYear(BY_YEAR)!;
    expect(l.totalEur).toBe(228574.4);
    expect(l.contractCount).toBe(2);
    // The point of the tile: the latest year is NOT the total.
    expect(l.totalEur).toBeLessThan(
      BY_YEAR.reduce((s, r) => s + r.totalEur, 0),
    );
  });

  it("is null when there are no years", () => {
    expect(latestAwarderYear([])).toBeNull();
    expect(latestAwarderYear(null)).toBeNull();
  });
});
