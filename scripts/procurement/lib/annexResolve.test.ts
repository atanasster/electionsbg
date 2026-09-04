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
  consortiumGroupKey,
  membersByConsortiumGroup,
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

describe("contract basis — the divisor the caller declares", () => {
  // The real 087 shape, minimally. УНП 01981-2020-0035, contract № 23-00-96, three
  // members: the annex publishes the FULL pre-value (€362,222.52) and the full
  // current value. On the SHARDS each of the three rows carries value/3; in
  // Postgres `rebuild_consortium()` has moved the whole value onto one row and
  // zeroed the other two. Same annex, same resolver, two correct answers.
  const threeMembers = () =>
    index({
      byUnpSupplier: new Map([
        [
          "00123-2024-0001|222",
          acc({
            curEurFull: 300,
            curSupplierCount: 3,
            curSuppliers: ["222", "333", "444"],
            lastEurFull: 300,
            lastSupplierCount: 3,
          }),
        ],
      ]),
    });

  it('defaults to "split" — an omitted basis is the shard convention', () => {
    // Both calls must agree, and the value must be the SPLIT one. A default of
    // "full" here would rewrite every consortium contract's amountEur by its
    // member count, on the path that flips the whole corpus.
    const implicit = resolveAnnexKey(threeMembers(), contract(), 100);
    const explicit = resolveAnnexKey(threeMembers(), contract(), 100, {
      basis: "split",
    });
    expect(implicit?.value).toBe(100); // 300 / 3
    expect(explicit).toEqual(implicit);
  });

  it('"full" divides by 1, so the SAME fixture resolves to a different value', () => {
    // Asserting only this would be satisfied by a resolver that moved both paths;
    // it is the pair with the default test above that pins the change.
    expect(
      resolveAnnexKey(threeMembers(), contract(), 300, { basis: "full" })
        ?.value,
    ).toBe(300);
  });

  it("refuses the un-split row under the shard basis — the defect, pinned", () => {
    // The post-087 row carries the full 300 as its signing value. Under "split"
    // the anchor is 300/3 = 100, i.e. −66.7% against signing, so guard 2 refuses
    // and the contract's annexes are silently lost. The gap IS the member count.
    expect(resolveAnnexKey(threeMembers(), contract(), 300)).toBeUndefined();
    expect(
      resolveAnnexKey(threeMembers(), contract(), 300, { basis: "full" }),
    ).toMatchObject({ via: "unp", value: 300 });
  });

  it("leaves a single-supplier contract identical under both bases", () => {
    // Why the basis cannot be auto-detected: the rows where the two conventions
    // agree are the overwhelming majority, so any heuristic would look correct
    // everywhere except on the rows it decides.
    const idx = index({
      byUnpSupplier: new Map([["00123-2024-0001|222", acc()]]),
    });
    expect(resolveAnnexKey(idx, contract(), 100, { basis: "split" })).toEqual(
      resolveAnnexKey(idx, contract(), 100, { basis: "full" }),
    );
  });

  it("refuses a STILL-SPLIT row under the full basis — the framework case", () => {
    // The fourth cell of the matrix, and the one that regresses live rows. 087
    // step (2) leaves `joint_kind = 'framework'` on the equal split by design
    // (independent parallel winners, not one joint award), and so does any
    // multi-supplier award its HAVING did not group — so a Postgres framework row
    // carries value/N while the annex publishes the full value. Under "full" the
    // anchor is N× signing and guard 2 must refuse; under "split" it resolves.
    // Measured 2026-09-04: claiming "full" for every Postgres row would have
    // dropped 83 currently-linked annex rows (9 framework, 74 ungrouped).
    expect(
      resolveAnnexKey(threeMembers(), contract(), 100, { basis: "full" }),
    ).toBeUndefined();
    expect(resolveAnnexKey(threeMembers(), contract(), 100)?.value).toBe(100);
  });

  it("lookup forwards the basis rather than hard-coding the default", () => {
    expect(lookup(threeMembers(), contract(), 300, { basis: "full" })).toBe(
      300,
    );
    expect(lookup(threeMembers(), contract(), 300)).toBeUndefined();
  });
});

