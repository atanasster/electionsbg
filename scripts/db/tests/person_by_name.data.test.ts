// Gate for person_by_name (082) — the bare-NAME → profile resolver behind the fallback half
// of /api/db/person-profile. It is a separate file from person_search.data.test.ts because it
// guards a different property: not "does the search rank sensibly" but "does this point
// lookup still PLAN as a point lookup".
//
//   npm run test:data
//
// Requires the Postgres store + `db:resolve:persons`; auto-skips when Postgres or the person
// layer is absent — like the other *.data.test.ts gates.
//
// WHY THE PLAN TEST IS THE ONE THAT EARNS ITS PLACE. Every behavioural case below —
// resolution, ambiguity, the §6 privacy gate — passed against the OLD body too, the one that
// read all 58,152 person rows and returned 500 on prod at the 10 s statement_timeout
// (docs/plans/db-route-timeouts-v1.md §1.1). Correct-but-quadratic is exactly what a
// behavioural suite cannot see, so the last test asserts the buffer count and proves the
// assertion still discriminates by restoring the old body inside a rolled-back transaction.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { allRows, withClient, end } from "../lib/pg";
import { sumExecutionBuffers } from "../lib/explain_buffers";

const byName = (name: string): Promise<{ slug?: string } | null> =>
  allRows<{ r: { slug?: string } | null }>("SELECT person_by_name($1) AS r", [
    name,
  ]).then((x) => x[0]?.r ?? null);

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regprocedure('person_by_name(text)') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person WHERE status = 'active' AND is_public_figure",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / person layer empty";

afterAll(async () => {
  await end();
});

// Every fixture pick below carries a deterministic ORDER BY. Over pools of 3,222 / 11 / 1,281
// rows a bare LIMIT 1 is free to return a different row per run, so a failure could vanish on
// re-run and a pass would not imply the next run exercises the same row. Matches the sibling
// convention in person_search.data.test.ts.
//
// And every fixture-dependent case calls ctx.skip() rather than returning: a silent return
// reports as PASSED, which is the vacuous-pass reading this file exists to avoid.

// ── Resolution ───────────────────────────────────────────────────────────────
// A name_fold held by exactly one servable person resolves to that person. Self-selects its
// fixture from the live corpus so nothing here hardcodes a name that could leave the data.
test.skipIf(skip)("a unique fold resolves to its person", async () => {
  const [pick] = await allRows<{ name: string; want: string }>(
    `SELECT min(display_name) AS name, min(slug) AS want
       FROM person WHERE status='active' AND is_public_figure
      GROUP BY name_fold HAVING count(*) = 1
      ORDER BY name_fold LIMIT 1`,
  );
  assert.ok(pick, "corpus must hold at least one unambiguous public person");
  assert.equal((await byName(pick.name))?.slug, pick.want);
});

// A fold shared by >1 servable person returns NULL rather than guessing, so the caller shows
// the legacy portfolio / a chooser.
test.skipIf(skip)("an ambiguous fold returns null", async (ctx) => {
  const [amb] = await allRows<{ name: string }>(
    `SELECT min(display_name) AS name FROM person
      WHERE status='active' AND is_public_figure
      GROUP BY name_fold HAVING count(*) > 1
      ORDER BY name_fold LIMIT 1`,
  );
  if (!amb) return ctx.skip("no namesake collision in this corpus");
  assert.equal(await byName(amb.name), null);
});

// ── The alias branch, deliberately ───────────────────────────────────────────
// The UNION's second branch resolves a variant spelling that exists ONLY in person_alias.
// Picked as an alias_fold that is NOT any person's name_fold, so a pass cannot come from the
// first branch — today every non-public person happens to carry a self-fold alias row, which
// would make an undiscriminating fixture cover this branch only by accident.
test.skipIf(skip)(
  "an alias-only spelling resolves via the alias branch",
  async (ctx) => {
    const [pick] = await allRows<{ alias: string; want: string }>(
      `SELECT a.alias_raw AS alias, min(p.slug) AS want
         FROM person_alias a
         JOIN person p ON p.person_id = a.person_id
        WHERE p.status='active' AND p.is_public_figure
          AND NOT EXISTS (SELECT 1 FROM person n WHERE n.name_fold = a.alias_fold)
        GROUP BY a.alias_raw, a.alias_fold
       HAVING count(DISTINCT p.person_id) = 1
        ORDER BY a.alias_raw LIMIT 1`,
    );
    if (!pick) return ctx.skip("no alias-only fold in this corpus");
    assert.equal((await byName(pick.alias))?.slug, pick.want);
  },
);

