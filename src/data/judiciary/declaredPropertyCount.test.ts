// The rule deciding which property count a reader sees, tested directly.
//
// It has its own file because the component tests cannot pin it: measured by injecting the
// reverted `parsed ?? heuristic` implementation, only ONE of the four count assertions in
// PersonMagistrateHoldingsTile.test.tsx fails. The rest pass under the fallback this rule
// exists to forbid — they exercise the rendering, not the choice.
//
// ⚠️ What must never regress: the original heuristic is NOT a fallback. It fabricates
// property against magistrates who declared none (adjudicated against the source PDFs — Димо
// Николов Николов scored 6 on a filing carrying „Нямам нищо за деклариране" five times and
// not one property noun over 11 pages) and misses it wholesale where it exists (Иво Веселинов
// Радев scored 0 on a filing declaring 20). So an unknown count publishes nothing.

import { describe, it, expect } from "vitest";
import { declaredPropertyCount } from "./useMagistrateHoldings";

const f = (realEstateCount: number, realEstateCountParsed?: number | null) => ({
  realEstateCount,
  ...(realEstateCountParsed === undefined ? {} : { realEstateCountParsed }),
});

describe("declaredPropertyCount", () => {
  it("returns the structured reader's answer when there is one", () => {
    expect(declaredPropertyCount(f(1, 3))).toBe(3);
  });

  it("returns null — NEVER the heuristic — when the reader has no answer", () => {
    // The whole point. A `?? heuristic` implementation returns 6 here and publishes a
    // fabricated property count beside a named judge.
    expect(declaredPropertyCount(f(6, null))).toBeNull();
    expect(declaredPropertyCount(f(6))).toBeNull();
  });

  it("treats 0 as an answer, not as an absence", () => {
    // „This filing lists no property" is something the reader established. It must not fall
    // through to the heuristic — the `||` mistake, distinct from the `??` one above.
    expect(declaredPropertyCount(f(2, 0))).toBe(0);
  });

  it("returns null for a magistrate with no financials at all", () => {
    expect(declaredPropertyCount(null)).toBeNull();
  });

  it("never returns the heuristic value for ANY combination", () => {
    // A sweep rather than three cases: whatever the heuristic says, the result is either the
    // parsed value or null. Catches an implementation that special-cases its way back.
    for (const heur of [0, 1, 6, 20]) {
      for (const parsed of [undefined, null, 0, 1, 20]) {
        const got = declaredPropertyCount(f(heur, parsed));
        expect(got).toBe(parsed === undefined ? null : parsed);
      }
    }
  });
});