describe("synthetic carrier — K2 through the member set", () => {
  // 087 mints an `obed-<md5>` id from the sorted member set for an unnamed consortium: 2,686 of
  // 4,040 carriers. `canonicalEik` returns "" for it, so the own-key probe is `"<unp>|"` (never
  // present) AND guard 1 is skipped — the arm runs with its supplier check disabled. The member
  // set restores both.
  const carrier = (over: Partial<Contract> = {}): Contract =>
    contract({ contractorEik: "obed-1a2b3c4d5e6f", ...over });

  const withMembers = (accs: Record<string, AnnexAcc>): AnnexIndex =>
    index({
      byUnpSupplier: new Map(
        Object.entries(accs).map(([eik, a]) => [`00123-2024-0001|${eik}`, a]),
      ),
    });

  it("resolves through the members when the carrier's own key cannot exist", () => {
    const idx = withMembers({ "222": acc(), "333": acc() });
    expect(
      resolveAnnexKey(idx, carrier(), 100, {
        basis: "full",
        members: ["222", "333"],
      }),
    ).toMatchObject({ via: "unp", value: 150 });
  });

  it("returns undefined without the member set — nothing else can reach it", () => {
    // The pre-Tier-2 behaviour, pinned: the K1 arm is the only thing left, and here there is
    // no byContractNo entry. This is what made 2,687 obed- carriers carry 2 annex links.
    const idx = withMembers({ "222": acc(), "333": acc() });
    expect(
      resolveAnnexKey(idx, carrier(), 100, { basis: "full" }),
    ).toBeUndefined();
  });

  it("REFUSES when the members disagree on the contract number", () => {
    // A member holding a SECOND contract under this procedure. Voting (taking the first hit)
    // would file that other contract's annexes against this consortium — the single-key
    // ambiguity collision with N times the surface.
    const idx = withMembers({
      "222": acc({ contractNos: new Set(["42"]) }),
      "333": acc({ contractNos: new Set(["99"]) }),
    });
    expect(
      resolveAnnexKey(idx, carrier(), 100, {
        basis: "full",
        members: ["222", "333"],
      }),
    ).toBeUndefined();
  });

  it("REFUSES when the members disagree on the annex's values", () => {
    // One annex record is indexed under every supplier it lists, so a genuine joint
    // modification gives every member an identical accumulator. A different one means the
    // member is carrying something else.
    const idx = withMembers({
      "222": acc(),
      "333": acc({ curEurFull: 900, lastEurFull: 100 }),
    });
    expect(
      resolveAnnexKey(idx, carrier(), 100, {
        basis: "full",
        members: ["222", "333"],
      }),
    ).toBeUndefined();
  });

  it("evaluates guard 1 against the MEMBER, not the carrier", () => {
    // The carrier's EIK folds to "", which makes `me &&` skip the check entirely. With the
    // members supplied, a set none of whom is on the latest annex must still be refused.
    const absent = acc({ curSuppliers: ["999"] });
    expect(
      resolveAnnexKey(
        withMembers({ "222": absent, "333": absent }),
        carrier(),
        100,
        {
          basis: "full",
          members: ["222", "333"],
        },
      ),
    ).toBeUndefined();
    // …and a member that IS on it resolves, so the guard discriminates rather than blocking.
    const present = acc({ curSuppliers: ["333"] });
    expect(
      resolveAnnexKey(
        withMembers({ "222": present, "333": present }),
        carrier(),
        100,
        {
          basis: "full",
          members: ["222", "333"],
        },
      ),
    ).toMatchObject({ via: "unp", value: 150 });
  });

  it("does NOT fire when the row's own key exists but was refused", () => {
    // Otherwise N members are N chances to get past a guard, which inverts what the guards are
    // for. ⚠️ The sibling here must be a genuine RESCUE candidate (anchor 500 == signing 500):
    // with two identical accumulators the sibling fails the same continuity guard the own key
    // just failed, so `toBeUndefined()` holds whether the precondition exists or not — that
    // fixture passed with `!idx.byUnpSupplier.has(ownKey)` deleted, i.e. it pinned nothing.
    const rescuer = acc({
      lastEurFull: 500,
      curEurFull: 600,
      curSuppliers: ["333"],
    });
    const idx = index({
      byUnpSupplier: new Map([
        ["00123-2024-0001|222", acc()], // the own key — continuity-refused at signing 500
        ["00123-2024-0001|333", rescuer],
      ]),
    });
    expect(
      resolveAnnexKey(idx, contract(), 500, {
        basis: "full",
        members: ["333"],
      }),
    ).toBeUndefined();
    // Positive control: with no own key in the index the SAME sibling resolves. Without this the
    // assertion above could go vacuous again the next time the fixture is edited.
    expect(
      resolveAnnexKey(idx, carrier(), 500, {
        basis: "full",
        members: ["333"],
      }),
    ).toMatchObject({ via: "unp", value: 600 });
  });

  it("is tried AFTER the own K2 key and BEFORE K1", () => {
    // Placement, pinned in both directions. The carrier has a K1 key that would resolve to a
    // different value, so a probe running after K1 — or not at all — is visible in the result.
    const idx = index({
      byUnpSupplier: new Map([["00123-2024-0001|222", acc()]]),
      byContractNo: new Map([["111|42", acc({ curEurFull: 900 })]]),
    });
    expect(
      resolveAnnexKey(idx, carrier(), 100, { basis: "full", members: ["222"] }),
    ).toMatchObject({ via: "unp", value: 150 });
    // …and with no member set it falls through to K1, which is the pre-Tier-2 answer.
    expect(
      resolveAnnexKey(idx, carrier(), 100, { basis: "full" }),
    ).toMatchObject({ via: "contract_no", value: 900 });
  });

  it("does not fire on the split basis — Tier 2 is scoped to post-087 carriers", () => {
    const idx = withMembers({ "222": acc(), "333": acc() });
    expect(
      resolveAnnexKey(idx, carrier(), 100, {
        basis: "split",
        members: ["222", "333"],
      }),
    ).toBeUndefined();
  });
});

