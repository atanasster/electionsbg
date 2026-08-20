// MP_ROLES_SQL — the query augment_mp_roles.ts runs to rebuild `companies-index.mpRoles`
// from the gated person layer (person_role at source tr/ngo ⨝ tr_person_roles, Bridge A/B).
//
// WHY THIS FILE EXISTS. The query had `ORDER BY (t.erased_at IS NULL) DESC` under a SELECT
// DISTINCT — invalid in Postgres (0P000: an ORDER BY *expression* must appear in the select
// list, even when every column it reads does). It therefore failed on every run from
// bffcdc5527 (2026-08-12) until 2026-08-14, and the caller's catch reported it as "Postgres
// unreachable" — the one warning an operator is trained to ignore, because a build machine
// without a database is normal. So the step that exists to STOP reading the retired
// mp-management shards silently published the shard-derived vintage for two days, with
// nothing red and the row counts of every other stage reconciling.
//
// The unit tests could not catch it: augment_mp_roles.test.ts mocks `allRows`, so the SQL
// string is never parsed by anything. Executing it is the only gate that discriminates.
//
// ⚠️ DO NOT DELETE THIS FILE WITH ITS CALLER. `augment_mp_roles.ts` is scheduled for
// retirement (company-page-consolidation-v1 Tier 5.2), and the reflex when a caller dies is
// to delete its test — which would drop the ONLY executing check on this query shape. Its
// successor is `scripts/db/tests/official_companies.data.test.ts`, which recomputes the same
// registry arm (person_role at tr/ngo ⨝ tr_person_roles on name_fold, gated on
// tr_name_fold_people) against migration 178. Move any assertion that is not already there
// BEFORE removing this, and check that file still executes SQL rather than mocking it.
//
// This asserts the query RUNS and orders as the dedup below it requires. It does NOT assert a
// row count — the set legitimately empties on a database without a resolved person layer, and
// that is what the skip is for.
//
// Auto-skips when Postgres is down or the person layer has never been resolved. The probe is
// TOP-LEVEL and feeds test.skipIf (docs/testing-standards.md): an early `return` inside a test
// body scores as a PASS, so CI would report this green while asserting nothing.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { MP_ROLES_SQL } from "../../declarations/augment_mp_roles";

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
  mp_id: number;
  uic: string;
  role: string;
  erased_at: Date | null;
  is_current: boolean;
  declared: boolean;
};

test.skipIf(skip)("MP_ROLES_SQL executes against the live schema", async () => {
  // The assertion IS that this does not throw. A syntax error, a renamed column or a dropped
  // table all surface here — and nowhere else, since the caller degrades on failure.
  const rows = await allRows<Row>(MP_ROLES_SQL);
  assert.ok(Array.isArray(rows), "expected a row set");
});

test.skipIf(skip)(
  "orders current-before-erased within one (mp, company, role)",
  async () => {
    // The load-bearing half of the ORDER BY: the caller keeps the FIRST row per (mpId, role),
    // so a triple carrying both an open and an erased filing decides whether the site says an
    // MP HOLDS a company or USED TO. Reordering is not a cosmetic regression.
    const rows = await allRows<Row>(MP_ROLES_SQL);
    let checked = 0;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      if (a.mp_id !== b.mp_id || a.uic !== b.uic || a.role !== b.role) continue;
      checked++;
      assert.ok(
        !(a.is_current === false && b.is_current === true),
        `erased row sorted before a current one for mp ${a.mp_id} / uic ${a.uic} / role ${a.role}`,
      );
    }
    // Not an assertion on `checked` — a corpus where no triple has both states is a valid
    // corpus, and failing on it would make this gate fail for the wrong reason. Reported so a
    // reader can tell "held" from "vacuously passed".
    console.log(
      `[mp_roles_sql] ${rows.length} rows, ${checked} same-triple adjacencies checked`,
    );
  },
);

test.skipIf(skip)("is_current agrees with erased_at on every row", async () => {
  // The projection exists for the ORDER BY, but the caller derives the emitted `isCurrent`
  // from `erased_at` independently. If those two ever disagreed, the ordering would sort by
  // one notion of "current" and the page would render the other.
  const rows = await allRows<Row>(MP_ROLES_SQL);
  const bad = rows.filter((r) => r.is_current !== (r.erased_at === null));
  assert.equal(
    bad.length,
    0,
    `${bad.length} row(s) where is_current disagrees with erased_at`,
  );
});
