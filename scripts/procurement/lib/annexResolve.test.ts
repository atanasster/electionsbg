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
  indexAnnexRows,
  CONTINUITY_TOL,
  MAX_MULTIPLE,
  type AnnexIndex,
  type AnnexAcc,
} from "./annexResolve";
import type { EopAnnexRecord } from "../ingest_anexi";
import type { Contract } from "../types";

const acc = (over: Partial<AnnexAcc> = {}): AnnexAcc => ({
  curEurFull: 150,
  curSupplierCount: 1,
  curSuppliers: ["222"],
  curPub: "2024-06-01",
  lastEurFull: 100, // ≈ signing 100 → continuity passes
  lastSupplierCount: 1,
  lastPub: "2024-01-01",
  contractNos: new Set(["42"]),
  unps: new Set(["00123-2024-0001"]),
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

describe("guard 4 — ambiguity refusal (multi-contract key collision)", () => {
  // The Дансон трейдинг shape (УНП 00536-2023-0049): one supplier, TWO contracts
  // under one procedure. The merged K2 accumulator anchors on contract A's
  // earliest annex (352,343.97 ≈ A's signing → continuity passes perfectly) but
  // serves contract B's latest value (158,991.32) — so the guardrails cannot
  // catch it and only the ambiguity refusal can.
  it("refuses a K2 key spanning two contract numbers and resolves via K1", () => {
    const idx = index({
      byUnpSupplier: new Map([
        [
          "00123-2024-0001|222",
          acc({
            // merged: anchor from contract 42, current from contract 43
            curEurFull: 45, // contract 43's value — WRONG for contract 42
            lastEurFull: 100, // contract 42's signing — continuity passes
            contractNos: new Set(["42", "43"]),
          }),
        ],
      ]),
      byContractNo: new Map([
        ["111|42", acc({ curEurFull: 150, contractNos: new Set(["42"]) })],
      ]),
    });
    const r = resolveAnnexKey(idx, contract(), 100);
    expect(r).toMatchObject({ via: "contract_no", value: 150 });
  });

  it("returns undefined when K2 is ambiguous and no K1 key exists", () => {
    const idx = index({
      byUnpSupplier: new Map([
        ["00123-2024-0001|222", acc({ contractNos: new Set(["42", "43"]) })],
      ]),
    });
    expect(
      resolveAnnexKey(idx, contract({ contractId: "" }), 100),
    ).toBeUndefined();
  });

  it("refuses a K1 key spanning two УНП (buyer reused a contract number)", () => {
    const idx = index({
      byContractNo: new Map([
        [
          "111|42",
          acc({ unps: new Set(["00123-2024-0001", "00123-2025-0007"]) }),
        ],
      ]),
    });
    expect(
      resolveAnnexKey(idx, contract({ unp: undefined }), 100),
    ).toBeUndefined();
  });

  it("still resolves a K2 key whose annexes published no contract number", () => {
    // Unpublished identity is not evidence of a second contract.
    const idx = index({
      byUnpSupplier: new Map([
        ["00123-2024-0001|222", acc({ contractNos: new Set() })],
      ]),
    });
    expect(resolveAnnexKey(idx, contract(), 100)?.value).toBe(150);
  });

  it("still resolves a K1 key whose annexes published no proper УНП", () => {
    // The mirrored empty-set case on the hand-written twin branch — this is
    // the case that distinguishes `<= 1` from `=== 1`.
    const idx = index({
      byContractNo: new Map([["111|42", acc({ unps: new Set() })]]),
    });
    expect(
      resolveAnnexKey(idx, contract({ unp: undefined }), 100),
    ).toMatchObject({ via: "contract_no", value: 150 });
  });

  it("characterization: a SINGLE mismatched contract number does NOT refuse K2", () => {
    // Deliberate (see the DELIBERATELY NOT REFUSED block on resolveAnnexKey):
    // contractId and the annex feed's contractNumber routinely name the same
    // contract in different identifier spaces, so a mismatch is not evidence of
    // a sibling contract — refusing it measured as 968 lost matches / €46.8M of
    // tracked value change on the 2026-08-04 corpus. The residual sibling
    // exposure is accepted and left to guards 1–3.
    const idx = index({
      byUnpSupplier: new Map([
        ["00123-2024-0001|222", acc({ contractNos: new Set(["999"]) })],
      ]),
    });
    expect(
      resolveAnnexKey(idx, contract({ contractId: "42" }), 100)?.value,
    ).toBe(150);
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

  it("uses the anchor's divisor even when the published list GREW", () => {
    // Real shape (ЕСО Инженеринг, contract 31836): earliest annex listed 1
    // supplier (anchor = signing = the full value), latest listed 2. Dividing
    // the current value by the latest list's length halved a €195k contract to
    // €97.6k; the anchor-validated divisor (1) keeps the full value.
    //
    // The same input also characterizes a DELIBERATE acceptance: a supplier
    // genuinely ADDED between annexes is indistinguishable from publication
    // noise (the anchor predates the addition, so guard 2 cannot see it), and
    // the row keeps the full current value. That is the right corpus total
    // whenever the added supplier has no contract row of its own — the usual
    // annex-substitution shape; the per-company overstatement is accepted (see
    // the divisor comment on perSupplier).
    const idx = index({
      byUnpSupplier: new Map([
        [
          "00123-2024-0001|222",
          acc({
            lastEurFull: 100,
            lastSupplierCount: 1,
            curEurFull: 150,
            curSupplierCount: 2,
            curSuppliers: ["222", "333"],
          }),
        ],
      ]),
    });
    expect(resolveAnnexKey(idx, contract(), 100)?.value).toBe(150);
  });

  it("uses the anchor's divisor even when the published list SHRANK", () => {
    // The mirror shape inflates: anchor full/8 ≈ signing (a split row), but a
    // latest annex listing 1 supplier would credit the row the FULL current
    // value — an ~8× inflation inside the ratio cap. Same divisor: cur/8.
    const idx = index({
      byUnpSupplier: new Map([
        [
          "00123-2024-0001|222",
          acc({
            lastEurFull: 800,
            lastSupplierCount: 8,
            curEurFull: 960,
            curSupplierCount: 1,
            curSuppliers: ["222"],
          }),
        ],
      ]),
    });
    expect(resolveAnnexKey(idx, contract(), 100)?.value).toBe(120);
  });
});

describe("indexAnnexRows — raw records to accumulator, end to end", () => {
  // The real УНП 00536-2023-0049 shape, minimally: one supplier holds two
  // contracts under one procedure, each with its own zero-diff annex. Before
  // the ambiguity refusal, contract 246043 folded to 158,991.32 (contract
  // 143346's value) — a fabricated −€193,352.65.
  const rec = (over: Partial<EopAnnexRecord> = {}): EopAnnexRecord => ({
    uniqueProcurementNumber: "00536-2023-0049",
    buyerRegistryNumber: "123535874",
    supplierRegisterNumber: "206534575",
    contractCurrency: "EUR",
    ...over,
  });
  const rows: EopAnnexRecord[] = [
    rec({
      contractNumber: "246043",
      publicationDate: "2026-04-27T05:17:58",
      lastContractValue: "352343,97",
      currentContractValue: "352343,97",
    }),
    rec({
      contractNumber: "143346",
      publicationDate: "2026-05-15T05:03:44",
      lastContractValue: "158991,32",
      currentContractValue: "158991,32",
    }),
  ];

  it("collects the distinct contract numbers and УНП into the accumulators", () => {
    const idx = index();
    expect(indexAnnexRows(idx, rows)).toBe(2);
    const k2 = idx.byUnpSupplier.get("00536-2023-0049|206534575");
    expect(k2?.contractNos).toEqual(new Set(["246043", "143346"]));
    const k1 = idx.byContractNo.get("123535874|246043");
    expect(k1?.unps).toEqual(new Set(["00536-2023-0049"]));
  });

  it("resolves each contract to ITS OWN annex value via K1", () => {
    const idx = index();
    indexAnnexRows(idx, rows);
    const c = (id: string): Contract =>
      contract({
        unp: "00536-2023-0049",
        contractorEik: "206534575",
        awarderEik: "123535874",
        contractId: id,
      });
    // Both K2 lookups are refused (two contract numbers under the key); K1
    // then answers per contract. Neither annex moved its value, so the fold
    // sees cur == signing — the resolved value must be the contract's own.
    expect(resolveAnnexKey(idx, c("246043"), 352343.97)).toMatchObject({
      via: "contract_no",
      value: 352343.97,
    });
    expect(resolveAnnexKey(idx, c("143346"), 158991.32)).toMatchObject({
      via: "contract_no",
      value: 158991.32,
    });
    // The pre-fix failure: contract 246043 must NOT resolve to 143346's value.
    expect(resolveAnnexKey(idx, c("246043"), 352343.97)?.value).not.toBe(
      158991.32,
    );
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