describe("membersByConsortiumGroup — 087's group identity", () => {
  const member = (
    ocid: string,
    contractId: string,
    eik: string,
    consortiumEik = "111",
  ) => ({
    ocid,
    contractId,
    contractorEik: eik,
    consortiumRole: "member",
    consortiumEik,
  });

  it("does NOT merge two awards that share a named carrier EIK", () => {
    // The whole reason the key is (ocid, contract_id): a named carrier's consortium_eik is a real
    // ДЗЗД company that recurs across awards — 42 of them span groups with different member sets
    // (323 groups measured) — so grouping by it hands one award the other's members, which is the
    // cross-contract attribution the probe's agreement rule exists to refuse.
    const m = membersByConsortiumGroup([
      member("o1", "c1", "A"),
      member("o2", "c2", "B"),
    ]);
    expect([...m.values()]).toEqual([["A"], ["B"]]);
  });

  it("groups members of the SAME award together", () => {
    const m = membersByConsortiumGroup([
      member("o1", "c1", "A"),
      member("o1", "c1", "B"),
    ]);
    expect(m.get(consortiumGroupKey({ ocid: "o1", contractId: "c1" }))).toEqual(
      ["A", "B"],
    );
  });

  it("ignores carriers and non-consortium rows", () => {
    const m = membersByConsortiumGroup([
      {
        ocid: "o1",
        contractId: "c1",
        contractorEik: "X",
        consortiumRole: "carrier",
      },
      {
        ocid: "o1",
        contractId: "c1",
        contractorEik: "Y",
        consortiumRole: null,
      },
      member("o1", "c1", "A"),
    ]);
    expect([...m.values()]).toEqual([["A"]]);
  });

  it("treats a NULL contract_id as 087 does — the empty string, not a distinct group", () => {
    // 087 groups on COALESCE(contract_id, ''), so two members of one ocid-only award must land
    // in the same bucket rather than in two singletons.
    const m = membersByConsortiumGroup([
      {
        ocid: "o1",
        contractId: null,
        contractorEik: "A",
        consortiumRole: "member",
      },
      {
        ocid: "o1",
        contractId: null,
        contractorEik: "B",
        consortiumRole: "member",
      },
    ]);
    expect([...m.values()]).toEqual([["A", "B"]]);
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
