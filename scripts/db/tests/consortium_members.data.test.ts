// Tier 3 (Postgres-native) — a joint award keeps EVERY member, including foreign ones.
//
// The defect: a non-BG member of a MIXED consortium was dropped by both normalizers
// (foreign suppliers survived only when a contract had NO BG supplier at all), so the
// corpus recorded the wrong counterparty for joint awards. On УНП 00042-2024-0005 — МТС,
// €451.5m, 35 electric multiple units, the largest НПВУ rolling-stock contract — the ЦАИС
// release names four suppliers and the corpus held two: both Alstom entities, the actual
// manufacturers, were absent, so searching the corpus for "Alstom" returned nothing on the
// contract that bought Alstom trains. Corpus-wide, 211 awards / €987m were affected.
//
// This gate pins the END state after 087's rebuild_consortium(): all four members present,
// the named carrier holding the full value, members at €0, and the group total unchanged.
// The last part is the one that matters most — keeping more members must not inflate
// anything, because the value lives on the carrier regardless of member count.
//
//   npm run test:data
//
// Requires the Postgres store; auto-skips when Postgres is unreachable or the contracts
// table is absent, exactly like invariants_pg.data.test.ts. It does NOT skip when the
// award is missing — an absent award means the corpus predates the fix, which is the state
// this test exists to catch.
//
// NOTE this asserts against a corpus that has been RE-INGESTED since the fix
// (`ingest_eop --backfill --include-existing-buyers --apply` for the affected days, then
// the annex pass — see docs/plans/procurement-foreign-consortium-members-v1.md §5 T2).
// The code fix alone does not move rows already on disk.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const UNP = "00042-2024-0005";
const AWARD_EUR = 451_500_000;

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

interface MemberRow {
  contractor_eik: string;
  contractor_name: string;
  joint_kind: string | null;
  consortium_role: string | null;
  consortium_size: number | null;
  amount_eur: number | null;
  consortium_full_eur: number | null;
}

const members = async (): Promise<MemberRow[]> =>
  allRows<MemberRow>(
    `SELECT contractor_eik, contractor_name, joint_kind, consortium_role,
            consortium_size, amount_eur, consortium_full_eur
       FROM contracts WHERE unp = $1 AND tag = 'contract'
      ORDER BY amount_eur DESC NULLS LAST`,
    [UNP],
  );

test.skipIf(skip)(
  "the Alstom award keeps all four consortium members",
  async () => {
    const rows = await members();
    assert.equal(
      rows.length,
      4,
      `${UNP} should carry 4 members, got ${rows.length}: ${rows
        .map((r) => `${r.contractor_eik}/${r.contractor_name}`)
        .join(", ")}`,
    );
    // The two that used to vanish, matched on the foreign registry ids the source
    // publishes (`supplierRegisterNumber` = "…; RO6640696; IT02791070044; …").
    for (const eik of ["RO6640696", "IT02791070044"]) {
      assert.ok(
        rows.some((r) => r.contractor_eik === eik),
        `foreign member ${eik} missing — the mixed-consortium drop has regressed`,
      );
    }
  },
);

test.skipIf(skip)("value sits on the carrier, members at zero", async () => {
  const rows = await members();
  const carriers = rows.filter((r) => r.consortium_role === "carrier");
  assert.equal(carriers.length, 1, "expected exactly one carrier");
  // The named ДЗЗД/Консорциум member is the carrier — not a synthetic `obed-` entity.
  assert.match(carriers[0].contractor_name, /Консорциум/i);
  assert.ok(
    Math.abs(Number(carriers[0].amount_eur) - AWARD_EUR) < 1,
    `carrier should hold €${AWARD_EUR}, got ${carriers[0].amount_eur}`,
  );
  for (const r of rows.filter((x) => x.consortium_role === "member")) {
    assert.equal(
      Number(r.amount_eur),
      0,
      `member ${r.contractor_eik} must be participation-only (€0), got ${r.amount_eur}`,
    );
  }
});

test.skipIf(skip)(
  "keeping more members did not change the award total",
  async () => {
    const rows = await members();
    // This is the property that makes the fix safe to apply corpus-wide: the group total
    // is carrier-full + members-zero, so it is invariant to the member count. Before the
    // fix the same award totalled €451.5m across 2 rows; after, across 4.
    const total = rows.reduce((s, r) => s + Number(r.amount_eur ?? 0), 0);
    assert.ok(
      Math.abs(total - AWARD_EUR) < 1,
      `award total must stay €${AWARD_EUR}, got ${total}`,
    );
    for (const r of rows) {
      assert.equal(Number(r.consortium_size), 4, "consortium_size should be 4");
      assert.ok(
        Math.abs(Number(r.consortium_full_eur) - AWARD_EUR) < 1,
        "every row should record the full joint value",
      );
    }
  },
);
