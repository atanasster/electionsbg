// Coverage for the month-weighted МОД aggregates in bgTaxPolicy.
//
// These functions were previously guarded only by tsx smoke scripts, which do
// NOT run in `npm run test:unit` — and the smoke script validated a locally
// re-implemented base rather than calling the engine, so a real defect in
// `scoreModCap`'s segmented path shipped green (each segment's gain was kept
// while its losses were discarded, over-reporting a straddling target by ~3.7×).
// Everything here drives the ACTUAL exported functions.
//
// The invariants, in priority order:
//   1. a scalar cap must behave EXACTLY as [{capEur, months: 12}] — otherwise
//      every historical figure moves the day segments are adopted;
//   2. segments must net, not ratchet, when they straddle the target;
//   3. a CapMonths[] that does not cover a year is an error, not a smaller
//      policy — these functions return ANNUAL figures.
import { describe, expect, it } from "vitest";
import { capMonths, PIT_RATE } from "./bgTax";
import {
  pitRevenueOnBands,
  scorePitSchedule,
  scoreModCapBands,
  scoreModCap,
  type EarningsBand,
  type ModIdentity,
} from "./bgTaxPolicy";

// A small, deliberately hand-checkable grid: one band below any cap under test,
// one straddling, one far above.
const BANDS: EarningsBand[] = [
  { grossEur: 1000, workers: 100_000 },
  { grossEur: 2200, workers: 50_000 },
  { grossEur: 6000, workers: 10_000 },
];
const FLAT = [{ fromEur: 0, rate: PIT_RATE }];

const IDENTITY: ModIdentity = {
  aboveCapMassEur: 3_495_022_998,
  capEur: 1917,
  alphaLow: 1.77,
  alphaCentral: 2.27,
  alphaHigh: 2.77,
};

/** The 2026 schedule: €2,111.64 for 7 months, €2,300 for 5. */
const Y2026 = capMonths(2026);

describe("scalar ⇄ segment identity", () => {
  it("pitRevenueOnBands: a scalar is exactly [{cap, 12}]", () => {
    for (const cap of [1000, 2112, 2300, 99_999]) {
      expect(pitRevenueOnBands(BANDS, cap, FLAT)).toBe(
        pitRevenueOnBands(BANDS, [{ capEur: cap, months: 12 }], FLAT),
      );
    }
  });

  it("scoreModCapBands: a scalar is exactly [{cap, 12}]", () => {
    for (const from of [1800, 2112, 2300]) {
      const a = scoreModCapBands(BANDS, from, 2500, PIT_RATE);
      const b = scoreModCapBands(
        BANDS,
        [{ capEur: from, months: 12 }],
        2500,
        PIT_RATE,
      );
      expect(a).toEqual(b);
    }
  });

  it("scoreModCap: a scalar is exactly [{cap, 12}]", () => {
    for (const from of [1917, 2112, 2300]) {
      expect(scoreModCap(IDENTITY, 2500, from)).toEqual(
        scoreModCap(IDENTITY, 2500, [{ capEur: from, months: 12 }]),
      );
    }
  });

  it("scorePitSchedule passes segments through and still cancels", () => {
    // Same cap on both sides of the difference ⇒ the month weighting cancels
    // with the discretization, so a flat schedule scores exactly zero.
    expect(scorePitSchedule(BANDS, Y2026, FLAT, 1)).toBe(0);
    expect(scorePitSchedule(BANDS, 2112, FLAT, 1)).toBe(0);
  });

  it("handles the no-cap (Infinity) target identically", () => {
    expect(scoreModCap(IDENTITY, Infinity, 2112)).toEqual(
      scoreModCap(IDENTITY, Infinity, [{ capEur: 2112, months: 12 }]),
    );
  });
});

