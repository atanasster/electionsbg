// person_role.bridge / bridge_footprint (migration 081) — WHICH licence a tr/ngo role was
// attached under, and the footprint the cap was measured against WHEN it was attached.
// Plan: docs/plans/person-role-unlicensed-bridge-v1.md (steps 2-3).
//
// WHAT THESE PIN, and why the schema alone does not.
//
// A tr/ngo role attributes a COMPANY to a NAMED INDIVIDUAL. Three bridges license that, and
// until now the licence was never recorded — `person_resolve.data.test.ts` RE-DERIVED it at
// test time from seven tables that each reload on their own schedule, independently of
// `person_role`. So it asserted that two corpora were the same vintage rather than an
// invariant, and it went red (443 roles / 63 people) purely because `db:load:tr:pg` ran two
// days after the last resolve. These columns are what let the licence be checked as a stored
// fact instead.
//
// Two failure modes, both silent, both assertions here rather than comments:
//
//   - THE SPLIT SCHEMA. 081's ADD-COLUMN block is guarded, and a database that ends up with
//     `bridge` and not `bridge_footprint` (someone declaring one in the CREATE TABLE, a
//     hand-run ALTER against Cloud SQL) does not fail the apply — it fails the next resolve's
//     copyRows, ~37 minutes in.
//   - THE CHECK THAT FAILS OPEN. `bridge IN ('B','V')` is NULL when bridge is NULL, so the
//     obvious spelling of the footprint constraint evaluates to NULL for (NULL, 5) and a CHECK
//     ACCEPTS NULL. That admitted a measured footprint on a row carrying no licence — the one
//     contradictory shape the column's own header calls out, and the one a step-3 bug
//     produces, since the resolver stamps 'B'/'V' on two INSERTs and back-fills 'A' after.
//     `IS TRUE` closes it. A constraint that fails open looks identical to one that does not
//     in review, so this is pinned by INSERTING each row shape, never by string-matching
//     `pg_get_constraintdef` — that would pass on any expression containing the right tokens,
//     including the broken one.
//
// ⚠️ NOTHING HERE ASSERTS THE COLUMNS ARE POPULATED. That is step 4's gate, and it must stay
// separate: the columns are deliberately NULL until the next `db:resolve:persons` (081 ships
// no backfill, because the corpus vintage the resolver saw is not recoverable), so a
// population assertion here would be red on every database for reasons nobody can fix.
//
// Auto-skips only when Postgres is unreachable. It does NOT skip on an unresolved person
// layer: the schema is the subject, and it is present the moment 081 has been applied.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, withTx, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person_role') IS NOT NULL AS ok",
    );
    return Boolean(t?.ok);
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / person_role absent";
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

