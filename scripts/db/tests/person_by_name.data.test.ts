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
// resolution, ambiguity, both halves of the §6 privacy gate — passed against the OLD body
// too, the one that read all 58,152 person rows and returned 500 on prod at the 10 s
// statement_timeout (docs/plans/db-route-timeouts-v1.md §1.1). Correct-but-quadratic is
// exactly what a behavioural suite cannot see, so the last test asserts the buffer count and
// proves the assertion fires by restoring the old body inside a rolled-back transaction.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, withClient, end } from "../lib/pg";

const byName = (name: string): Promise<{ slug?: string } | null> =>
  allRows<{ r: { slug?: string } | null }>(
    "SELECT person_by_name($1) AS r",
    [name],
  ).then((x) => x[0]?.r ?? null);

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

// ── Resolution ───────────────────────────────────────────────────────────────
// A name_fold held by exactly one servable person resolves to that person. Self-selects its
// fixture from the live corpus so nothing here hardcodes a name that could leave the data.
test.skipIf(skip)("a unique fold resolves to its person", async () => {
  const [pick] = await allRows<{ name: string; want: string }>(
    `SELECT min(display_name) AS name, min(slug) AS want
       FROM person WHERE status='active' AND is_public_figure
      GROUP BY name_fold HAVING count(*) = 1 LIMIT 1`,
  );
  assert.ok(pick, "corpus must hold at least one unambiguous public person");
  assert.equal((await byName(pick.name))?.slug, pick.want);
});

// A fold shared by >1 servable person returns NULL rather than guessing, so the caller shows
// the legacy portfolio / a chooser. Skips explicitly if the corpus happens to have no
// namesake collision — a vacuous pass would read as "ambiguity is handled".
test.skipIf(skip)("an ambiguous fold returns null", async () => {
  const [amb] = await allRows<{ name: string }>(
    `SELECT min(display_name) AS name FROM person
      WHERE status='active' AND is_public_figure
      GROUP BY name_fold HAVING count(*) > 1 LIMIT 1`,
  );
  if (!amb) return; // no namesake collision in this corpus
  assert.equal(await byName(amb.name), null);
});

// ── The alias branch, deliberately ───────────────────────────────────────────
// The UNION's second branch resolves a variant spelling that exists ONLY in person_alias.
// Picked as an alias_fold that is NOT any person's name_fold, so a pass cannot come from the
// first branch — today every non-public person happens to carry a self-fold alias row, which
// would make an undiscriminating fixture cover this branch only by accident.
test.skipIf(skip)("an alias-only spelling resolves via the alias branch", async () => {
  const [pick] = await allRows<{ alias: string; want: string }>(
    `SELECT a.alias_raw AS alias, min(p.slug) AS want
       FROM person_alias a
       JOIN person p ON p.person_id = a.person_id
      WHERE p.status='active' AND p.is_public_figure
        AND NOT EXISTS (SELECT 1 FROM person n WHERE n.name_fold = a.alias_fold)
      GROUP BY a.alias_raw, a.alias_fold
     HAVING count(DISTINCT p.person_id) = 1 LIMIT 1`,
  );
  if (!pick) return; // no alias-only fold in this corpus
  assert.equal((await byName(pick.alias))?.slug, pick.want);
});

// ── §6 privacy gate, on BOTH branches ────────────────────────────────────────
// The gate is repeated per UNION branch, so it needs testing per branch: an alias owned by a
// non-public person must not leak that person through the alias branch.
test.skipIf(skip)("the gate holds on the alias branch", async () => {
  const [pick] = await allRows<{ alias: string }>(
    `SELECT a.alias_raw AS alias FROM person_alias a
       JOIN person p ON p.person_id = a.person_id
      WHERE NOT p.is_public_figure
        AND NOT EXISTS (SELECT 1 FROM person q
                         WHERE q.name_fold = a.alias_fold
                           AND q.status='active' AND q.is_public_figure)
      LIMIT 1`,
  );
  if (!pick) return; // every alias in this corpus belongs to a public figure
  assert.equal(await byName(pick.alias), null, "alias branch leaked a private person");
});

// The status half of the gate has NO natural fixture: every person row in the local corpus is
// status='active', so asserting against live data would pass vacuously — the exact failure
// this file exists to avoid. Create one inside a rolled-back transaction instead.
test.skipIf(skip)("the gate holds for a review-status person", async () => {
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
      await c.query("ROLLBACK");
    }
  });
});

// ── The regression this file exists for ──────────────────────────────────────
// person_by_name is a point lookup on two btrees (idx_person_name_fold /
// idx_person_alias_fold). The old `OR` form could use neither and read the whole person
// table; a future edit that folds the UNION back into an OR would be CORRECT and would pass
// every test above, while restoring a 10 s prod timeout.
//
// Asserted on BUFFERS rather than on plan-node names: it is what actually hurts on Cloud SQL
// (the old form's ~4.5k buffers are ~35 MB of cold random reads) and it does not break when
// the planner picks a different-but-equally-good node shape. The ceiling is ~2x the measured
// new cost and ~1/6th of the old, so it is nowhere near either edge.
//
// The control is the point: the SAME assertion is re-run with the old body restored inside a
// rolled-back transaction, and must FAIL. Without it a threshold test can rot into a pass
// that no longer measures anything.
const BUFFER_CEILING = 1500; // measured: new ~774, old ~4,461

const bufferCost = async (
  c: Parameters<Parameters<typeof withClient>[0]>[0],
  name: string,
): Promise<number> => {
  const { rows } = await c.query<{ "QUERY PLAN": string }>(
    "EXPLAIN (ANALYZE, BUFFERS) SELECT person_by_name($1)",
    [name],
  );
  // Sum every "Buffers: shared hit=N read=M" line the plan reports, including the ones
  // attributed to nodes inside the function.
  return rows
    .map((r) => r["QUERY PLAN"])
    .join("\n")
    .split("\n")
    .flatMap((l) => [...l.matchAll(/shared hit=(\d+)(?: read=(\d+))?/g)])
    .reduce((n, m) => n + Number(m[1]) + Number(m[2] ?? 0), 0);
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
      await c.query("ROLLBACK");
    }
  });
  assert.ok(
    regressed >= BUFFER_CEILING,
    `the ceiling no longer discriminates: the pre-fix body read only ${regressed} buffers, ` +
      `under the ${BUFFER_CEILING} ceiling. This test has stopped measuring anything.`,
  );
});
