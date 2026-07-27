// The scope→registry-filter mapping for /mp-assets (persons-pg-retirement-v1 T2.2). Pure,
// deterministic, and exactly where the empty-intersection regression lived (an empty
// `mp_id IN ()` is DROPPED server-side, so a scoped-but-empty set must be forced to zero rows
// with an impossible id — never fall through to the whole scope).

import { describe, it, expect } from "vitest";
import { mpAssetsNsScope, mpAssetsIdFilters } from "./utils/mpAssetsScope";

describe("mpAssetsNsScope", () => {
  it("ns scope with a folder → { col: 'ns', val: folder }", () => {
    expect(mpAssetsNsScope("ns", "52")).toEqual({ col: "ns", val: "52" });
  });
  it("ns scope with no folder falls back to the national bucket", () => {
    expect(mpAssetsNsScope("ns", undefined)).toEqual({ col: "ns", val: "all" });
  });
  it("all scope is always the national bucket", () => {
    expect(mpAssetsNsScope("all", "52")).toEqual({ col: "ns", val: "all" });
  });
});

describe("mpAssetsIdFilters", () => {
  it("no chips → no filter (whole scope)", () => {
    expect(mpAssetsIdFilters(null, null)).toEqual([]);
    expect(mpAssetsIdFilters(undefined, undefined)).toEqual([]);
  });

  it("region only → mp_id IN the region set", () => {
    expect(mpAssetsIdFilters(new Set([1, 2, 3]), null)).toEqual([
      { id: "mp_id", value: [1, 2, 3] },
    ]);
  });

  it("party only → mp_id IN the party set", () => {
    expect(mpAssetsIdFilters(null, new Set([4, 5]))).toEqual([
      { id: "mp_id", value: [4, 5] },
    ]);
  });

  it("region ∩ party → the intersection, not the union", () => {
    expect(mpAssetsIdFilters(new Set([1, 2, 3]), new Set([2, 3, 4]))).toEqual([
      { id: "mp_id", value: [2, 3] },
    ]);
  });

  it("disjoint region ∩ party → zero rows (impossible id), NOT the whole scope", () => {
    expect(mpAssetsIdFilters(new Set([1]), new Set([2]))).toEqual([
      { id: "mp_id", value: [-1] },
    ]);
  });

  it("an empty scope set is still scoped → zero rows, not unfiltered", () => {
    expect(mpAssetsIdFilters(new Set<number>(), null)).toEqual([
      { id: "mp_id", value: [-1] },
    ]);
  });
});