// ── §6 privacy gate ──────────────────────────────────────────────────────────
// THESE TWO ASSERT THE COMPOSITE, NOT THE BRANCH, and the distinction is not pedantic.
// person_by_name always terminates in person_by_slug, which re-applies the identical §6 gate
// in its own `pick` CTE — so a private or review-status person that leaks past a UNION
// branch's filter is caught one call later and the composite still returns NULL. Mutation
// testing confirms it: deleting either half of the gate from either branch leaves both of
// these green. They are still worth having (the composite is the contract the route depends
// on), but the per-branch filters are guarded by the ambiguity test below, not by these.
test.skipIf(skip)(
  "a private person is not servable by an alias of theirs",
  async (ctx) => {
    const [pick] = await allRows<{ alias: string }>(
      `SELECT a.alias_raw AS alias FROM person_alias a
         JOIN person p ON p.person_id = a.person_id
        WHERE NOT p.is_public_figure
          -- Exclude a fold that ANY servable person answers to, by name or by alias. Without
          -- the alias half, a future corpus row would fail this assertion as a privacy leak
          -- when it is really a fixture-selection bug.
          AND NOT EXISTS (SELECT 1 FROM person q
                           WHERE q.name_fold = a.alias_fold
                             AND q.status='active' AND q.is_public_figure)
          AND NOT EXISTS (SELECT 1 FROM person_alias b
                           JOIN person r ON r.person_id = b.person_id
                          WHERE b.alias_fold = a.alias_fold
                            AND r.status='active' AND r.is_public_figure)
        ORDER BY a.alias_raw LIMIT 1`,
    );
    if (!pick)
      return ctx.skip("every alias in this corpus belongs to a public figure");
    assert.equal(await byName(pick.alias), null, "leaked a private person");
  },
);

// The status half has NO natural fixture: every person row in the local corpus is
// status='active', so asserting against live data would pass vacuously. Create one inside a
// rolled-back transaction instead.
test.skipIf(skip)("a review-status person is not servable", async () => {
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      const { rows } = await c.query<{ display_name: string }>(
        `INSERT INTO person (display_name, given_fold, family_fold, name_parts, slug,
                             is_public_figure, status)
         VALUES ('Тестов Ревю Несервиран', 'testov', 'neserviran', 3,
                 'test-review-gate-fixture', true, 'review')
         RETURNING display_name`,
      );
      const [{ r }] = (
        await c.query<{ r: unknown }>("SELECT person_by_name($1) AS r", [
          rows[0].display_name,
        ])
      ).rows;
      assert.equal(r, null, "a review-status person must not be servable");
    } finally {
      // .catch: a throwing ROLLBACK would replace the assertion error above and lose the
      // diagnostic. Same guard as withTx in scripts/db/lib/pg.ts. Data safety does not depend
      // on it — withClient destroys an errored connection and Postgres rolls back on
      // disconnect regardless.
      await c.query("ROLLBACK").catch(() => {});
    }
  });
});

// THIS is what the per-branch gate actually protects, and the only observable it has. The
// gate is invisible through person_by_slug (above), but it is load-bearing for AVAILABILITY
// via the count(*) = 1 ambiguity wrapper, which counts slugs in `m` BEFORE person_by_slug
// filters. Drop the gate from a branch and a private namesake gets pulled into `m`, the count
// becomes 2, and a legitimate PUBLIC profile stops resolving — a 404 on a real person's page.
// Verified to fail under exactly that mutation.
test.skipIf(skip)(
  "a private namesake does not make a public profile ambiguous",
  async (ctx) => {
    const [pick] = await allRows<{ name: string; want: string }>(
      `SELECT pub.display_name AS name, pub.slug AS want
         FROM person pub
        WHERE pub.status = 'active' AND pub.is_public_figure
          AND EXISTS (SELECT 1 FROM person priv
                       WHERE priv.name_fold = pub.name_fold AND NOT priv.is_public_figure)
          AND NOT EXISTS (SELECT 1 FROM person o
                           WHERE o.name_fold = pub.name_fold AND o.is_public_figure
                             AND o.person_id <> pub.person_id)
        ORDER BY pub.slug LIMIT 1`,
    );
    // Explicit skip, not a silent pass: the fixture pool is ONE row today, so a corpus change
    // that loses it must show up as lost coverage in the reporter rather than as a green run.
    if (!pick)
      return ctx.skip("no public/private fold collision in this corpus");
    assert.equal(
      (await byName(pick.name))?.slug,
      pick.want,
      "a private namesake reached the count(*) = 1 wrapper — the §6 gate is missing from a UNION branch",
    );
  },
);

