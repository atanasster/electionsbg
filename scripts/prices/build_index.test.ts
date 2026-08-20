// Unit tests for the two pieces that make the price index robust to a КЗП
// reporter set that changes size, plus the wiring that publishes the second:
//   * `matchedCell`        — chain-matching (T0.1)
//   * the emitted `coverage` block — completeness + the headline gate (T0.5,
//                          T0.4). The RULE those two apply lives in
//                          ./lib/coverage.ts and is tested in its own file;
//                          what is tested here is the WIRING, which can be
//                          wrong while the rule is perfect.
//
// This is the whole of the fix for the defect measured on 2026-08-09 (the КЗП
// feed went 203 → 98 chains in six days and the national index moved 4.19
// points in a day with no price changing), and nothing else in the repo can
// catch a regression in it. `prices_payload_parity.data.test.ts` is
// structurally incapable of it: as its own header says, it builds BOTH sides
// through the same `buildPriceIndex()`, so an inverted `matchedCell` passes it
// on both sides identically.

import { describe, it, expect } from "vitest";
import { matchedCell, buildPriceIndex } from "./build_index";
import type { DailyGrid } from "./types";

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

// ── the wiring, not just the helpers ────────────────────────────────────────
// The pure functions above can be perfect while the `coverage` block still
// reports the wrong day, reads the wrong counter, or loses `headlineDate`.
// This drives the real buildPriceIndex over a synthetic corpus.

/** A day with one settlement, one chain, one product — enough for the index to
 *  build — and an explicit reporter count, which is the only field that
 *  matters here. `stats.chains` is what the coverage block reads. */
const gridDay = (date: string, chains: number): DailyGrid => ({
  date,
  cells: {
    "68134": {
      "1": {
        min: 1,
        avg: 1,
        max: 1,
        median: 1,
        cheapestEik: "X",
        cheapestStore: "s",
        stores: 1,
        chains: 1,
        promoMin: null,
      },
    },
  },
  chainCells: { "68134": { X: { "1": 1 } } },
  chainNames: { X: "X" },
  stats: { chains, rows: 1, settlements: 1 },
});

interface BuiltIndex {
  coverage: {
    chains: number;
    chainsTrailingMedian: number | null;
    chainsComplete: boolean;
    headlineDate: string;
    incompleteDates: string[];
  };
  national: { index: { d: string; v: number; n: number }[] };
}

/** Build over a synthetic corpus of N days and return index.json. */
const indexOf = (chainsPerDay: number[]): BuiltIndex => {
  const grids = chainsPerDay.map((c, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    return gridDay(d, c);
  });
  let out: BuiltIndex | undefined;
  buildPriceIndex({
    grids,
    emit: (kind, _key, obj) => {
      if (kind === "index") out = obj as BuiltIndex;
    },
  });
  return out!;
};

const coverageOf = (chainsPerDay: number[]) => indexOf(chainsPerDay).coverage;

describe("the emitted coverage block", () => {
  it("marks a collapsed latest day incomplete and names the last good one", () => {
    // Nine normal days then a halving — the 2026-08 shape in miniature.
    const c = coverageOf([200, 200, 200, 200, 200, 200, 200, 200, 200, 98]);
    expect(c.chains).toBe(98);
    expect(c.chainsTrailingMedian).toBe(200);
    expect(c.chainsComplete).toBe(false);
    // The last day clearing the floor — NOT the latest day.
    expect(c.headlineDate).toBe("2026-01-09");
  });

  it("marks a healthy latest day complete and headlines it", () => {
    const c = coverageOf([200, 200, 200, 200, 205]);
    expect(c.chainsComplete).toBe(true);
    expect(c.headlineDate).toBe("2026-01-05");
  });

  it("does not call the opening days incomplete for lack of history", () => {
    // Day 0 is thin, but nothing precedes it to judge it against.
    const c = coverageOf([10, 500, 500]);
    expect(c.chainsComplete).toBe(true);
    expect(c.headlineDate).toBe("2026-01-03");
  });

  it("reports the reporter count, not the settlement or row count", () => {
    // A mutant reading stats.rows or stats.settlements would see 1 here.
    const c = coverageOf([200, 200, 200, 160]);
    expect(c.chainsTrailingMedian).toBe(200);
    expect(c.chainsComplete).toBe(true); // 160 = exactly 0.8 × 200
    expect(coverageOf([200, 200, 200, 159]).chainsComplete).toBe(false);
  });
});

