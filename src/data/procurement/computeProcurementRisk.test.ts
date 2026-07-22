import { describe, it, expect } from "vitest";
import {
  mergeContractRisk,
  emptyContractRiskFlags,
  type ContractRiskResult,
  type ContractRiskFlags,
  type RiskComponent,
} from "./computeProcurementRisk";
import type { DebarredEntry } from "@/data/dataTypes";

const emptyFlags = emptyContractRiskFlags;

// Build a minimal result from a partial flags patch + a list of fired component keys.
const mk = (
  patch: Partial<ContractRiskFlags>,
  fired: RiskComponent["key"][] = [],
  available: RiskComponent["key"][] = fired,
): ContractRiskResult => {
  const keys = new Set([...fired, ...available]);
  const components = [...keys].map((key) => ({
    key,
    available: available.includes(key),
    fired: fired.includes(key),
  }));
  const availableCount = components.filter((c) => c.available).length;
  const firedCount = components.filter((c) => c.fired).length;
  return {
    flags: { ...emptyFlags(), ...patch },
    score: firedCount * 10,
    cri: availableCount ? Math.round((100 * firedCount) / availableCount) : 0,
    components,
    firedCount,
    availableCount,
    hasFlag: firedCount > 0,
  };
};

describe("mergeContractRisk — per-contractor union (§4.2.5b)", () => {
  it("unions fired flags across the contractor's contracts", () => {
    const a = mk({ weakCompetition: true }, ["weakCompetition"]);
    const b = mk({ directAward: true }, ["directAward"]);
    const m = mergeContractRisk([a, b]);
    expect(m.flags.weakCompetition).toBe(true);
    expect(m.flags.directAward).toBe(true);
    expect(m.firedCount).toBe(2);
    expect(m.hasFlag).toBe(true);
  });

  it("carries an object flag's detail from the first contract that set it", () => {
    const debarred = {
      name: "ACME",
      debarredUntil: "2027-01-01",
    } as unknown as DebarredEntry;
    const a = mk({}, []);
    const b = mk({ debarred }, ["debarred"]);
    const m = mergeContractRisk([a, b]);
    expect(m.flags.debarred).toBe(debarred);
  });

  it("keeps the LOWEST bidCount (most concerning) across contracts", () => {
    const a = mk({ bidCount: 5, weakCompetition: false });
    const b = mk({ bidCount: 1, weakCompetition: true }, ["weakCompetition"]);
    const m = mergeContractRisk([a, b]);
    expect(m.flags.bidCount).toBe(1);
  });

  it("keeps the MOST CONCERNING magnitude — largest annex growth, youngest firm", () => {
    const a = mk({ annexGrowth: true, annexGrowthPct: 0.5 }, ["annexGrowth"]);
    const b = mk(
      {
        annexGrowth: true,
        annexGrowthPct: 0.9,
        newFirmWinner: true,
        newFirmMonths: 8,
      },
      ["annexGrowth", "newFirmWinner"],
    );
    const c = mk({ newFirmWinner: true, newFirmMonths: 3 }, ["newFirmWinner"]);
    const m = mergeContractRisk([a, b, c]);
    expect(m.flags.annexGrowthPct).toBe(0.9); // max, not first
    expect(m.flags.newFirmMonths).toBe(3); // min (youngest), not first
  });

  it("recomputes score from the union so it agrees with firedCount (not max input)", () => {
    // Each input fires ONE flag (score 40/20 individually); the union fires both,
    // so the merged score is the SUM (60), higher than any single input's max.
    const a = mk({ weakCompetition: true }, ["weakCompetition"]); // 40
    const b = mk({ directAward: true }, ["directAward"]); // 20
    const m = mergeContractRisk([a, b]);
    expect(m.firedCount).toBe(2);
    expect(m.score).toBe(60);
    expect(m.score).toBeGreaterThan(Math.max(a.score, b.score));
  });

  it("a clean contractor stays flagless (hasFlag=false)", () => {
    const m = mergeContractRisk([mk({}), mk({})]);
    expect(m.hasFlag).toBe(false);
    expect(m.firedCount).toBe(0);
  });

  it("unions component availability + recomputes cri", () => {
    // one contract had weakCompetition available+fired, the other had it
    // available-not-fired → union is available+fired; cri counts it once.
    const a = mk(
      { weakCompetition: true },
      ["weakCompetition"],
      ["weakCompetition", "directAward"],
    );
    const b = mk({}, [], ["weakCompetition"]);
    const m = mergeContractRisk([a, b]);
    const wc = m.components.find((c) => c.key === "weakCompetition")!;
    expect(wc.available).toBe(true);
    expect(wc.fired).toBe(true);
    expect(m.availableCount).toBe(2); // weakCompetition + directAward
    expect(m.firedCount).toBe(1);
    expect(m.cri).toBe(50);
  });

  it("handles an empty input without throwing", () => {
    const m = mergeContractRisk([]);
    expect(m.hasFlag).toBe(false);
    expect(m.cri).toBe(0);
    expect(m.components).toEqual([]);
  });
});
