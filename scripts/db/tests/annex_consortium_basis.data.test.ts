// The annex→contract linkage must survive `rebuild_consortium()` (087).
//
// WHY: `perSupplier` (annexResolve.ts) divides the annex feed's FULL published value by the
// published supplier count, because the month-shard convention stores a joint award split per
// member. 087 UNDOES that split for the rows it promotes — the whole value onto one carrier row,
// members zeroed — so on a CARRIER the divisor makes the continuity anchor short by exactly the
// member count and guard 2 refuses. Measured 2026-09-04 before the fix: 15,435 consortium rows
// carried 10 annex links between them, against 4.9% coverage on plain rows.
//
// ⚠️ AND THE MIRROR IS EQUALLY REAL, which is what this gate exists to hold in BOTH directions.
// 087 promotes CONSORTIA only: `joint_kind = 'framework'` keeps the equal split by design (its
// step 2 — independent parallel winners, not one joint award), and so does every multi-supplier
// award its HAVING did not group. Claiming "full" for every Postgres row therefore trades one
// silent loss for another — measured, 83 currently-linked annex rows (9 framework, 74 ungrouped)
// with anchor/signed an exact integer 2–8. So the basis is a property of the ROW.
//
// THE INVARIANT: `consortium_role = 'carrier'` ⇒ "full", everything else ⇒ "split", and each
// arm links strictly more rows under its own basis than under the other. The ratio, not the
// count, is the assertion — the counts move with every corpus reload, and 0 linked carriers is
// indistinguishable from a small corpus without a comparison against the plain rows.
//
// It derives linkage with the resolver rather than reading `procurement_annexes`, deliberately:
// the table is only as fresh as the last `db:load:annexes:pg`, and a gate that goes green because
// somebody re-ran a loader is measuring the operator, not the rule.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import {
  buildAnnexIndex,
  consortiumGroupKey,
  memberProbeHits,
  membersByConsortiumGroup,
  resolveAnnexKey,
  type AnnexIndex,
  type ContractBasis,
} from "../../procurement/lib/annexResolve";
import type { Contract } from "../../procurement/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOADER = path.resolve(__dirname, "../load_annexes_pg.ts");

const haveDb = await dbReachable();
const { idx, records } = haveDb
  ? buildAnnexIndex()
  : { idx: undefined as AnnexIndex | undefined, records: 0 };

// Two DISTINCT skip reasons. "No annex cache" must never read as "the rule is enforced": the
// cache is gitignored (`ingest_anexi.ts --backfill` writes it), so a fresh clone has none.
const skip = !haveDb
  ? "Postgres unreachable"
  : records === 0
    ? "no annex cache on disk (raw_data/procurement/anexi) — nothing to resolve"
    : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

interface Row {
  unp: string | null;
  awarder_eik: string | null;
  contractor_eik: string | null;
  contract_id: string | null;
  signed: number | null;
  consortium_role: string | null;
  consortium_eik: string | null;
  ocid: string | null;
  members?: readonly string[];
}

/** ⚠️ `members` is NOT defaulted, and must not be: a default parameter fires on an explicit
 *  `undefined`, so `resolve(r, idx, "full", undefined)` would silently pass `r.members` and every
 *  "without the member set" comparison below would measure the same thing twice. Pass `NO_MEMBERS`
 *  to suppress the probe. */
const NO_MEMBERS: readonly string[] = [];

const resolve = (
  r: Row,
  index: AnnexIndex,
  basis: ContractBasis,
  members: readonly string[] | undefined,
): ReturnType<typeof resolveAnnexKey> => {
  if (r.signed == null || r.signed <= 0) return undefined;
  return resolveAnnexKey(
    index,
    {
      unp: r.unp ?? undefined,
      contractorEik: r.contractor_eik ?? undefined,
      awarderEik: r.awarder_eik ?? undefined,
      contractId: r.contract_id ?? undefined,
    } as Contract,
    r.signed,
    { basis, members },
  );
};

/** The row's own members — spelled out at every call site so no default can fire on an
 *  explicit `undefined` (see NO_MEMBERS). */
