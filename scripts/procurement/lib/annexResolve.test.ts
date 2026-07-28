// Unit tests for the annex→contract resolution guards.
//
// This is the shared identity join that BOTH the current-value fold and the
// procurement_annexes loader rely on — a wrong match flips a contract's value
// or files an annex against the wrong company. The three guards (supplier
// membership, ±12% continuity anchor, 15× ratio cap) are the whole safety
// margin, so each gets a test. No DB, no cache: the AnnexIndex is hand-built.

import { describe, expect, it } from "vitest";
import {
  resolveAnnexKey,
  lookup,
  CONTINUITY_TOL,
  MAX_MULTIPLE,
  type AnnexIndex,
  type AnnexAcc,
} from "./annexResolve";
import type { Contract } from "../types";

const acc = (over: Partial<AnnexAcc> = {}): AnnexAcc => ({
  curEurFull: 150,
  curSupplierCount: 1,
  curSuppliers: ["222"],
  curPub: "2024-06-01",
  lastEurFull: 100, // ≈ signing 100 → continuity passes
  lastSupplierCount: 1,
  lastPub: "2024-01-01",
  ...over,
});

const index = (over: Partial<AnnexIndex> = {}): AnnexIndex => ({
  byContractNo: new Map(),
  byUnpSupplier: new Map(),
  ...over,
});

const contract = (over: Partial<Contract> = {}): Contract =>
  ({
    unp: "00123-2024-0001",
    contractorEik: "222",
    awarderEik: "111",
    contractId: "42",
    ...over,
  }) as Contract;

describe("resolveAnnexKey — K2 (УНП+supplier) preferred", () => {
  it("matches on the УНП+supplier key and returns the per-supplier value", () => {
    const idx = index({
      byUnpSupplier: new Map([["00123-2024-0001|222", acc()]]),
    });
    const r = resolveAnnexKey(idx, contract(), 100);
    expect(r).toMatchObject({ via: "unp", value: 150 });
  });

  it("falls back to K1 (buyer+contractNo) when no УНП key matches", () => {
    const idx = index({ byContractNo: new Map([["111|42", acc()]]) });
    const r = resolveAnnexKey(idx, contract({ unp: undefined }), 100);
    expect(r).toMatchObject({ via: "contract_no", value: 150 });
  });

  it("prefers K2 over K1 when both exist", () => {
    const idx = index({
      byUnpSupplier: new Map([
        ["00123-2024-0001|222", acc({ curEurFull: 150 })],
      ]),
      byContractNo: new Map([["111|42", acc({ curEurFull: 999 })]]),
    });
    expect(resolveAnnexKey(idx, contract(), 100)?.value).toBe(150);
  });
});

describe("guard 1 — supplier membership", () => {
  it("rejects a match when our contractor is not on the annex's supplier list", () => {
    const idx = index({
      byUnpSupplier: new Map([
        ["00123-2024-0001|222", acc({ curSuppliers: ["999"] })],
      ]),
    });
    expect(resolveAnnexKey(idx, contract(), 100)).toBeUndefined();
  });

  it("allows a match when the annex published NO supplier list", () => {
    const idx = index({
      byUnpSupplier: new Map([
        ["00123-2024-0001|222", acc({ curSuppliers: [] })],
      ]),
    });
    expect(resolveAnnexKey(idx, contract(), 100)?.value).toBe(150);
  });
});

describe("guard 2 — ±12% continuity anchor", () => {
  it("rejects when the pre-annex value is beyond ±12% of signing", () => {
    // anchor 100, signing 200 → |100-200|/200 = 0.5 > 0.12 → reject
    const idx = index({
      byUnpSupplier: new Map([["00123-2024-0001|222", acc()]]),
    });
    expect(resolveAnnexKey(idx, contract(), 200)).toBeUndefined();
  });

  it("accepts just inside the tolerance", () => {
    const signed = 100 / (1 + CONTINUITY_TOL) + 0.01; // anchor 100 within +12%
    const idx = index({
      byUnpSupplier: new Map([["00123-2024-0001|222", acc()]]),
    });
    expect(resolveAnnexKey(idx, contract(), signed)?.value).toBe(150);
  });
});

describe("guard 3 — ratio cap", () => {
  it("rejects a current value beyond MAX_MULTIPLE× signing (collided key)", () => {
    const idx = index({
      byUnpSupplier: new Map([
        // anchor stays ≈ signing so guard 2 passes; current is 20× → guard 3 rejects
        ["00123-2024-0001|222", acc({ curEurFull: 100 * (MAX_MULTIPLE + 5) })],
      ]),
    });
    expect(resolveAnnexKey(idx, contract(), 100)).toBeUndefined();
  });
});

describe("consortium — per-supplier split", () => {
  it("divides the full value by the supplier count", () => {
    const idx = index({
      byUnpSupplier: new Map([
        [
          "00123-2024-0001|222",
          acc({
            curEurFull: 300,
            curSupplierCount: 2,
            curSuppliers: ["222", "333"],
            lastEurFull: 200,
            lastSupplierCount: 2,
          }),
        ],
      ]),
    });
    // signing (per-supplier) 100 ≈ anchor 200/2=100; current 300/2 = 150
    expect(resolveAnnexKey(idx, contract(), 100)?.value).toBe(150);
  });
});

describe("lookup is the value-only wrapper of resolveAnnexKey", () => {
  it("agrees with resolveAnnexKey().value on a match and a miss", () => {
    const idx = index({
      byUnpSupplier: new Map([["00123-2024-0001|222", acc()]]),
    });
    const c = contract();
    expect(lookup(idx, c, 100)).toBe(resolveAnnexKey(idx, c, 100)?.value);
    // a miss: both undefined
    expect(lookup(index(), c, 100)).toBeUndefined();
    expect(resolveAnnexKey(index(), c, 100)).toBeUndefined();
  });

  it("returns undefined for a non-positive signing value", () => {
    const idx = index({
      byUnpSupplier: new Map([["00123-2024-0001|222", acc()]]),
    });
    expect(lookup(idx, contract(), 0)).toBeUndefined();
  });
});
