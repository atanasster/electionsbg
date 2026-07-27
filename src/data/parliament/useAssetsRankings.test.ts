// The pure client-side helpers behind the MP-assets registry migration
// (persons-pg-retirement-v1 T2.2): string-money parsing and the empty-set sentinel that the
// tiles feed into useMpAssetsTopRows. No network, no DB.

import { describe, it, expect } from "vitest";
import { eur, toScopedMpIds } from "./useAssetsRankings";

describe("eur (PG numeric string → number | null)", () => {
  it("parses a numeric string", () => {
    expect(eur("1234.5")).toBe(1234.5);
    expect(eur("0")).toBe(0);
    expect(eur(10972598)).toBe(10972598);
  });
  it("returns null for a missing figure (distinct from declared zero)", () => {
    expect(eur(null)).toBeNull();
    expect(eur(undefined)).toBeNull();
    expect(eur("")).toBeNull();
  });
  it("returns null for a non-numeric string rather than NaN", () => {
    expect(eur("abc")).toBeNull();
  });
});

describe("toScopedMpIds (empty-set sentinel)", () => {
  it("preserves null/undefined as unscoped (the whole scope)", () => {
    expect(toScopedMpIds(null)).toBeNull();
    expect(toScopedMpIds(undefined)).toBeNull();
  });
  it("passes a non-empty id list through", () => {
    expect(toScopedMpIds([1, 2, 3])).toEqual([1, 2, 3]);
  });
  it("maps a scoped-but-EMPTY set to [-1], never [] (which the server drops)", () => {
    // The whole point: [] would show the entire scope; [-1] forces zero rows.
    expect(toScopedMpIds([])).toEqual([-1]);
  });
});