describe("the publish-side headline gate (T0.4)", () => {
  it("holds the headline back to the last complete day", () => {
    const c = coverageOf([200, 200, 200, 200, 200, 200, 200, 200, 200, 98]);
    expect(c.chainsComplete).toBe(false);
    expect(c.headlineDate).toBe("2026-01-09"); // NOT 2026-01-10
    expect(c.incompleteDates).toEqual(["2026-01-10"]);
  });

  it("headlines the latest day when it is complete", () => {
    const c = coverageOf([200, 200, 200, 200, 205]);
    expect(c.headlineDate).toBe("2026-01-05");
    expect(c.incompleteDates).toEqual([]);
  });

  it("holds back across a RUN of incomplete days, not just the last one", () => {
    // The 2026-08 shape: the slide keeps going, so the last complete day
    // recedes further with each day rather than being yesterday.
    const c = coverageOf([
      ...new Array(9).fill(200),
      140,
      132,
      115,
      107,
      101,
      98,
    ]);
    expect(c.headlineDate).toBe("2026-01-09");
    expect(c.incompleteDates).toHaveLength(6);
  });

  it("a collapse from the start pins the headline to the last good day", () => {
    // There is always AT LEAST one complete day: the opening days have no
    // history to be judged against, and the null median is treated as
    // complete. So headlineDate is never null, and the gate degrades to a
    // STALE headline rather than to no headline — which is the failure mode to
    // watch for, and why the build log prints how far back it reached.
    const c = coverageOf([200, 200, 200, 10, 9, 8]);
    expect(c.headlineDate).toBe("2026-01-03");
    expect(c.incompleteDates).toEqual([
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
    ]);
  });

  it("catches up on its own once a resized feed becomes the new normal", () => {
    // The trailing median adapts, so a PERMANENT resize stops being withheld
    // rather than pinning the headline for ever. Nine days at the new level is
    // enough for the median to follow.
    const c = coverageOf([
      ...new Array(14).fill(200),
      ...new Array(9).fill(98),
    ]);
    expect(c.chainsComplete).toBe(true);
    expect(c.headlineDate).toBe("2026-01-23");
  });

  it("still ships every day in the series — the gate moves the HEADLINE only", () => {
    const idx = indexOf([200, 200, 200, 200, 98]);
    expect(idx.national.index).toHaveLength(5);
    // …and the withheld day is present, not truncated away.
    expect(idx.national.index.at(-1)!.d).toBe("2026-01-05");
    expect(idx.coverage.headlineDate).toBe("2026-01-04");
  });

  it("headlineDate is always a day the series actually carries", () => {
    for (const shape of [
      [200],
      [200, 98],
      [200, 200, 200, 98, 98],
      [...new Array(20).fill(200), 98, 98, 98],
      [10, 200, 200, 200],
    ]) {
      const idx = indexOf(shape);
      const dates = idx.national.index.map((p) => p.d);
      expect(dates).toContain(idx.coverage.headlineDate);
    }
  });

  it("the three coverage keys can never contradict each other", () => {
    for (const shape of [
      [200, 200, 200, 200, 98],
      [200, 200, 200, 200, 200],
      [...new Array(16).fill(200), 98, 98, 98, 98, 98, 98, 98, 98, 98],
      [10, 500, 500, 500],
    ]) {
      const c = indexOf(shape).coverage;
      // the headline day is never one of the withheld days…
      expect(c.incompleteDates).not.toContain(c.headlineDate);
      // …and chainsComplete is exactly "the latest day is not withheld".
      const latest = indexOf(shape).national.index.at(-1)!.d;
      expect(c.chainsComplete).toBe(!c.incompleteDates.includes(latest));
    }
  });

  it("a one-day corpus headlines its only day", () => {
    const c = indexOf([200]).coverage;
    expect(c.headlineDate).toBe("2026-01-01");
    expect(c.incompleteDates).toEqual([]);
    expect(c.chainsComplete).toBe(true);
  });

  it("prefers a JUDGED day over one complete only for want of history", () => {
    // Day 0 is thin but unjudgeable, so it counts as complete. Once later days
    // ARE judged and clear the floor, the headline must be one of those — a
    // normative field must not name a day nothing actually vouched for.
    const c = indexOf([10, 500, 500, 500, 500]).coverage;
    expect(c.headlineDate).toBe("2026-01-05");
  });
});