const links = (r: Row, index: AnnexIndex, basis: ContractBasis): boolean =>
  !!resolve(r, index, basis, r.members);

/** How many of `rows` the resolver links under `basis`. */
const linked = (rows: Row[], index: AnnexIndex, basis: ContractBasis): number =>
  rows.filter((r) => links(r, index, basis)).length;

/** ⚠️ PER-ROW, never a net count. Over any large population the two bases agree on the
 *  overwhelming majority — every single-supplier contract is identical under both — so
 *  `linked(split) - linked(full)` washes the signal out entirely: measured 2026-09-04 over the
 *  391,805 non-carrier rows it is 19,037 against 19,052, i.e. the WRONG SIGN, while 83 rows are
 *  in fact being dropped. What discriminates is the count of rows linked under one basis and
 *  refused under the other. */
const exclusive = (
  rows: Row[],
  index: AnnexIndex,
  basis: ContractBasis,
  other: ContractBasis,
): number =>
  rows.filter((r) => links(r, index, basis) && !links(r, index, other)).length;

/** Every row, with each carrier carrying the member EIKs 087 linked to it — the same shape
 *  load_annexes_pg.ts builds. Members themselves sit at 0 and are dropped by the WHERE, so the
 *  set has to be gathered before that filter. */
const loadRows = async (): Promise<Row[]> => {
  const all = await allRows<Row>(
    `SELECT unp, awarder_eik, contractor_eik, contract_id,
            COALESCE(signing_amount_eur, amount_eur) AS signed,
            consortium_role, consortium_eik, ocid
       FROM contracts
      WHERE tag = 'contract'`,
  );
  // ⚠️ The GROUP, never `consortium_eik` — 087 groups by (ocid, contract_id), and a named
  // carrier's EIK recurs across awards with different member sets. Mirrors the loader.
  const gr = (r: Row) => ({
    ocid: r.ocid,
    contractId: r.contract_id,
    contractorEik: r.contractor_eik,
    consortiumRole: r.consortium_role,
  });
  const byGroup = membersByConsortiumGroup(all.map(gr));
  return all
    .filter((r) => r.signed != null && r.signed > 0)
    .map((r) => ({
      ...r,
      members:
        r.consortium_role === "carrier"
          ? byGroup.get(consortiumGroupKey(gr(r)))
          : undefined,
    }));
};

// The gain: carriers must link at a rate comparable to ordinary rows. Before the per-row basis
// they linked at 0.6% against 4.9% — an 8× shortfall — so the factor is deliberately loose
// enough to survive corpus drift and far tighter than the defect.
const MIN_CARRIER_RATE_FACTOR = 3;

test.skipIf(skip)(
  "consortium carriers link at a rate within 3× of plain rows",
  async () => {
    const rows = await loadRows();
    const carriers = rows.filter((r) => r.consortium_role === "carrier");
    const plain = rows.filter((r) => r.consortium_role == null);
    assert.ok(
      carriers.length > 100 && plain.length > 1000,
      `corpus too small to compare: ${carriers.length} carriers, ${plain.length} plain rows`,
    );

    const carrierRate = linked(carriers, idx!, "full") / carriers.length;
    const plainRate = linked(plain, idx!, "split") / plain.length;
    assert.ok(
      carrierRate >= plainRate / MIN_CARRIER_RATE_FACTOR,
      `consortium carriers link at ${(100 * carrierRate).toFixed(2)}% against ` +
        `${(100 * plainRate).toFixed(2)}% for plain rows — more than ${MIN_CARRIER_RATE_FACTOR}× ` +
        `apart. 087 un-splits the carrier row, so load_annexes_pg.ts must resolve it on the ` +
        `"full" basis; check the consortium_role test at its resolveAnnexKey call.`,
    );
  },
);

