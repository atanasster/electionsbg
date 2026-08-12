// The person page tells a reader, in a sentence, that the site holds no roll-call vote for
// an MP's terms. This is the gate that the sentence is TRUE.
//
// It exists because the defect it guards is invisible to every unit test: it is a property
// of the CORPUS, not of the function. The first cut of `rollcallCoverage` derived the answer
// from `mp_profile.ns_folders` — the roster's view of a career — and was wrong for 70 of the
// 293 MPs it targeted (24%), because `mp_profile` and `mp_seat` are partly disjoint id
// spaces: 527 seat ids have no profile row, and the same human is routinely one id in each.
//
//   mp_profile : mp_id 2671, ns_folders {42,43}          ← what the page read
//   mp_seat    : mp_id  779, ns 44, ЖЕЛЬО ИВАНОВ БОЙЧЕВ  ← what the site actually holds
//
// So /person/mp-2671 asserted that no roll-call existed for his terms while serving his
// 44th-NS votes — publishing OUR identity-linking gap as the National Assembly's failure to
// publish. The fix is `mp_entry().hasRollcall`, and this test is what keeps it honest: it
// re-derives the claim from the two tables directly and fails if the page could ever make it
// about someone in the corpus.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "mp_entry().hasRollcall is true for every MP the corpus actually holds",
  async () => {
    // Straight from mp_seat: anyone with a seat row, under their id or their name, must
    // come back `true` — the value the page requires before it stays silent.
    const rows = await allRows<{ mp_id: number; name: string }>(`
      WITH seated AS (
        SELECT DISTINCT p.mp_id, p.name
          FROM mp_profile p
          JOIN mp_seat s
            ON s.mp_id = p.mp_id
            OR upper(regexp_replace(btrim(s.name), '\\s+', ' ', 'g'))
             = upper(regexp_replace(btrim(p.name), '\\s+', ' ', 'g'))
      )
      SELECT mp_id, name FROM seated
       WHERE (mp_entry(mp_id, NULL)->>'hasRollcall')::boolean IS DISTINCT FROM true
       ORDER BY mp_id
       LIMIT 20`);
    assert.deepEqual(
      rows.map((r) => `mp-${r.mp_id} ${r.name}`),
      [],
      "MPs in mp_seat whose mp_entry() denies roll-call coverage",
    );
  },
);

test.skipIf(skip)(
  "no MP the note targets is in the roll-call corpus",
  async () => {
    // The claim as the page makes it: nsFolders entirely below the boundary AND
    // hasRollcall false. Re-derived here against mp_seat rather than trusting the same
    // function the page trusts, so a regression in `hasRollcall` cannot hide behind itself.
    // Returned 70 rows before the fix.
    const rows = await allRows<{ mp_id: number; name: string }>(`
      WITH claimed AS (
        SELECT p.mp_id, p.name
          FROM mp_profile p
         WHERE cardinality(p.ns_folders) > 0
           AND (SELECT max(f::int) FROM unnest(p.ns_folders) f WHERE f ~ '^[0-9]+$') < 44
           AND (mp_entry(p.mp_id, NULL)->>'hasRollcall')::boolean IS NOT TRUE
      )
      SELECT c.mp_id, c.name FROM claimed c
       WHERE EXISTS (
         SELECT 1 FROM mp_seat s
          WHERE s.mp_id = c.mp_id
             OR upper(regexp_replace(btrim(s.name), '\\s+', ' ', 'g'))
              = upper(regexp_replace(btrim(c.name), '\\s+', ' ', 'g')))
       ORDER BY c.mp_id
       LIMIT 20`);
    assert.deepEqual(
      rows.map((r) => `mp-${r.mp_id} ${r.name}`),
      [],
      "the page would tell these MPs we hold no roll-call — we hold their votes",
    );
  },
);

test.skipIf(skip)("the note still reaches the people it is for", async () => {
  // A `hasRollcall` that returned true for everyone would pass both tests above by making
  // the note unreachable. Станишев (39/40 НС) is the case the note exists to explain.
  const [row] = await allRows<{ has: boolean | null }>(
    `SELECT (mp_entry(868, NULL)->>'hasRollcall')::boolean AS has`,
  );
  assert.equal(
    row?.has,
    false,
    "mp-868 (39/40 НС) should be out of the corpus",
  );

  const [n] = await allRows<{ c: number }>(`
      SELECT count(*)::int AS c FROM mp_profile p
       WHERE cardinality(p.ns_folders) > 0
         AND (SELECT max(f::int) FROM unnest(p.ns_folders) f WHERE f ~ '^[0-9]+$') < 44
         AND (mp_entry(p.mp_id, NULL)->>'hasRollcall')::boolean IS NOT TRUE`);
  assert.ok(
    (n?.c ?? 0) > 100,
    `expected the note to reach the pre-corpus MPs, got ${n?.c}`,
  );
});