test.skipIf(skip)("bridge and bridge_footprint exist together", async () => {
  const rows = await allRows<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'person_role'
        AND column_name IN ('bridge', 'bridge_footprint')
      ORDER BY column_name`,
  );
  assert.deepEqual(
    rows.map((r) => r.column_name),
    ["bridge", "bridge_footprint"],
    "081's ADD-COLUMN block adds both columns behind one guard. A database holding one and " +
      "not the other applies 081 at exit 0 and then fails the next db:resolve:persons in " +
      "copyRows, ~37 minutes in. Re-apply 081_person_identity.sql.",
  );
});

// The row shapes, and what each MEANS. Kept as a table so a future relaxation has to delete a
// line with a sentence attached to it rather than quietly widen an expression.
const SHAPES: {
  bridge: string | null;
  footprint: number | null;
  legal: boolean;
  why: string;
}[] = [
  {
    bridge: null,
    footprint: null,
    legal: true,
    why: "attached before the columns existed — the state of the whole corpus until the next resolve",
  },
  {
    bridge: "A",
    footprint: null,
    legal: true,
    why: "a curated company link is not capped on a footprint, so it carries none",
  },
  {
    bridge: "B",
    footprint: 5,
    legal: true,
    why: "a public-figure bridge at the cap",
  },
  {
    bridge: "V",
    footprint: 1,
    legal: true,
    why: "a Tier-V private owner with one company",
  },
  {
    bridge: null,
    footprint: 5,
    legal: false,
    why:
      "a measurement against a licence nobody recorded — the CHECK failed OPEN on this " +
      "before `IS TRUE`, because `bridge IN ('B','V')` is NULL when bridge is NULL",
  },
  {
    bridge: "A",
    footprint: 5,
    legal: false,
    why:
      "an 'A' row with a footprint invites a consumer to compare a curated link against " +
      "FOOTPRINT_CAP and call it over-sized",
  },
  {
    bridge: "B",
    footprint: 0,
    legal: false,
    why:
      "0 is unreachable by construction — Bridge B's footprint CTE cannot emit a person " +
      "with no match, and Tier-V's HAVING group cannot be empty — so a stored 0 is a bug",
  },
  {
    bridge: "X",
    footprint: null,
    legal: false,
    why: "the licence vocabulary is closed at A/B/V",
  },
];

test.skipIf(skip)(
  "the bridge constraints admit exactly the licensed row shapes",
  async () => {
    // Everything below runs inside ONE transaction that is always rolled back, so this gate
    // never writes to person_role. It UPDATEs an existing row rather than inserting a
    // synthetic one — person_role has an FK to person, and minting a fake person to satisfy
    // it would test a shape the corpus cannot hold.
    const failures: string[] = [];
    await withTx(async (c) => {
      const { rows: pick } = await c.query<{
        person_id: string;
        source: string;
        ref: string;
        role: string;
      }>("SELECT person_id, source, ref, role FROM person_role LIMIT 1");
      if (!pick.length) return; // empty corpus — the shape test has nothing to ride on
      const key = pick[0];

      for (const s of SHAPES) {
        await c.query("SAVEPOINT shape");
        let threw = false;
        try {
          await c.query(
            `UPDATE person_role SET bridge = $1, bridge_footprint = $2
              WHERE person_id = $3 AND source = $4 AND ref = $5 AND role = $6`,
            [
              s.bridge,
              s.footprint,
              key.person_id,
              key.source,
              key.ref,
              key.role,
            ],
          );
        } catch {
          threw = true;
        }
        await c.query("ROLLBACK TO SAVEPOINT shape");

        const rendered = `(bridge=${s.bridge ?? "NULL"}, footprint=${s.footprint ?? "NULL"})`;
        if (s.legal && threw)
          failures.push(`${rendered} was REJECTED but is legal: ${s.why}`);
        if (!s.legal && !threw)
          failures.push(`${rendered} was ACCEPTED but is illegal: ${s.why}`);
      }
      // Belt and braces: the whole transaction is discarded regardless of the savepoints.
      throw new Error("rollback");
    }).catch((e: unknown) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });

    assert.deepEqual(
      failures,
      [],
      "person_role's bridge constraints do not match the licensed row shapes. A CHECK that " +
        "fails open on NULL is indistinguishable from a correct one in review, which is why " +
        "this inserts each shape rather than reading pg_get_constraintdef. Re-apply " +
        "081_person_identity.sql.",
    );
  },
);

test.skipIf(skip)(
  "both bridge constraints are VALIDATED, not left NOT VALID",
  async () => {
    // 081 adds them NOT VALID (so the ALTER does not scan the table while holding an
    // AccessExclusiveLock) and validates them in separate blocks afterwards. A run that timed
    // out between the two leaves constraints that are enforced for new writes and never
    // checked against what is already there — which is silent, since every row is NULL today
    // and so passes either way.
    const rows = await allRows<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint
        WHERE conrelid = 'public.person_role'::regclass
          AND conname IN ('person_role_bridge_check', 'person_role_bridge_footprint_check')
        ORDER BY conname`,
    );
    assert.deepEqual(
      rows.map((r) => r.conname),
      ["person_role_bridge_check", "person_role_bridge_footprint_check"],
      "a bridge CHECK constraint is missing — re-apply 081_person_identity.sql",
    );
    assert.deepEqual(
      rows.filter((r) => !r.convalidated).map((r) => r.conname),
      [],
      "a bridge CHECK is still NOT VALID — re-apply 081_person_identity.sql, whose VALIDATE " +
        "blocks sit outside the ADD guard precisely so an interrupted run converges.",
    );
  },
);
