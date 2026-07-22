// The foreign-funded-NGO disclosure is a NEUTRAL flag: it must surface on
// `flags.ngoForeignFunded` when the contractor is in the index, but it must
// NOT touch the corruption-risk score — no change to `cri`, `firedCount`, or
// `availableCount` (foreign funding is lawful disclosure, never a red flag).
import { describe, it, expect } from "vitest";
import type { ProcurementContract } from "@/data/dataTypes";
import {
  computeProcurementRisk,
  type NgoForeignFundedEntry,
  type RiskScoreArgs,
} from "./computeProcurementRisk";

// Minimal contract — the scorer only reads a handful of fields; cast the rest.
const contract = {
  contractorEik: "175935973",
  contractorName: "ЗАЕДНО В ЧАС",
  awarderEik: "000695251",
  amountEur: 62500,
  signingAmountEur: 62500,
  cpv: "80000000",
  numberOfTenderers: 3,
  procurementMethod: "open",
  date: "2020-07-10",
  tag: "contract",
} as unknown as ProcurementContract;

// Baseline args with none of the optional indexes → no flag can fire.
const baseArgs: RiskScoreArgs = {
  debarredByName: new Map(),
  concentrationByPair: new Map(),
  mpConnectedEiks: new Map(),
  normalizeName: (s) => s,
};

const entry: NgoForeignFundedEntry = {
  kind: "direct",
  ngoName: "ЗАЕДНО В ЧАС",
  ngoEik: "175935973",
  funder: "America for Bulgaria Foundation",
  eur: 19550980,
  person: null,
};

describe("computeProcurementRisk — foreign-funded-NGO neutral disclosure", () => {
  it("is null when the contractor is not in the index", () => {
    const r = computeProcurementRisk(contract, baseArgs);
    expect(r.flags.ngoForeignFunded).toBeNull();
  });

  it("surfaces the entry when the contractor IS in the index", () => {
    const r = computeProcurementRisk(contract, {
      ...baseArgs,
      ngoForeignFundedByEik: new Map([[contract.contractorEik, entry]]),
    });
    expect(r.flags.ngoForeignFunded).toEqual(entry);
  });

  it("does NOT change the CRI / fired / available counts (neutral)", () => {
    const without = computeProcurementRisk(contract, baseArgs);
    const withFlag = computeProcurementRisk(contract, {
      ...baseArgs,
      ngoForeignFundedByEik: new Map([[contract.contractorEik, entry]]),
    });
    expect(withFlag.cri).toBe(without.cri);
    expect(withFlag.firedCount).toBe(without.firedCount);
    expect(withFlag.availableCount).toBe(without.availableCount);
    expect(withFlag.score).toBe(without.score);
    // And it is not present as a scored component in the ledger.
    expect(withFlag.components.some((c) => c.key === ("ngoForeignFunded" as never))).toBe(false);
  });
});
