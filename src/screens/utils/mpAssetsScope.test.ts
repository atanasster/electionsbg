// Every pure export of mpAssetsScope.ts, in one place beside the module (the repo's
// stated convention — docs/testing-standards.md). The `mpAssetsNsScope` /
// `mpAssetsIdFilters` blocks below moved here from AllMpAssetsScreen.test.tsx, which
// rendered no screen and left one module's coverage split across two directories.
//
// `useMpAssetsScope` is deliberately NOT tested here — it is a hook over the shared
// `?pscope` param, and what matters about it (that the control and the page resolve to
// one value) is pinned by scopeContract.test.ts, which sweeps every ScopeControl call
// site rather than trusting a per-caller assertion.

import { describe, expect, it } from "vitest";
import {
  mpAssetsIdFilters,
  mpAssetsNsScope,
  mpAssetsToPscope,
  pscopeToMpAssets,
} from "./mpAssetsScope";

// The `?pscope` ↔ MpAssetsScope mapping. Three surfaces read it — the
// /governance/declarations tiles, /mp-assets and /mp-cars — and the hub's figures
// are only honest because they are computed on the slice the page they open will
// show. Measured on the committed blob: the 52nd's 42 cars against 643 all-time,
// a 15× gap, so a mapping that disagrees between hub and destination is not a
// rounding difference but a different claim.
describe("pscope ↔ MpAssetsScope", () => {
  it("maps every scope the shared param can carry", () => {
    expect(pscopeToMpAssets("all")).toBe("all");
    expect(pscopeToMpAssets("ns")).toBe("ns");
  });

  it("sends a YEAR to the parliament slice, never to an empty one", () => {
    // `?pscope` rides along on ordinary in-app links, so a year minted where it is
    // valid (y:2019 on /procurement) reaches this register — which has no year
    // slices at all, because 2024 held two parliaments and no calendar year names
    // one. Resolving it to "all" would silently widen the reader's window by 15×;
    // treating it as its own scope would query a bucket with no rows and render
    // „no MPs declared assets".
    expect(pscopeToMpAssets("y:2019")).toBe("ns");
    expect(pscopeToMpAssets("y:2026")).toBe("ns");
  });

  it("round-trips, so the hub and its destination cannot part company", () => {
    // NB: an INVARIANT, not a pin — a doubly-inverted pair round-trips cleanly too.
    // What rules that out is the two cases above, which fix each direction's endpoints,
    // plus the year case. Do not delete them believing this one covers them.
    for (const s of ["ns", "all"] as const) {
      expect(pscopeToMpAssets(mpAssetsToPscope(s))).toBe(s);
    }
  });

  it("keeps `ns` out of the URL as the shared param's default", () => {
    // useScope drops "ns" so the canonical URL has no ?pscope. The inverse must
    // therefore return exactly the literal "ns" it recognises — a synonym would
    // pin a redundant param on every link out of the two screens.
    expect(mpAssetsToPscope("ns")).toBe("ns");
    expect(mpAssetsToPscope("all")).toBe("all");
  });
});

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
