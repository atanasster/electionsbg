// The чл. 130а threshold counts STATUTORY conditions, not МФ's columns: МФ publishes seven, the
// law lists six, and МФ's 1 and 2 are the two halves of т. 1 (чл. 32 ал. 1 and 2).

import { describe, expect, it, vi } from "vitest";
import {
  evaluateCriteria,
  statutoryConditionsMet,
} from "./load_municipal_fiscal_pg";

describe("statutoryConditionsMet", () => {
  it("counts МФ 1 and 2 as the single condition т. 1", () => {
    expect(statutoryConditionsMet([1, 2])).toBe(1);
    // Both debt rules breached plus one more is TWO conditions — below the ≥3 threshold,
    // although it is three of МФ's columns.
    expect(statutoryConditionsMet([1, 2, 5])).toBe(2);
  });

  it("counts every other criterion once", () => {
    expect(statutoryConditionsMet([1, 3, 5])).toBe(3);
    expect(statutoryConditionsMet([2, 4, 6, 7])).toBe(4);
    expect(statutoryConditionsMet([])).toBe(0);
  });
});

describe("evaluateCriteria on МФ's official criteria", () => {
  // Only the fields the official branch reads; the rest of the quarter is irrelevant to it.
  const row = (officialCriteriaMet: number[]) =>
    ({
      obshtina: "TST01",
      nameBg: "Тест",
      fiscalYear: 2024,
      quarter: 4,
      officialCriteriaMet,
    }) as unknown as Parameters<typeof evaluateCriteria>[0];

  it("three distinct conditions meet the threshold", () => {
    expect(evaluateCriteria(row([1, 3, 5])).meetsThreshold).toBe(true);
  });

  it("two of three columns are the two halves of т. 1 → UNKNOWN, not either verdict", () => {
    // МФ's column count says three, the statute's condition count says two; the release does
    // not say which the ministry applies, so neither is published.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(evaluateCriteria(row([1, 2, 5])).meetsThreshold).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("both counts agree below and above the line", () => {
    expect(evaluateCriteria(row([3, 5])).meetsThreshold).toBe(false);
    expect(evaluateCriteria(row([1, 2, 5, 6])).meetsThreshold).toBe(true);
  });
});