test.skipIf(skip)(
  "mutation: forcing the split divisor on carriers links strictly fewer of them",
  async () => {
    // Without this, the assertion above is satisfied by an implementation that changed nothing —
    // a corpus where carriers happen to link well would pass either way.
    const rows = (await loadRows()).filter(
      (r) => r.consortium_role === "carrier",
    );
    const gained = exclusive(rows, idx!, "full", "split");
    const lost = exclusive(rows, idx!, "split", "full");
    assert.ok(
      gained > lost,
      `the basis has stopped discriminating on carriers: "full" links ${gained} that ` +
        `"split" refuses, and "split" links ${lost} that "full" refuses. Either 087 no longer ` +
        `un-splits the carrier row, or annexDivisor() has lost its "full" arm.`,
    );
  },
);

test.skipIf(skip)(
  "mutation: forcing the full divisor on NON-carrier rows links strictly fewer — the framework class",
  async () => {
    // The FINDING-001 regression, pinned. 087 leaves frameworks and ungrouped multi-supplier
    // awards on the equal split, so an unconditional `basis: "full"` in the loader drops them.
    const rows = (await loadRows()).filter(
      (r) => r.consortium_role !== "carrier",
    );
    const wouldDrop = exclusive(rows, idx!, "split", "full");
    assert.ok(
      wouldDrop > 0,
      `no non-carrier row now links on "split" and fails on "full", so nothing here would ` +
        `catch a loader that claimed "full" for every Postgres row — the exact regression this ` +
        `gate exists for (83 such rows measured 2026-09-04). Either 087 changed, or the ` +
        `corpus no longer holds a framework/ungrouped multi-supplier award with an annex.`,
    );
  },
);

// Static, no database: the rule above is only worth holding if the LOADER uses it. Deleting the
// basis argument from its resolveAnnexKey call leaves every unit test green, because no unit test
// imports the loader.
test("load_annexes_pg.ts derives the basis per row from consortium_role", () => {
  const src = fs.readFileSync(LOADER, "utf8");
  assert.match(
    src,
    /consortium_role\s*===\s*"carrier"\s*\?\s*"full"\s*:\s*"split"/,
    "load_annexes_pg.ts must choose the basis per row from 087's consortium_role — see " +
      "docs/plans/annex-linkage-consortium-basis-v1.md. An unconditional basis is wrong in " +
      'both directions: omit it and every carrier is refused, hard-code "full" and every ' +
      "framework row is.",
  );
  assert.match(
    src,
    /SELECT[\s\S]*?consortium_role[\s\S]*?FROM contracts/,
    "the loader's contracts query must select consortium_role, or the basis above is always " +
      "the default.",
  );
});

// ── the synthetic carrier (Tier 2) ───────────────────────────────────────────────────────────
//
// 087 mints an `obed-<md5(member set)>` id for an unnamed consortium — 2,686 of 4,040 carriers.
// That id is OURS, so `canonicalEik` folds it to "" and no supplier-keyed annex index can ever
// hold it: the K2 own-key probe becomes `"<unp>|"` and always misses. Those carriers reach their
// annexes only through the member EIKs the register actually published.

const isSynthetic = (r: Row): boolean =>
  !!r.contractor_eik?.startsWith("obed-");

test.skipIf(skip)(
  "synthetic carriers link only through their member set",
  async () => {
    const rows = (await loadRows()).filter(isSynthetic);
    assert.ok(
      rows.length > 100,
      `expected a synthetic-carrier population to test; found ${rows.length}`,
    );
    // ⚠️ NOT "how many link at all" — K1 (buyer + contract №) reaches most of these already
    // (516 of 2,687 measured 2026-09-04, identically with and without the probe), so that
    // count is flat and the assertion would be vacuous. What the probe changes is WHICH key
    // answers: a synthetic carrier can never resolve `via: "unp"` on its own, because its own
    // key is the unmatchable `"<unp>|"`. So the УНП arm firing at all IS the probe.
    const viaUnp = rows.filter(
      (r) => resolve(r, idx!, "full", r.members)?.via === "unp",
    ).length;
    const viaUnpWithout = rows.filter(
      (r) => resolve(r, idx!, "full", NO_MEMBERS)?.via === "unp",
    ).length;
    assert.equal(
      viaUnpWithout,
      0,
      `a synthetic carrier resolved via the УНП key WITHOUT its member set (${viaUnpWithout} ` +
        `rows). That should be impossible — canonicalEik folds an obed- id to "", so the own ` +
        `key is "<unp>|". If this fires, either 087 stopped minting synthetic ids or ` +
        `canonicalEik started accepting them, and the probe's premise needs re-checking.`,
    );
    assert.ok(
      viaUnp > 0,
      `the member-set probe has stopped firing: 0 of ${rows.length} synthetic carriers ` +
        `resolve via the УНП key. Either load_annexes_pg.ts stopped passing members, or the ` +
        `probe's agreement test now refuses everything — those awards are then reachable by ` +
        `the K1 arm alone, which is the pre-Tier-2 state.`,
    );
  },
);

