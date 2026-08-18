// Unit tests for `matchedCell` — the chain-matching that makes the price index
// robust to a reporter set that changes size.
//
// This is the whole of the fix for the defect measured on 2026-08-09 (the КЗП
// feed went 203 → 98 chains in six days and the national index moved 4.19
// points in a day with no price changing), and nothing else in the repo can
// catch a regression in it. `prices_payload_parity.data.test.ts` is
// structurally incapable of it: as its own header says, it builds BOTH sides
// through the same `buildPriceIndex()`, so an inverted `matchedCell` passes it
// on both sides identically.

import { describe, it, expect } from "vitest";
import { matchedCell } from "./build_index";

/** A day's `chainCells[ekatte]`: eik -> pid -> that chain's min price. */
const day = (o: Record<string, Record<string, number>>) => o;

describe("matchedCell", () => {
  it("keeps only chains present on BOTH days", () => {
    const now = day({ A: { "1": 2 }, B: { "1": 10 } });
    const base = day({ A: { "1": 1 } }); // B did not report on the base day
    const m = matchedCell(now, base);
    // B is excluded from both sides, so the ratio is A's alone: 2 / 1.
    expect(m.now.get(1)).toBe(2);
    expect(m.base.get(1)).toBe(1);
    expect(m.chains).toBe(1);
  });

  it("is unmoved by a chain joining the feed — the defect this fixes", () => {
    const base = day({ A: { "1": 10 }, B: { "1": 12 } });
    const before = matchedCell(day({ A: { "1": 10 }, B: { "1": 12 } }), base);
    // A discounter joins, pricing far below everyone. The POOLED median would
    // drop; the matched one must not move at all, because C has no base price.
    const after = matchedCell(
      day({ A: { "1": 10 }, B: { "1": 12 }, C: { "1": 1 } }),
      base,
    );
    expect(after.now.get(1)).toBe(before.now.get(1));
    expect(after.base.get(1)).toBe(before.base.get(1));
    expect(after.chains).toBe(before.chains);
  });

  it("is unmoved by a chain LEAVING the feed", () => {
    const base = day({ A: { "1": 10 }, B: { "1": 20 }, C: { "1": 30 } });
    const all = matchedCell(
      day({ A: { "1": 10 }, B: { "1": 20 }, C: { "1": 30 } }),
      base,
    );
    expect(all.now.get(1)).toBe(20); // median of 10, 20, 30

    // C drops out. Both sides lose it, so the ratio stays 1 — the index reads
    // "no change", which is the truth. (The LEVEL legitimately moves; that is
    // basketLevel's problem, not the index's.)
    const gone = matchedCell(day({ A: { "1": 10 }, B: { "1": 20 } }), base);
    expect(gone.now.get(1)! / gone.base.get(1)!).toBe(1);
    expect(gone.chains).toBe(2);
  });

  it("matches per (chain, product), not per chain", () => {
    // A prices both products; B prices product 2 only on the base day.
    const now = day({ A: { "1": 4, "2": 8 }, B: { "1": 6 } });
    const base = day({ A: { "1": 2, "2": 4 }, B: { "2": 3 } });
    const m = matchedCell(now, base);
    expect(m.now.get(1)).toBe(4); // B's product 1 has no base → excluded
    expect(m.now.get(2)).toBe(8); // B's product 2 has no now → excluded
    expect(m.base.get(1)).toBe(2);
    expect(m.base.get(2)).toBe(4);
  });

  it("returns identical key sets, so base.get(pid)! is always safe", () => {
    const m = matchedCell(
      day({ A: { "1": 1, "2": 2, "3": 3 }, B: { "2": 5 } }),
      day({ A: { "1": 9, "3": 7 }, B: { "2": 4 } }),
    );
    expect([...m.now.keys()].sort()).toEqual([...m.base.keys()].sort());
    for (const pid of m.now.keys()) expect(m.base.get(pid)).toBeDefined();
  });

  it("yields two EMPTY maps when either side is absent — never a partial", () => {
    const some = day({ A: { "1": 1 } });
    for (const [n, b] of [
      [undefined, some],
      [some, undefined],
      [undefined, undefined],
    ] as const) {
      const m = matchedCell(n, b);
      expect(m.now.size).toBe(0);
      expect(m.base.size).toBe(0);
      expect(m.chains).toBe(0);
    }
  });

  it("yields empty maps when the chains simply do not overlap", () => {
    const m = matchedCell(day({ A: { "1": 1 } }), day({ B: { "1": 1 } }));
    expect(m.now.size).toBe(0);
    expect(m.chains).toBe(0);
  });

  it("drops non-positive prices on either side", () => {
    const m = matchedCell(
      day({ A: { "1": 0, "2": 5 } }),
      day({ A: { "1": 3, "2": 0 } }),
    );
    expect(m.now.size).toBe(0); // pid 1 zero now, pid 2 zero on base
  });

  it("counts only chains that matched at least one product", () => {
    // B overlaps as a chain but shares no product, so it is not a denominator.
    const m = matchedCell(
      day({ A: { "1": 2 }, B: { "9": 1 } }),
      day({ A: { "1": 1 }, B: { "8": 1 } }),
    );
    expect(m.chains).toBe(1);
  });

  it("takes the ratio of two medians, not the median of the ratios", () => {
    // Per-chain ratios are 1 and 4 → their median is 2.5. The medians are
    // (2+8)/2 = 5 now and (2+2)/2 = 2 base → 2.5 as it happens; use an even
    // split that separates the two forms instead.
    const m = matchedCell(
      day({ A: { "1": 1 }, B: { "1": 10 } }),
      day({ A: { "1": 1 }, B: { "1": 2 } }),
    );
    // medians: now (1+10)/2 = 5.5, base (1+2)/2 = 1.5 → ratio 3.667
    // median of per-chain ratios would be (1 + 5)/2 = 3
    expect(m.now.get(1)).toBeCloseTo(5.5);
    expect(m.base.get(1)).toBeCloseTo(1.5);
    expect(m.now.get(1)! / m.base.get(1)!).toBeCloseTo(3.667, 3);
  });

  it("MUTATION CHECK: the entry test fails against an unmatched implementation", () => {
    // Guards the suite from going vacuous. The assertions above are all of the
    // form "the value did not move"; an implementation that pooled every chain
    // regardless of the base day would break exactly this one, so if this stops
    // discriminating the rest of the file is no longer testing the fix.
    const pooled = (
      nowByEik: Record<string, Record<string, number>>,
      baseByEik: Record<string, Record<string, number>>,
    ) => {
      const med = (o: Record<string, Record<string, number>>) => {
        const xs = Object.values(o)
          .map((byPid) => byPid["1"])
          .filter((v) => v > 0)
          .sort((a, b) => a - b);
        const i = xs.length >> 1;
        return xs.length % 2 ? xs[i] : (xs[i - 1] + xs[i]) / 2;
      };
      return { now: med(nowByEik), base: med(baseByEik) };
    };
    const base = day({ A: { "1": 10 }, B: { "1": 12 } });
    const joined = day({ A: { "1": 10 }, B: { "1": 12 }, C: { "1": 1 } });

    // matched: unmoved.
    expect(matchedCell(joined, base).now.get(1)).toBe(
      matchedCell(day({ A: { "1": 10 }, B: { "1": 12 } }), base).now.get(1),
    );
    // pooled: moves, purely because a chain joined. 11 → 10.
    expect(pooled(joined, base).now).not.toBe(pooled(base, base).now);
  });
});
