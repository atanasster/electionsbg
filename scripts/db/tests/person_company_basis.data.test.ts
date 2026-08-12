// Gate for person_company_bridge_a (148) — the ONE definition of "this person↔company link
// came from a curated register", read by 082's per-company `linkBasis` on /person and by
// 120's `tr_link_basis` on /persons.
//
//   npm run test:data
//
// WHY THIS FILE EXISTS. Until tr-attribution-basis-v1, 120 classified each TR link and 082
// did not, so the browser caveated a company list that the profile presented flat. The fix is
// not "both classify" but "both read the same view" — two implementations of one rule is how
// the surfaces come to disagree about a named person, which 120's own header calls the worst
// bug it can carry. This gate is what makes the shared definition load-bearing rather than
// merely tidy: it re-folds 082's per-company answers with 120's rule and demands equality.
//
// Requires Postgres + the person layer + person_browse_table; auto-skips when absent. IT
// SKIPS ON THE SOURCE, NEVER ON THE TARGET — a view that classifies nothing is one of the
// states this file exists to catch.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { sumExecutionBuffers } from "../lib/explain_buffers";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      `SELECT to_regclass('person_company_bridge_a') IS NOT NULL
          AND to_regprocedure('person_by_slug(text)') IS NOT NULL
          AND to_regclass('person_browse_table') IS NOT NULL AS ok`,
    );
    return Boolean(t?.ok);
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / person layer absent";

afterAll(async () => {
  await end();
});

test.skipIf(skip)("the view classifies a non-empty set of pairs", async () => {
  // The floor. Every assertion below is satisfied vacuously by an empty view — and an empty
  // view is not hypothetical: it is what a database gets when `company_politicians` was never
  // loaded (db:load:tr:pg is a REFRESH_EXCLUSIONS member), and it silently reclassifies every
  // curated link on the site as a name match.
  const [b] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM person_company_bridge_a",
  );
  assert.ok(
    Number(b.n) > 0,
    "person_company_bridge_a is EMPTY — every company on every /person and /persons row is " +
      "now labelled 'name_match', including the declared holdings. Load company_politicians " +
      "(db:load:tr:pg) and magistrate_company (db:load:magistrates:pg).",
  );
});

test.skipIf(skip)(
  "082's per-company linkBasis folds to 120's tr_link_basis, for every person",
  async () => {
    // 120's rule, restated once here rather than imported: bool_and → 'declared',
    // bool_or → 'mixed', else 'name_match'. If that rule changes in 120 this test fails,
    // which is the intent — the two must move together.
    // SAMPLED, and the sampling is not uniform on purpose. `person_by_slug` is a per-person
    // function call, so reconciling all ~86k people with a basis took 89 s — too slow to keep
    // in the suite. The two classes that can be WRONG in the damaging direction are tiny
    // (~400 declared + mixed), so they are taken IN FULL; 'name_match' is the default answer,
    // where a bug shows up on any row, so a bounded deterministic sample suffices.
    const rows = await allRows<{
      slug: string;
      browse: string;
      profile: string;
    }>(
      `WITH b AS (
         (SELECT slug, tr_link_basis FROM person_browse_table
           WHERE tr_link_basis IN ('declared', 'mixed'))
         UNION ALL
         (SELECT slug, tr_link_basis FROM person_browse_table
           WHERE tr_link_basis = 'name_match' ORDER BY slug LIMIT 400)
       ),
       p AS (
         SELECT b.slug, b.tr_link_basis AS browse,
                person_by_slug(b.slug) -> 'companies' AS companies
           FROM b
       )
       SELECT slug, browse,
              CASE
                -- NULL companies = person_by_slug served NOTHING for a person the browse
                -- table lists. That is the privacy gates diverging (082's two vs 120's pub),
                -- which is a real defect and the most likely one in this family — so it is
                -- reported as a mismatch rather than fenced out with a companies IS NOT NULL
                -- filter. An earlier draft had that fence and would have passed through
                -- exactly the divergence this step introduced by widening one gate, not both.
                WHEN companies IS NULL THEN 'NOT SERVED by person_by_slug'
                WHEN jsonb_array_length(companies) = 0 THEN 'no companies'
                WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(companies) c
                                  WHERE c ->> 'linkBasis' <> 'declared') THEN 'declared'
                WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(companies) c
                              WHERE c ->> 'linkBasis' = 'declared')      THEN 'mixed'
                ELSE 'name_match'
              END AS profile
         FROM p`,
    );

    assert.ok(
      rows.length > 0,
      "no person carries a tr_link_basis — nothing was compared",
    );

    // A NULL profile side means person_by_slug returned no companies for a person the browse
    // table says has them. That is a real disagreement (usually the privacy gate diverging),
    // not a skip.
    const mismatched = rows.filter((r) => r.browse !== r.profile);
    assert.deepEqual(
      mismatched.slice(0, 10),
      [],
      `${mismatched.length} of ${rows.length} people are classified differently by /person ` +
        `and /persons. Both must read person_company_bridge_a (148); a second definition of ` +
        `Bridge A is how these two surfaces come to claim different things about one human.`,
    );
  },
);

test.skipIf(skip)(
  "linkBasis still discriminates — both values occur",
  async () => {
    // Without this, the reconciliation above passes for a view that returns everything or
    // nothing: both surfaces would agree on a single constant answer.
    const [c] = await allRows<{ declared: string; name_match: string }>(
      `WITH sample AS (
       (SELECT slug FROM person_browse_table
         WHERE tr_link_basis IN ('declared', 'mixed') ORDER BY slug LIMIT 20)
       UNION ALL
       (SELECT slug FROM person_browse_table
         WHERE tr_link_basis = 'name_match' ORDER BY slug LIMIT 20)
     )
     SELECT count(*) FILTER (WHERE c ->> 'linkBasis' = 'declared')   AS declared,
            count(*) FILTER (WHERE c ->> 'linkBasis' = 'name_match') AS name_match
       FROM sample s,
            LATERAL jsonb_array_elements(person_by_slug(s.slug) -> 'companies') c`,
    );
    assert.ok(
      Number(c.declared) > 0 && Number(c.name_match) > 0,
      `linkBasis is constant across the sample (declared=${c.declared}, ` +
        `name_match=${c.name_match}) — it is not classifying anything`,
    );
  },
);

test.skipIf(skip)(
  "the per-person Bridge-A lookup stays a keyed lookup, not a scan",
  async () => {
    // 082 joins this view once per profile request, on the hottest page in the person layer,
    // and the view's own body is an OR-join over person_role — the shape that becomes a table
    // scan the moment the person_id predicate stops being pushed down. Measured at 10 buffers
    // when built (0.266 ms); the ceiling is deliberately loose so ordinary catalog growth does
    // not fail it, and tight enough that a whole-table plan (person_role is ~315k rows) cannot
    // pass.
    const [p] = await allRows<{ person_id: string }>(
      "SELECT person_id::text FROM person_company_bridge_a LIMIT 1",
    );
    const rows = await allRows<{ "QUERY PLAN": string }>(
      "EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT * FROM person_company_bridge_a WHERE person_id = $1",
      [p.person_id],
    );
    const buffers = sumExecutionBuffers(rows);
    assert.ok(
      buffers < 500,
      `the Bridge-A lookup touched ${buffers} buffers for one person — it was 10. The ` +
        `person_id predicate is no longer reaching person_role_pkey, so /person now pays a ` +
        `scan of person_role per request:\n${rows.map((r) => r["QUERY PLAN"]).join("\n")}`,
    );
  },
);