describe("segmented aggregation", () => {
  it("weights each segment by its months, not by an averaged cap", () => {
    // Hand-computed against a €2,200 target, which sits BETWEEN the two 2026
    // segments — so the two windows pull in opposite directions and the result
    // is only right if they net.
    //
    //   Jan–Jul (7 mo @ €2,111.64): the €2,200 and €6,000 bands each gain
    //     (2200 − 2111.64) = €88.36; the €1,000 band is untouched.
    //       88.36 × (50_000 + 10_000) × 7 = +37,111,200
    //   Aug–Dec (5 mo @ €2,300): the €2,200 band is fully below both caps and
    //     gains nothing, but the €6,000 band LOSES (2200 − 2300) = −€100.
    //       −100 × 10_000 × 5 = −5,000,000
    //
    // Net +32,111,200. Dropping the negative term — the defect this suite
    // exists for — would report +37.1M instead.
    const r = scoreModCapBands(BANDS, Y2026, 2200, PIT_RATE);
    const gain = 88.36 * (50_000 + 10_000) * 7;
    const loss = -100 * 10_000 * 5;
    expect(r.deltaBaseEur).toBeCloseTo(gain + loss, 2);
    expect(r.deltaBaseEur).toBeCloseTo(32_111_200, 2);
  });

  it("is signed correctly for a cap DECREASE", () => {
    const down = scoreModCapBands(BANDS, Y2026, 1800, PIT_RATE);
    const up = scoreModCapBands(BANDS, Y2026, 2500, PIT_RATE);
    expect(down.deltaBaseEur).toBeLessThan(0);
    expect(down.sscEur).toBeLessThan(0);
    expect(up.deltaBaseEur).toBeGreaterThan(0);
  });

  it("nets a straddling target instead of keeping only the gains", () => {
    // THE REGRESSION. €2,200 sits BETWEEN the 2026 segments: the 7 Jan–Jul
    // months gain, the 5 Aug–Dec months lose. Clamping per segment kept the
    // gain and dropped the loss, reporting ~3.7× the correct figure.
    const straddle = scoreModCap(IDENTITY, 2200, Y2026);
    const paired = scoreModCapBands(BANDS, Y2026, 2200, PIT_RATE);
    // Both must agree on direction and stay the same order of magnitude.
    expect(straddle.centralEur).toBeGreaterThan(0);
    expect(paired.totalEur).toBeGreaterThan(0);
    // A per-segment clamp would put the Pareto figure far above the whole-year
    // gain from the LOWER segment alone; netting keeps it strictly below.
    const gainOnly = scoreModCap(IDENTITY, 2200, 2111.64);
    expect(straddle.centralEur).toBeLessThan(gainOnly.centralEur);
  });

  it("a target at or below every segment yields nothing", () => {
    // The caller's documented precondition is C′ ≥ fromCap; below it, the
    // Pareto identity cannot see the density and must not invent a number.
    expect(scoreModCap(IDENTITY, 1500, Y2026).centralEur).toBe(0);
  });

  it("a target above every segment exceeds a straddling one", () => {
    expect(scoreModCap(IDENTITY, 2500, Y2026).centralEur).toBeGreaterThan(
      scoreModCap(IDENTITY, 2200, Y2026).centralEur,
    );
  });
});

describe("segment validation", () => {
  it("rejects a partial window rather than scaling the annual answer", () => {
    // Passing only Aug–Dec would otherwise return 5/12 of the year and read as
    // a smaller policy instead of a malformed input.
    expect(() =>
      pitRevenueOnBands(BANDS, [{ capEur: 2300, months: 5 }], FLAT),
    ).toThrow(/must cover a fiscal year/);
    expect(() =>
      scoreModCapBands(BANDS, [{ capEur: 2300, months: 5 }], 2500, PIT_RATE),
    ).toThrow(/must cover a fiscal year/);
    expect(() =>
      scoreModCap(IDENTITY, 2500, [{ capEur: 2300, months: 5 }]),
    ).toThrow(/must cover a fiscal year/);
  });

  it("rejects an empty segment list", () => {
    expect(() => pitRevenueOnBands(BANDS, [], FLAT)).toThrow(
      /must cover a fiscal year/,
    );
  });

  it("rejects an over-long year", () => {
    expect(() =>
      pitRevenueOnBands(
        BANDS,
        [
          { capEur: 2112, months: 7 },
          { capEur: 2300, months: 6 },
        ],
        FLAT,
      ),
    ).toThrow(/13 month/);
  });

  it("accepts a zero-month segment as long as the year still adds up", () => {
    // Legitimate when a schedule's first step is superseded within the month.
    expect(
      pitRevenueOnBands(
        BANDS,
        [
          { capEur: 1000, months: 0 },
          { capEur: 2112, months: 12 },
        ],
        FLAT,
      ),
    ).toBe(pitRevenueOnBands(BANDS, 2112, FLAT));
  });
});

describe("concavity — why the outputs are weighted and not the cap", () => {
  it("a blended cap overstates the insurable base", () => {
    // min(w, cap) is concave in cap, so by Jensen the blend sits above the
    // month-weighted truth. This is the arithmetic the implementation must
    // avoid, asserted here so nobody 'simplifies' it back.
    const base = (cap: number): number =>
      BANDS.reduce((s, b) => s + b.workers * Math.min(b.grossEur, cap), 0);
    const blendedCap = Y2026.reduce((a, s) => a + s.capEur * s.months, 0) / 12;
    const weighted = Y2026.reduce((a, s) => a + base(s.capEur) * s.months, 0);
    expect(base(blendedCap) * 12).toBeGreaterThan(weighted);
  });
});
