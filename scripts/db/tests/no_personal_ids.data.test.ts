// Tier 3 (Postgres-native) — STANDING PRIVACY GATE: no Bulgarian personal identity
// number (ЕГН) may appear as an entity key anywhere in the served procurement tables.
//
// This is not a hypothetical. Until 2026-08-03 `contracts.contractor_eik` held 98
// distinct checksum-valid ЕГН across 148 rows, each beside the person's full name, and
// 196 per-EIK shard files under data/procurement/{contractors,contractor_contracts}/
// were literally NAMED with one. The cause was that the only question asked of a
// supplier id was `isValidEik`, which accepts 9–13 digits and therefore accepts a
// 10-digit ЕГН. See supplier_identity.ts and docs/plans/
// procurement-foreign-consortium-members-v1.md (defect D-1).
//
// Unlike most gates in this directory, this one is about disclosure rather than
// correctness — a regression here republishes personal data, so it is deliberately
// broad (every text key column that can carry a supplier-supplied id) rather than
// pinned to the one column that broke.
//
//   npm run test:data
//
// Requires the Postgres store; auto-skips when Postgres is unreachable or the
// contracts table is absent, exactly like invariants_pg.data.test.ts.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import {
  isEgn,
  isOrganisationName,
  isPersonalSupplier,
} from "../../procurement/supplier_identity";

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.contracts') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / contracts table absent";

afterAll(async () => {
  await end();
});

// (table, column) pairs that hold a supplier-supplied entity id. `contractor_eik` is
// where the leak happened; `contractor_eik_full` preserves the raw source id and so is
// the obvious second home for it.
const KEY_COLUMNS: [string, string][] = [
  ["contracts", "contractor_eik"],
  ["contracts", "contractor_eik_full"],
];

for (const [table, column] of KEY_COLUMNS) {
  test.skipIf(skip)(`${table}.${column} holds no ЕГН`, async () => {
    // Any DELIMITED 10-digit run, not `^[0-9]{10}$`. An anchored filter missed two real
    // shapes: a prefixed id ("BG6207316703") and an id embedded in a compound
    // identifier. The delimiters matter in the other direction too — an unanchored
    // \d{10} also matches a window inside a longer number, which false-positived the
    // 12-digit EIK 134708703000.
    //
    // The checksum is applied by the REAL validator rather than reimplemented in SQL: a
    // lookalike implementation is exactly how the first measurement of this defect went
    // wrong. `isPersonalSupplier` is the same predicate the classifier branches on, so
    // gate and code cannot drift — in particular both exclude organisation names, since
    // ~1 in 11 arbitrary 10-digit ids passes mod-11 by coincidence.
    const rows = await allRows<{ id: string; name: string }>(
      `SELECT DISTINCT ${column} AS id, contractor_name AS name FROM ${table}
        WHERE ${column} ~ '(^|\\D)[0-9]{10}(\\D|$)'`,
    );
    const leaks = rows.filter(
      (r) =>
        isPersonalSupplier(r.id, r.name) ||
        // Embedded in a compound id (legacy releaseId shape).
        [...String(r.id).matchAll(/(?<!\d)\d{10}(?!\d)/g)].some(
          (m) => isEgn(m[0]) && !isOrganisationName(r.name),
        ),
    );
    assert.equal(
      leaks.length,
      0,
      `${table}.${column} holds ${leaks.length} ЕГН — personal data must never be an entity key. ` +
        `Sample: ${leaks
          .slice(0, 5)
          .map((l) => `${l.id} (${l.name})`)
          .join(", ")}. ` +
        `Fix the resolver in scripts/procurement/supplier_identity.ts, then re-run ` +
        `scripts/procurement/__encode_personal_ids_inplace.ts and reload.`,
    );
  });
}

test.skipIf(skip)("contracts.release_id embeds no ЕГН", async () => {
  // legacy_csv builds releaseId as `aop-legacy-${year}-${documentId}-${contractorEik}`,
  // so the id is INSIDE the identifier. The first remediation rewrote contractor_eik and
  // re-minted `key` but left 21 rows carrying the ЕГН here.
  const rows = await allRows<{ id: string; name: string }>(
    `SELECT DISTINCT release_id AS id, contractor_name AS name FROM contracts
      WHERE release_id ~ '(^|\\D)[0-9]{10}(\\D|$)'`,
  );
  const leaks = rows.filter((r) =>
    [...String(r.id).matchAll(/(?<!\d)\d{10}(?!\d)/g)].some(
      (m) => isEgn(m[0]) && !isOrganisationName(r.name),
    ),
  );
  assert.equal(
    leaks.length,
    0,
    `contracts.release_id embeds ${leaks.length} ЕГН. Sample: ${leaks
      .slice(0, 5)
      .map((l) => l.id)
      .join(", ")}`,
  );
});

test.skipIf(skip)(
  "natural-person suppliers are keyed by the np- scheme",
  async () => {
    // The positive half of the gate: the 148 rows whose ЕГН was removed must still HAVE
    // an identity (name-derived), not have been silently dropped or blanked — otherwise a
    // future "fix" could satisfy the assertion above by deleting the contracts.
    const [r] = await allRows<{ n: string }>(
      "SELECT count(*)::text AS n FROM contracts WHERE contractor_eik LIKE 'np-%'",
    );
    assert.ok(
      Number(r.n) > 0,
      "no np- keyed contractor rows found — the personal-id encoding is missing, " +
        "so either the corpus predates it or the rows were dropped instead of re-keyed",
    );
  },
);
