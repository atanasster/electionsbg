// MP_ARM_SQL / MP_ARM_ALL_SQL — the two queries that produce every MP↔company link the site
// publishes. The first fills `company_politicians` at kind='mp' (the chips on `/company/:eik`
// and the MP arm of the A–F contract grade); the second is its unrestricted twin, read live by
// `scripts/funds/cross_reference.ts` for the ИСУН MP-tied payload.
//
// WHY THIS FILE EXISTS — it is the successor of `mp_roles_sql.data.test.ts`, deleted with
// `augment_mp_roles.ts` (company-page-consolidation-v1 Tier 5.2), and it carries that file's
// argument forward unchanged. The query it guarded had `ORDER BY (t.erased_at IS NULL) DESC`
// under a `SELECT DISTINCT` — invalid in Postgres (0P000) — and so failed on EVERY run for two
// days while the caller's catch reported it as "Postgres unreachable", the one warning an
// operator is trained to ignore. Unit tests could not catch it: they mock `allRows`, so the
// SQL string is never parsed by anything. Executing it is the only gate that discriminates.
//
// ⚠️ MP_ARM_ALL_SQL IS THE ONE THAT WOULD REPEAT IT. MP_ARM_SQL is at least run by
// `db:load:tr:pg`, so a syntax error there surfaces on the next load. MP_ARM_ALL_SQL has NO
// loader — its only caller is an offline funds ingest whose gate mocks the pool — so without
// this file nothing would parse it until an operator ran the ingest, and its failure path is
// `mpLinkageAvailable() === true` followed by a throw, i.e. an aborted ingest rather than a
// wrong number. Loud, but only when someone happens to run it.
//
// NONE of the predecessor's three assertions is carried over, and each for its own reason.
// The two ORDERING ones are inapplicable because both queries aggregate with
// `jsonb_agg`/`array_agg` under an explicit total order INSIDE the aggregate, so there is no
// "keep the first row" dedup outside the query for a row order to break. The third —
// `is_current` agrees with `erased_at` on every row — guarded a caller that recomputed
// `isCurrent` independently of the column it sorted on; the `reg` CTE now derives it once,
// with `bool_or(t.erased_at IS NULL)`, and folds it straight into the emitted `rel` jsonb, so
// there is no second derivation left to disagree.
//
// What replaces them is an assertion that the two arms differ in exactly one way — the money
// join — since that difference is what stops the funds payload inheriting a contract
// restriction that belongs to a different corpus.
//
// Auto-skips when Postgres is down or the person layer has never been resolved. The probe is
// TOP-LEVEL and feeds test.skipIf (docs/testing-standards.md): an early `return` inside a test
// body scores as a PASS, so CI would report this green while asserting nothing.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { MP_ARM_SQL, MP_ARM_ALL_SQL } from "../load_tr_pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_role WHERE source = 'mp'",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const skip = !(await reachable());

afterAll(async () => {
  await end();
});

type Row = {
  eik: string;
  politician: string;
  ref: string;
  role: string;
  total_eur: string | null;
  person_id: string;
  relations: Array<{ kind: string }>;
};

test.skipIf(skip)("MP_ARM_SQL executes against the live schema", async () => {
  // The assertion IS that this does not throw. A syntax error, a renamed column or a dropped
  // table all surface here — and, for the funds twin below, nowhere else.
  const rows = await allRows<Row>(MP_ARM_SQL);
  assert.ok(Array.isArray(rows), "expected a row set");
  console.log(`[mp_arm_sql] contract-restricted arm: ${rows.length} row(s)`);
});

test.skipIf(skip)(
  "MP_ARM_ALL_SQL executes against the live schema",
  async () => {
    const rows = await allRows<Row>(MP_ARM_ALL_SQL);
    assert.ok(Array.isArray(rows), "expected a row set");
    console.log(`[mp_arm_sql] unrestricted arm: ${rows.length} row(s)`);
  },
);

test.skipIf(skip)(
  "the unrestricted arm is a strict superset, differing only in the money join",
  async () => {
    // If it ever narrowed, the funds payload would silently under-report; if the two ever
    // coincided, `requireContracts` would have stopped doing anything and the restriction
    // would be back on a corpus it does not belong to.
    const key = (r: Row) => `${r.person_id}:${r.eik}`;
    const restricted = new Set((await allRows<Row>(MP_ARM_SQL)).map(key));
    const all = new Set((await allRows<Row>(MP_ARM_ALL_SQL)).map(key));
    const missing = [...restricted].filter((k) => !all.has(k));
    assert.equal(
      missing.length,
      0,
      `${missing.length} contract-restricted pair(s) absent from the unrestricted arm: ` +
        missing.slice(0, 5).join(", "),
    );
    assert.ok(
      all.size > restricted.size,
      `the two arms returned the same ${all.size} pair(s) — requireContracts has stopped ` +
        `discriminating, and the funds payload is back on a procurement filter`,
    );
    console.log(
      `[mp_arm_sql] ${restricted.size} restricted ⊂ ${all.size} unrestricted pair(s)`,
    );
  },
);

test.skipIf(skip)(
  "total_eur is procurement money on the restricted arm and NULL on the other",
  async () => {
    // Not cosmetic: a 0 there would render as "won nothing" rather than "not asked". The
    // unrestricted arm LEFT JOINs the money CTE precisely so the absence stays an absence.
    const restricted = await allRows<Row>(MP_ARM_SQL);
    assert.equal(
      restricted.filter((r) => r.total_eur === null).length,
      0,
      "a contract-restricted row with no procurement total — the inner join has been loosened",
    );
    const all = await allRows<Row>(MP_ARM_ALL_SQL);
    assert.ok(
      all.some((r) => r.total_eur === null),
      "no unrestricted row carries a NULL total — either every linked company now holds a " +
        "contract, or the LEFT JOIN has been coalesced to a fabricated zero",
    );
  },
);

test.skipIf(skip)(
  "every ref is the /candidate/mp-<id> shape both readers parse",
  async () => {
    // scripts/lib/mp_linkage.ts drops a row whose ref does not match, and reports the count.
    // A ref-shape change is therefore a silent halving of both payloads, not a failure.
    const rows = await allRows<Row>(MP_ARM_ALL_SQL);
    const bad = rows.filter((r) => !/^\/candidate\/mp-\d+$/.test(r.ref));
    assert.equal(
      bad.length,
      0,
      `${bad.length} row(s) carry a ref readMpLinkRows would drop, e.g. ${bad[0]?.ref}`,
    );
  },
);
