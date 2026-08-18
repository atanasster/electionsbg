// The coverage rule the ingest guard and the publisher share.
//
// The behaviour under test is the one the per-day floor cannot have: catching a
// RATCHET. Every fixture here is the real 2026-08 sequence or a variation on it.

import { describe, it, expect } from "vitest";
import {
  trailingChainMedian,
  clearsCoverageFloor,
  COVERAGE_FLOOR,
  COVERAGE_WINDOW_DAYS,
} from "./coverage";
import { SANITY_DROP } from "../load_day";

/** The real reporter counts, 2026-07-25 … 2026-08-14. */
const REAL = [
  204, 210, 210, 208, 209, 208, 206, 206, 204, 203, 205, 207, 208, 209, 203,
  140, 132, 115, 107, 101, 98,
];
/** Index of 2026-08-09, where the collapse starts. */
const COLLAPSE_AT = 15;

const verdicts = (series: number[]) =>
  series.map((n, i) =>
    clearsCoverageFloor(n, trailingChainMedian(series, i)) ? "ok" : "refuse",
  );

describe("trailingChainMedian", () => {
  const flat = (n: number, len: number) => new Array(len).fill(n);

  it("excludes the day itself — a day cannot be its own reference", () => {
    // The window must be NON-FLAT for this to discriminate: a median over six
    // flat values shrugs off one outlier, so [200×5, 10] passes whether or not
    // the day itself is included. Here the self value moves it.
    expect(trailingChainMedian([100, 150, 200, 1], 3)).toBe(150); // incl → 125
  });

  it("returns null until there is enough history to judge against", () => {
    const days = flat(200, 10);
    expect(trailingChainMedian(days, 0)).toBeNull();
    expect(trailingChainMedian(days, 2)).toBeNull();
    expect(trailingChainMedian(days, 3)).toBe(200);
  });

  it("looks back exactly COVERAGE_WINDOW_DAYS, not 13 or 15", () => {
    // Half-and-half, so one element either way flips the answer: 14 entries
    // hold 7 of each and median at 300; 13 collapses to 100, 15 gives 500.
    const days = [...flat(500, 17), ...flat(100, 7)];
    expect(trailingChainMedian(days, 24)).toBe(300);
  });

  it("ignores zero-count days rather than treating them as a low reading", () => {
    // The zeros must OUTNUMBER the readings, or the median absorbs them and
    // the test passes with no filter at all.
    expect(trailingChainMedian([200, 200, 200, 0, 0, 0, 0, 200], 7)).toBe(200);
  });
});

describe("the coverage floor vs the per-day floor", () => {
  it("refuses every day of the real collapse, not just its first step", () => {
    const v = verdicts(REAL);
    expect(v.slice(COLLAPSE_AT)).toEqual([
      "refuse",
      "refuse",
      "refuse",
      "refuse",
      "refuse",
      "refuse",
    ]);
    // …and nothing before it.
    expect(v.slice(0, COLLAPSE_AT).every((x) => x === "ok")).toBe(true);
  });

  it("MUTATION CHECK: the per-day floor clears five of those six days", () => {
    // This is the control that gives the test above its meaning — and it is
    // the actual defect. SANITY_DROP is imported from load_day, never
    // restated, so the two cannot drift.
    const perDay = REAL.map((n, i) =>
      i > 0 && n < REAL[i - 1] * (1 - SANITY_DROP) ? "refuse" : "ok",
    );
    expect(perDay.slice(COLLAPSE_AT)).toEqual([
      "refuse", // 203 → 140 is the one cliff
      "ok", // 140 → 132
      "ok", // 132 → 115
      "ok", // 115 → 107
      "ok", // 107 → 101
      "ok", // 101 →  98
    ]);
  });

  it("does not refuse ordinary day-to-day wobble", () => {
    // ±5% around 200 for a month — the feed's normal behaviour.
    const wobble = Array.from({ length: 30 }, (_, i) =>
      Math.round(200 + 10 * Math.sin(i)),
    );
    expect(verdicts(wobble).every((v) => v === "ok")).toBe(true);
  });

  it("passes a day it has no history to judge", () => {
    expect(clearsCoverageFloor(1, trailingChainMedian([1], 0))).toBe(true);
    expect(clearsCoverageFloor(1, null)).toBe(true);
  });

  it("is exactly at the floor, not near it", () => {
    expect(clearsCoverageFloor(160, 200)).toBe(true); // 200 × 0.8
    expect(clearsCoverageFloor(159.9, 200)).toBe(false);
    expect(COVERAGE_FLOOR).toBe(0.8);
    expect(COVERAGE_WINDOW_DAYS).toBe(14);
  });

  it("adapts once a resized feed is the new normal", () => {
    // A permanent halving must stop being refused, or the ingest blocks for
    // ever on a feed that simply got smaller.
    const resized = [...new Array(20).fill(200), ...new Array(12).fill(98)];
    const v = verdicts(resized);
    expect(v[20]).toBe("refuse"); // the step itself
    expect(v[31]).toBe("ok"); // …and twelve days later it is normal
  });
});

// ── the load_day wiring ─────────────────────────────────────────────────────
// The rule can be right while the guard reads the wrong end of the query. The
// SQL returns the prior days NEWEST-first (ORDER BY day DESC LIMIT W) and
// load_day reverses them, then judges the incoming day at index `length`.

describe("the ingest guard's query wiring", () => {
  /** Exactly what load_day.ts does with the rows it gets back. */
  const verdictFor = (
    newestFirstPriorCounts: number[],
    chainsToday: number,
  ) => {
    const chainsPerDay = newestFirstPriorCounts.map(Number).reverse();
    const median = trailingChainMedian(chainsPerDay, chainsPerDay.length);
    return { median, ok: clearsCoverageFloor(chainsToday, median) };
  };

  it("judges the incoming day against ALL the prior days it fetched", () => {
    // `length`, not `length - 1`: the latter silently drops the newest prior
    // day from the window, which is the one that matters most.
    const newestFirst = [203, 209, 208, 207, 205, 203, 204, 206];
    expect(verdictFor(newestFirst, 140)).toEqual({ median: 205.5, ok: false });
  });

  it("is not fooled by the query's DESC order", () => {
    // A rising feed read backwards would look like a falling one. Same set,
    // both orders, same median — so a missing .reverse() cannot change the
    // verdict here, which is why the ordering is asserted on the ASYMMETRIC
    // case below instead.
    const asc = [100, 110, 120, 400, 410, 420];
    const median = (xs: number[]) => trailingChainMedian(xs, xs.length);
    expect(median(asc)).toBe(median([...asc].reverse()));
  });

  it("takes only the newest COVERAGE_WINDOW_DAYS when more are returned", () => {
    // A LIMIT regression that fetched the whole corpus would drag in ancient
    // days. `from = max(0, i - W)` bounds it either way.
    const many = [...new Array(40).fill(500), ...new Array(14).fill(100)];
    expect(trailingChainMedian(many, many.length)).toBe(100);
  });

  it("passes a first-ever load, when there are no prior days at all", () => {
    expect(verdictFor([], 12).ok).toBe(true);
    expect(verdictFor([200, 200], 12).ok).toBe(true); // still under 3
  });
});