// ── The regression this file exists for ──────────────────────────────────────
// person_by_name is a point lookup on two btrees (idx_person_name_fold /
// idx_person_alias_fold). The old `OR` form could use neither and read the whole person
// table; a future edit that folds the UNION back into an OR would be CORRECT and would pass
// every test above, while restoring a 10 s prod timeout.
//
// Asserted on BUFFERS rather than on plan-node names: it is what actually hurts on Cloud SQL
// (the old form's ~3.8k exec buffers are ~30 MB of cold random reads) and it does not break
// when the planner picks a different-but-equally-good node shape.
//
// The control is the point: the SAME assertion is re-run with the old body restored inside a
// rolled-back transaction, and must FAIL. Without it a threshold test can rot into a pass
// that no longer measures anything — and note the second-order property, that raising the
// ceiling to silence a flaky `current` makes the `regressed` assertion fail instead.
//
// Total buffer ACCESSES, so the figures do not move with cache state: new 22, old 51,852. The
// ceiling sits ~9× above the new cost and ~259× below the old, so neither edge is close.
const BUFFER_CEILING = 200;

const bufferCost = async (c: PoolClient, name: string): Promise<number> => {
  // Warm this backend's catalog/syscache FIRST. The first person_by_name on a fresh
  // connection costs ~1,050 buffers of one-time planning warm-up that scales with
  // person_by_slug's size, not with how this function plans — enough to swing the measurement
  // 47× with test-execution order, and enough that future schema growth could fail this test
  // for a reason wholly unrelated to the regression it guards. sumExecutionBuffers drops the
  // planning section outright, so this is belt-and-braces rather than the only defence.
  await c.query("SELECT person_by_name($1)", [name]);
  const { rows } = await c.query<{ "QUERY PLAN": string }>(
    "EXPLAIN (ANALYZE, BUFFERS) SELECT person_by_name($1)",
    [name],
  );
  return sumExecutionBuffers(rows);
};

test.skipIf(skip)("resolves as an index lookup, not a table scan", async () => {
  // A miss is the worst case AND the one prod actually timed out on: a hit stops at the first
  // matching row, a miss had to scan to the end. This name is deliberately not a person.
  const MISS = "ОБЩИНА КИРКОВО";

  const current = await withClient((c) => bufferCost(c, MISS));
  assert.ok(
    current < BUFFER_CEILING,
    `person_by_name read ${current} buffers for a miss (ceiling ${BUFFER_CEILING}). ` +
      `It is scanning person instead of seeking idx_person_name_fold / idx_person_alias_fold ` +
      `— see docs/plans/db-route-timeouts-v1.md §1.1.`,
  );

  // Control: restore the pre-fix body and confirm this assertion would have caught it.
  //
  // Holds an ExclusiveLock on the person_by_name object for the duration (~340 ms with the
  // slow body). Concurrent CALLERS are unaffected — they read the committed body without
  // blocking — but a concurrent `apply_functions.ts 082_person_api.sql` or `db:resolve:persons`
  // against the same database would block on the lock. db:refresh sequences the loaders before
  // test:data, so the collision needs a hand-run loader during a test run.
  const regressed = await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`
        CREATE OR REPLACE FUNCTION person_by_name(p_name text)
        RETURNS jsonb LANGUAGE sql STABLE AS $fn$
          WITH f AS (SELECT translit_bg_latin(p_name) AS fold),
          m AS (
            SELECT DISTINCT p.slug FROM person p, f
             WHERE p.status = 'active' AND p.is_public_figure
               AND (p.name_fold = f.fold
                    OR EXISTS (SELECT 1 FROM person_alias a
                                WHERE a.person_id = p.person_id AND a.alias_fold = f.fold))
             LIMIT 2
          )
          SELECT CASE WHEN (SELECT count(*) FROM m) = 1
            THEN person_by_slug((SELECT slug FROM m LIMIT 1)) END;
        $fn$;`);
      return await bufferCost(c, MISS);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
    }
  });
  assert.ok(
    regressed >= BUFFER_CEILING,
    `the ceiling no longer discriminates: the pre-fix body read only ${regressed} buffers, ` +
      `under the ${BUFFER_CEILING} ceiling. This test has stopped measuring anything.`,
  );
});
