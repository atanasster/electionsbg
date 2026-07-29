// Coverage for the КСО replacement-rate formula behind the /pensions
// "Каква пенсия ще получа" tile.
//
// This had NO tests while its four statutory inputs were hard-coded in 2024 лв
// inside the tile — so when they were repointed at the shared schedule, nothing
// caught that pairing 2026 bounds with a 2024 wage anchor moved the published
// rates by up to +8.7pp and squeezed the high earner to within 1.7pp of the
// median, erasing the "high earners are capped" shape the chart exists to show.
//
// The invariant that matters is therefore VINTAGE CONSISTENCY: a replacement
// rate is a pension over a wage, so both sides must come from the same year.
import { describe, expect, it } from "vitest";
import {
  earnerSignature,
  DEFAULT_ACCRUAL,
  type PensionFormulaParams,
} from "./pensionFormula";
import {
  MIN_WAGE_SCHEDULE,
  MIN_PENSION_SCHEDULE,
  MAX_PENSION,
  resolveMod,
  scheduledValueAt,
} from "./bgTax";

/** The params the tile builds, for a given data vintage. */
const paramsFor = (year: number, avgWageEur: number): PensionFormulaParams => ({
  avgWageEur,
  accrualPerYear: DEFAULT_ACCRUAL,
  minInsurableEur: scheduledValueAt(MIN_WAGE_SCHEDULE, year),
  maxInsurableEur: resolveMod(year).mod,
  minPensionEur: scheduledValueAt(MIN_PENSION_SCHEDULE, year),
  pensionCapEur: MAX_PENSION,
});

// The shipped НОИ vintage: pensions.json latestYear 2024, avg wage €1,188.
const Y2024 = paramsFor(2024, 1188);

describe("earnerSignature — shape", () => {
  it("returns a low / median / high signature", () => {
    const sig = earnerSignature(Y2024, 40);
    expect(sig).toHaveLength(3);
    for (const s of sig) {
      expect(s.replacement).toBeGreaterThan(0);
      expect(s.replacement).toBeLessThan(1.5);
    }
  });

  it("leaves the high earner visibly BELOW the median — the таван is the story", () => {
    // The chart's whole message. With 2024 params over the 2024 wage the gap is
    // ~10pp; pairing 2026 bounds with the same wage collapsed it to 1.7pp.
    const [, median, high] = earnerSignature(Y2024, 40);
    expect(high.replacement).toBeLessThan(median.replacement);
    expect(median.replacement - high.replacement).toBeGreaterThan(0.05);
  });

  it("never insures the low earner above their own wage", () => {
    // 0.5 × €1,188 = €594. The 2024 МРЗ (€477.04) sits below it, so the floor
    // does not bind. The 2026 МРЗ (€620.20) would — rendering a worker paid
    // below the legal minimum and dividing by a wage nobody earns.
    const lowWage = 0.5 * Y2024.avgWageEur;
    expect(Y2024.minInsurableEur).toBeLessThanOrEqual(lowWage);
  });

  it("rises with career length", () => {
    const short = earnerSignature(Y2024, 30);
    const long = earnerSignature(Y2024, 40);
    for (let i = 0; i < short.length; i++)
      expect(long[i].replacement).toBeGreaterThan(short[i].replacement);
  });
});

describe("statutory bounds actually bind", () => {
  it("caps the insurable base at the МОД", () => {
    // A very high earner's pension must not exceed what the cap can accrue.
    const rich = earnerSignature({ ...Y2024, avgWageEur: 10_000 }, 40);
    for (const s of rich)
      expect(s.pensionEur).toBeLessThanOrEqual(Y2024.pensionCapEur + 0.01);
  });

  it("holds the smallest pension up to the statutory minimum", () => {
    const tiny = earnerSignature({ ...Y2024, avgWageEur: 100 }, 5);
    for (const s of tiny)
      expect(s.pensionEur).toBeGreaterThanOrEqual(Y2024.minPensionEur - 0.01);
  });
});

describe("vintage consistency", () => {
  it("resolves every bound from the SAME year as the wage anchor", () => {
    // 2024 must give 2024 bounds — the guard against a 2026 cap over a 2024
    // wage, which is a units error dressed up as a policy result.
    expect(Y2024.minInsurableEur).toBe(477.04);
    expect(Y2024.maxInsurableEur).toBe(1917);
    expect(Y2024.minPensionEur).toBe(296.85);
  });

  it("advances every bound together when the data year advances", () => {
    const y2026 = paramsFor(2026, 1188);
    expect(y2026.minInsurableEur).toBe(620.2);
    expect(y2026.maxInsurableEur).toBe(2300);
    expect(y2026.minPensionEur).toBe(347.51);
  });

  it("is stable for the shipped vintage — this curve is published", () => {
    // A regression pin. These are the rates /pensions renders today; a change
    // here means the published chart moved and must be intentional.
    const pct = earnerSignature(Y2024, 40).map((s) =>
      Number((s.replacement * 100).toFixed(1)),
    );
    expect(pct).toEqual([54.0, 54.0, 43.6]);
  });
});
