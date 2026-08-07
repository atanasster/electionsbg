import { describe, it, expect } from "vitest";
import {
  BUDGET_BASES,
  PLACE_BASES,
  INTERREG_PERIODS,
  isLinkedBasis,
  type BudgetBasis,
  type PlaceBasis,
  type InterregPeriod,
} from "./types";

describe("the basis vocabularies", () => {
  // BUDGET_BASES / PLACE_BASES / INTERREG_PERIODS are hand-maintained runtime
  // duplicates of their unions, because TypeScript cannot derive an array from
  // a type. Adding a union member without adding the array entry compiles
  // cleanly and silently narrows any validation built on the array — so the
  // Record literals below are the real gate: a missing member makes them
  // incomplete and this file stops compiling.
  it("keeps the const arrays exhaustive against their unions", () => {
    const budget: Record<BudgetBasis, true> = {
      published: true,
      published_zero: true,
      unpublished: true,
    };
    const place: Record<PlaceBasis, true> = {
      "eik:awarder_seats": true,
      "eik:tr": true,
      "postal+name+province": true,
      "postal+name": true,
      postal_only: true,
      "name+province": true,
      name_only: true,
      roster: true,
    };
    const period: Record<InterregPeriod, true> = {
      "2014-2020": true,
      "2021-2027": true,
    };

    expect([...BUDGET_BASES].sort()).toEqual(Object.keys(budget).sort());
    expect([...PLACE_BASES].sort()).toEqual(Object.keys(place).sort());
    expect([...INTERREG_PERIODS].sort()).toEqual(Object.keys(period).sort());
  });

  it("has no duplicate member in any vocabulary", () => {
    expect(new Set(BUDGET_BASES).size).toBe(BUDGET_BASES.length);
    expect(new Set(PLACE_BASES).size).toBe(PLACE_BASES.length);
    expect(new Set(INTERREG_PERIODS).size).toBe(INTERREG_PERIODS.length);
  });
});

describe("isLinkedBasis — the Tier L / Tier P split", () => {
  it("treats exactly the two eik: bands as linked", () => {
    for (const b of PLACE_BASES)
      expect(isLinkedBasis(b), b).toBe(b.startsWith("eik:"));
  });

  // An unplaced row is not linked. It is the majority case for 2014-2020,
  // whose template carries no identity column at all.
  it("treats an unplaced row as not linked", () => {
    expect(isLinkedBasis(null)).toBe(false);
  });

  it("counts the two tiers to the split the plan reports", () => {
    const linked = PLACE_BASES.filter(isLinkedBasis);
    expect(linked).toEqual(["eik:awarder_seats", "eik:tr"]);
    expect(PLACE_BASES.length - linked.length).toBe(6);
  });
});