// Static: the loader must actually supply the member sets, for the same reason as the basis.
test("load_annexes_pg.ts passes the carrier's member set to the resolver", () => {
  const src = fs.readFileSync(LOADER, "utf8");
  assert.match(
    src,
    /resolveAnnexKey\([\s\S]{0,120}\{\s*basis,\s*members\s*\}/,
    "load_annexes_pg.ts must pass `members` alongside `basis` — without it every synthetic " +
      "`obed-` carrier is unreachable by K2, which is what Tier 2 of " +
      "docs/plans/annex-linkage-consortium-basis-v1.md fixes.",
  );
  assert.match(
    src,
    /membersByConsortiumGroup\(/,
    "the loader must build its member map with membersByConsortiumGroup() rather than its own " +
      "grouping — 087's group identity is (ocid, contract_id), and a hand-rolled map keyed on " +
      "consortium_eik hands a named carrier another award's members (42 EIKs / 323 groups).",
  );
  assert.match(
    src,
    /consortiumGroupKey\(/,
    "…and must look the members up by that same group key.",
  );
});

test.skipIf(skip)(
  "the member-set agreement rule still refuses a non-trivial share",
  async () => {
    // A rule that refuses nothing is indistinguishable from a rule that VOTES — and every other
    // assertion in this file moves monotonically UP when the refusal is deleted, so none of them
    // can tell the two apart. Measured 2026-09-04: 151 of 506 probe-eligible synthetic carriers
    // refused. The repo convention for a refusal (aop_expert_person_links, is_declared_holding)
    // is exactly this: a corpus arm proving it still discriminates.
    const rows = (await loadRows()).filter(isSynthetic);
    const eligible = rows.filter(
      (r) => memberProbeHits(idx!, r.unp ?? undefined, r.members).length > 0,
    );
    const refused = eligible.filter(
      (r) => resolve(r, idx!, "full", r.members)?.via !== "unp",
    );
    assert.ok(
      eligible.length > 50,
      `too few probe-eligible synthetic carriers to judge: ${eligible.length}`,
    );
    assert.ok(
      refused.length > 0 && refused.length < eligible.length,
      `the agreement rule has stopped discriminating: ${refused.length} of ${eligible.length} ` +
        `probe-eligible synthetic carriers refused. 0 means it votes (a member's OTHER contract ` +
        `under this procedure would be attributed here); all means it blocks everything.`,
    );
  },
);

test.skipIf(skip)(
  "mutation: without the agreement rule strictly more carriers would resolve",
  async () => {
    // `memberProbeHits` is the probe's candidate gathering WITHOUT the nos/shapes test, so this
    // compares the real rule against the voting implementation over the same corpus.
    const rows = (await loadRows()).filter(isSynthetic);
    const withRule = rows.filter(
      (r) => resolve(r, idx!, "full", r.members)?.via === "unp",
    ).length;
    const voting = rows.filter(
      (r) => memberProbeHits(idx!, r.unp ?? undefined, r.members).length > 0,
    ).length;
    assert.ok(
      voting > withRule,
      `the refusal costs nothing (${voting} would resolve by voting against ${withRule} that ` +
        `do), so this gate cannot tell a refusing probe from a voting one.`,
    );
  },
);