// Plan T5, gate 3. The claim `matchedCell` exists to make true, stated as an
// INVARIANCE rather than the plan's "<0.2%" empirical bound — that number
// (0.068%, measured by removing Билла from 2026-08-14) describes one corpus on
// one day and would drift with the data. The property does not.
//
// Why it matters: the КЗП feed lost more than half its reporters in six days
// (210 → 98 between 2026-07-26 and 2026-08-14). An index built on whoever filed
// today measures the sample, not the prices.
describe("matchedCell — the index is invariant to a chain that is not on both days", () => {
  // ⚠️ BILLA is priced far from the others ON PURPOSE. With {10, 11, 12} it sits
  // exactly at the median, so median(10,12) === median(10,11,12) === 11 and
  // dropping it moves nothing — a fixture where the assertions below cannot
  // fail however broken the matching is. The first cut of this block used
  // exactly that, and a mutant leaking every base-day chain passed it.
  const base = day({
    KAUF: { "1": 10, "2": 20 },
    BILLA: { "1": 100, "2": 200 },
    LIDL: { "1": 12, "2": 22 },
  });

  it("a chain missing TODAY is dropped from the BASE vector too", () => {
    // If BILLA's base-day 100 survived while today's three-chain median did
    // not, the ratio would read as a collapse in prices. The value, not the
    // count, is what proves it did not.
    const billaGone = matchedCell(
      day({ KAUF: { "1": 10, "2": 20 }, LIDL: { "1": 12, "2": 22 } }),
      base,
    );
    expect(billaGone.chains).toBe(2);
    // median(10, 12) — BILLA's 100 must not be in here.
    expect(billaGone.base.get(1)).toBe(11);
    expect(billaGone.now.get(1)).toBe(11);
    expect(billaGone.base.get(2)).toBe(21);

    // …and with BILLA present on both days it IS included, so the fixture is
    // demonstrably capable of telling the two apart.
    const withAll = matchedCell(
      day({
        KAUF: { "1": 10, "2": 20 },
        BILLA: { "1": 100, "2": 200 },
        LIDL: { "1": 12, "2": 22 },
      }),
      base,
    );
    expect(withAll.chains).toBe(3);
    expect(withAll.base.get(1)).toBe(12);
    expect(withAll.base.get(1)).not.toBe(billaGone.base.get(1));
  });

  it("a chain missing on the BASE day is excluded from today too", () => {
    // NEWCO appears today only. Including it would let an ARRIVAL move the
    // index exactly as a departure would.
    const withNew = matchedCell(
      day({
        KAUF: { "1": 10, "2": 20 },
        BILLA: { "1": 100, "2": 200 },
        LIDL: { "1": 12, "2": 22 },
        NEWCO: { "1": 1, "2": 1 },
      }),
      base,
    );
    const withoutNew = matchedCell(
      day({
        KAUF: { "1": 10, "2": 20 },
        BILLA: { "1": 100, "2": 200 },
        LIDL: { "1": 12, "2": 22 },
      }),
      base,
    );

    expect(withNew.chains).toBe(withoutNew.chains);
    expect(withNew.now.get(1)).toBeDefined();
    expect(withNew.now.get(1)).toBe(withoutNew.now.get(1));
    expect(withNew.now.get(2)).toBe(withoutNew.now.get(2));
  });

  it("with NO price moving, the matched ratio is exactly 1 whoever leaves", () => {
    // The strongest form: identical prices on both days, chains coming and
    // going. Any deviation from parity is the sample talking.
    //
    // The `toBeDefined` is not padding — without it `undefined === undefined`
    // makes this pass for an implementation that matches NOTHING.
    for (const today of [
      day({ KAUF: { "1": 10 }, BILLA: { "1": 100 }, LIDL: { "1": 12 } }),
      day({ KAUF: { "1": 10 }, LIDL: { "1": 12 } }),
      day({ LIDL: { "1": 12 } }),
      day({ KAUF: { "1": 10 }, LIDL: { "1": 12 }, NEWCO: { "1": 99 } }),
    ]) {
      const m = matchedCell(today, base);
      expect(m.now.get(1)).toBeDefined();
      expect(m.chains).toBeGreaterThan(0);
      expect(m.now.get(1)).toBe(m.base.get(1));
    }
  });
});
