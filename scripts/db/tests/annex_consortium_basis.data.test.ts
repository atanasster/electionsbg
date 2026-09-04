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
}

const links = (r: Row, index: AnnexIndex, basis: ContractBasis): boolean => {
  if (r.signed == null || r.signed <= 0) return false;
  return !!resolveAnnexKey(
    index,
    {
      unp: r.unp ?? undefined,
      contractorEik: r.contractor_eik ?? undefined,
      awarderEik: r.awarder_eik ?? undefined,
      contractId: r.contract_id ?? undefined,
    } as Contract,
    r.signed,
    { basis },
  );
};

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

const loadRows = (): Promise<Row[]> =>
  allRows<Row>(
    `SELECT unp, awarder_eik, contractor_eik, contract_id,
            COALESCE(signing_amount_eur, amount_eur) AS signed, consortium_role
       FROM contracts
      WHERE tag = 'contract' AND COALESCE(signing_amount_eur, amount_eur) > 0`,
  );

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
