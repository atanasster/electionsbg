// Fast, hermetic gate on the sampling rule behind eop_notice_coverage.data.test.ts.
// No store, no corpus, milliseconds — which is the point: the property it pins was
// previously observable only against the 1.8 GB gitignored capture.

import { describe, test, expect } from "vitest";
import { strideSample } from "./eop_coverage_sample";

/** Stand-in for the real corpus: ordered ids, wide range, era-correlated by index. */
const IDS = Array.from({ length: 10_000 }, (_, i) => 56_505 + i * 54);

describe("strideSample", () => {
  test("spans the whole range rather than clustering at the front", () => {
    const sample = strideSample(IDS, 100);
    const last = IDS[IDS.length - 1];
    const first = IDS[0];
    // The final pick must land in the last decile of the id range.
    expect(Math.max(...sample)).toBeGreaterThan(first + (last - first) * 0.9);
    expect(Math.min(...sample)).toBe(first);
  });

  // ⚠️ THE MUTATION CHECK. Without it, "the sample spans the range" is satisfied by
  // any implementation on a small enough input, and the assertion above could pass
  // for a prefix. Re-run the SAME property against `ids.slice(0, n)` — the edit this
  // rule exists to forbid — and require it to FAIL.
  test("a prefix implementation fails the span property", () => {
    const prefix = IDS.slice(0, 100);
    const first = IDS[0];
    const last = IDS[IDS.length - 1];
    expect(Math.max(...prefix)).toBeLessThan(first + (last - first) * 0.9);
    // And the two really are different selections, not coincidentally equal.
    expect(strideSample(IDS, 100)).not.toEqual(prefix);
  });

  test("never returns more than the requested size", () => {
    for (const n of [1, 7, 100, 2_000, 9_999])
      expect(strideSample(IDS, n).length).toBeLessThanOrEqual(n);
  });

  test("returns everything when the sample is at least the corpus", () => {
    const small = [1, 2, 3, 4, 5];
    expect(strideSample(small, 5)).toEqual(small);
    // The stride would floor to 0 here; `i % 0` is NaN, so an unguarded version
    // returns [] — every id dropped rather than every id kept.
    expect(strideSample(small, 50)).toEqual(small);
  });

  test("preserves input order and does not duplicate", () => {
    const sample = strideSample(IDS, 250);
    expect([...sample].sort((a, b) => a - b)).toEqual(sample);
    expect(new Set(sample).size).toBe(sample.length);
  });

  test("is deterministic", () => {
    expect(strideSample(IDS, 137)).toEqual(strideSample(IDS, 137));
  });

  test("an empty corpus yields an empty sample rather than throwing", () => {
    expect(strideSample([], 100)).toEqual([]);
  });

  // A NaN/zero size must not silently measure nothing — see the module's @throws.
  test("refuses a size that would silently empty the gate", () => {
    for (const bad of [0, -1, 1.5, NaN])
      expect(() => strideSample(IDS, bad)).toThrow(/positive integer/);
  });
});
