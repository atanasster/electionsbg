// Unit tests for the two pieces that make the price index robust to a КЗП
// reporter set that changes size, plus the wiring that publishes the second:
//   * `matchedCell`        — chain-matching (T0.1)
//   * `trailingChainMedian`/`COVERAGE_FLOOR` + the emitted `coverage` block
//                          — completeness (T0.5)
//
// This is the whole of the fix for the defect measured on 2026-08-09 (the КЗП
// feed went 203 → 98 chains in six days and the national index moved 4.19
// points in a day with no price changing), and nothing else in the repo can
// catch a regression in it. `prices_payload_parity.data.test.ts` is
// structurally incapable of it: as its own header says, it builds BOTH sides
// through the same `buildPriceIndex()`, so an inverted `matchedCell` passes it
// on both sides identically.

import { describe, it, expect } from "vitest";
import {
  matchedCell,
  trailingChainMedian,
  COVERAGE_FLOOR,
  COVERAGE_WINDOW_DAYS,
} from "./build_index";
import { SANITY_DROP } from "./load_day";
import { buildPriceIndex } from "./build_index";
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

describe("trailingChainMedian / COVERAGE_FLOOR", () => {
  const flat = (n: number, len: number) => new Array(len).fill(n);

  it("excludes the day itself — a day cannot be its own reference", () => {
    // The window must be NON-FLAT for this to discriminate: a median over six
    // flat values shrugs off one outlier, so [200×5, 10] passes whether or not
    // the day itself is included. Here the self value moves it.
    const days = [100, 150, 200, 1];
    expect(trailingChainMedian(days, 3)).toBe(150); // self-inclusive → 125
  });

  it("returns null until there is enough history to judge against", () => {
    const days = flat(200, 10);
    expect(trailingChainMedian(days, 0)).toBeNull();
    expect(trailingChainMedian(days, 2)).toBeNull();
    expect(trailingChainMedian(days, 3)).toBe(200);
  });

  it("looks back at exactly COVERAGE_WINDOW_DAYS, not 13 or 15", () => {
    // A half-and-half window, so one element either way flips the answer:
    // 17 days at 500 then 7 at 100. A 14-entry window holds 7 of each and
    // medians at 300; 13 entries drops a 500 and collapses to 100; 15 adds one
    // and gives 500. The earlier [500×20, 100×14] fixture passed for ANY
    // window from 13 to 28.
    const days = [...flat(500, 17), ...flat(100, 7)];
    expect(trailingChainMedian(days, 24)).toBe(300);
  });

  it("catches the monotone slide the per-day floor lets through", () => {
    // The real 2026-08 sequence. Each step is under the ingest's own 20%
    // per-day floor after the first, yet the run compounds to -52%.
    const real = [
      206, 204, 203, 205, 207, 208, 209, 203, 140, 132, 115, 107, 101, 98,
    ];
    const flagged: number[] = [];
    for (let i = 0; i < real.length; i++) {
      const med = trailingChainMedian(real, i);
      if (med != null && real[i] < med * COVERAGE_FLOOR) flagged.push(real[i]);
    }
    // Every day of the collapse is flagged, not just the first step.
    expect(flagged).toEqual([140, 132, 115, 107, 101, 98]);

    // The control: the per-day comparison — the shape scripts/prices/load_day.ts
    // uses, with its SANITY_DROP imported rather than restated, so the two
    // cannot drift — clears all but one of them. That is precisely how the
    // slide shipped.
    const perDayFloor = 1 - SANITY_DROP;
    const perDay = real.filter(
      (n, i) => i > 0 && n < real[i - 1] * perDayFloor,
    );
    expect(perDay).toEqual([140]);
  });

  it("cannot call the opening days incomplete — there is nothing to judge them against", () => {
    // trailingChainMedian returns null before 3 readings, and the caller treats
    // null as complete. The alternative marks the corpus's first days unusable.
    const days = [10, 500, 500, 500];
    expect(trailingChainMedian(days, 0)).toBeNull();
    expect(trailingChainMedian(days, 1)).toBeNull();
    expect(trailingChainMedian(days, 2)).toBeNull();
    // …and once there IS history, a thin day is caught immediately.
    const med = trailingChainMedian([500, 500, 500, 10], 3);
    expect(med).toBe(500);
    expect(10 < med! * COVERAGE_FLOOR).toBe(true);
  });

  it("window and floor are the values the payload's note claims", () => {
    // Both are exported and read by consumers + the note text; a silent change
    // to either changes what `chainsComplete` means.
    expect(COVERAGE_WINDOW_DAYS).toBe(14);
    expect(COVERAGE_FLOOR).toBe(0.8);
  });

  it("ignores zero-count days rather than treating them as a low reading", () => {
    // The zeros must OUTNUMBER the readings, or the median absorbs them and
    // the test passes with no filter at all.
    const days = [200, 200, 200, 0, 0, 0, 0, 200];
    expect(trailingChainMedian(days, 7)).toBe(200); // unfiltered → 0
  });
});

// ── the wiring, not just the helpers ────────────────────────────────────────
// The pure functions above can be perfect while the `coverage` block still
// reports the wrong day, reads the wrong counter, or loses `lastCompleteDate`.
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

const coverageOf = (chainsPerDay: number[]) => {
  const grids = chainsPerDay.map((c, i) =>
    gridDay(`2026-01-${String(i + 1).padStart(2, "0")}`, c),
  );
  let coverage: Record<string, unknown> | undefined;
  buildPriceIndex({
    grids,
    emit: (kind, _key, obj) => {
      if (kind === "index")
        coverage = (obj as { coverage: Record<string, unknown> }).coverage;
    },
  });
  return coverage!;
};

describe("the emitted coverage block", () => {
  it("marks a collapsed latest day incomplete and names the last good one", () => {
    // Nine normal days then a halving — the 2026-08 shape in miniature.
    const c = coverageOf([200, 200, 200, 200, 200, 200, 200, 200, 200, 98]);
    expect(c.chains).toBe(98);
    expect(c.chainsTrailingMedian).toBe(200);
    expect(c.chainsComplete).toBe(false);
    // The last day clearing the floor — NOT the latest day.
    expect(c.lastCompleteDate).toBe("2026-01-09");
  });

  it("marks a healthy latest day complete, with lastCompleteDate on it", () => {
    const c = coverageOf([200, 200, 200, 200, 205]);
    expect(c.chainsComplete).toBe(true);
    expect(c.lastCompleteDate).toBe("2026-01-05");
  });

  it("does not call the opening days incomplete for lack of history", () => {
    // Day 0 is thin, but nothing precedes it to judge it against.
    const c = coverageOf([10, 500, 500]);
    expect(c.chainsComplete).toBe(true);
    expect(c.lastCompleteDate).toBe("2026-01-03");
  });

  it("reports the reporter count, not the settlement or row count", () => {
    // A mutant reading stats.rows or stats.settlements would see 1 here.
    const c = coverageOf([200, 200, 200, 160]);
    expect(c.chainsTrailingMedian).toBe(200);
    expect(c.chainsComplete).toBe(true); // 160 = exactly 0.8 × 200
    expect(coverageOf([200, 200, 200, 159]).chainsComplete).toBe(false);
  });
});
