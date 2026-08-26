// Gate for person_company_bridge_a (148) — the ONE definition of "this person↔company link
// came from a curated register", read by 082's per-company `linkBasis` on /person, by 082's
// per-SEAT `linkBasis` on the same page's „Управа на ЮЛНЦ" block, and by 120's
// `tr_link_basis` on /persons.
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
import { allRows, withTx, end } from "../lib/pg";
import { sumExecutionBuffers } from "../lib/explain_buffers";
import { reportSkip } from "../../lib/report_skip";

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
reportSkip(import.meta.url, skip);

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
  "082's per-seat ngos linkBasis agrees with the view, for every seat",
  async () => {
    // THE ASYMMETRY THIS EXISTS FOR. The client is armoured against an ABSENT basis —
    // `isNameMatch` reads undefined as a name match, so an older 082 over-caveats and nothing
    // is over-claimed. Nothing is armoured against a WRONG one: invert the CASE in 082 and
    // 5,670 name-matched board seats render as register-confirmed, with no mark and no
    // caveat, on pages naming real individuals beside real organisations. The component is
    // right to trust the server, so only a database-side gate can catch that direction.
    //
    // Whole-population rather than sampled, unlike the companies arm above: the seat corpus
    // is ~5.7k rows against ~86k people with companies, so this costs seconds.
    const [r] = await allRows<{ bad: string; n: string; declared: string }>(
      `SELECT count(*) FILTER (WHERE mismatch) AS bad,
              count(*) AS n,
              count(*) FILTER (WHERE basis = 'declared') AS declared
         FROM (
           SELECT e ->> 'linkBasis' AS basis,
                  (e ->> 'linkBasis' = 'declared')
                    IS DISTINCT FROM (ba.uic IS NOT NULL) AS mismatch
             FROM person p
             CROSS JOIN LATERAL jsonb_array_elements(
                          COALESCE(person_by_slug(p.slug) -> 'ngos', '[]'::jsonb)) e
             LEFT JOIN person_company_bridge_a ba
                    ON ba.person_id = p.person_id AND ba.uic = e ->> 'eik'
            WHERE EXISTS (SELECT 1 FROM person_role r2
                           WHERE r2.person_id = p.person_id AND r2.source = 'ngo')
         ) x`,
    );
    assert.equal(
      Number(r.bad),
      0,
      `${r.bad} of ${r.n} NGO board seats carry a linkBasis that disagrees with ` +
        `person_company_bridge_a. A seat wrongly marked 'declared' renders with NO „по име" ` +
        `chip and NO block caveat — an unqualified attribution of an organisation to a named ` +
        `person, which is the one direction the client cannot fail safe on.`,
    );
    // Non-vacuity, BOTH ways. An empty seat corpus satisfies "0 mismatches" — and so does an
    // implementation that collapsed every seat to 'name_match', which reads as "more caveat,
    // therefore harmless" and is not: it strips the 57 genuinely register-confirmed seats of
    // a distinction the register earned. The declared floor is well under today's 57 so
    // ordinary corpus movement does not fail it.
    assert.ok(
      Number(r.n) > 1000,
      `only ${r.n} NGO seats were compared — the assertion above is near-vacuous. ` +
        `Load the person layer (db:resolve:persons) before reading this gate.`,
    );
    assert.ok(
      Number(r.declared) > 0,
      `no NGO seat is classified 'declared' (of ${r.n}) — the basis is a constant on this ` +
        `arm and is classifying nothing, even though the companies arm discriminates.`,
    );
  },
);

/** Does this plan reach `person_role` through the person_id key rather than scanning it?
 *
 *  THIS, not a buffer count, is the invariant. The view's body is an OR-join over
 *  person_role, which becomes a full scan the moment the predicate stops being pushed down —
 *  on the hottest page in the person layer, joined once per profile request. */
const keyedOnPersonRole = (plan: string): boolean =>
  /Index (Only )?Scan using person_role_pkey/.test(plan) &&
  !/Seq Scan on person_role\b/.test(plan);

const busiestBridgedPerson = async (): Promise<{
  person_id: string;
  roles: string;
}> => {
  const [p] = await allRows<{ person_id: string; roles: string }>(
    `SELECT b.person_id::text, count(r.*)::text AS roles
       FROM (SELECT DISTINCT person_id FROM person_company_bridge_a) b
       JOIN person_role r USING (person_id)
      GROUP BY b.person_id
      -- person_id breaks the tie, so the pick cannot move when two people share a count.
      ORDER BY count(r.*) DESC, b.person_id
      LIMIT 1`,
  );
  return p;
};

test.skipIf(skip)(
  "the per-person Bridge-A lookup stays a keyed lookup, not a scan",
  async () => {
    // ⚠️ THIS USED TO ASSERT A BUFFER CEILING OF 500 AGAINST AN UNORDERED `LIMIT 1`, AND BOTH
    // HALVES WERE WRONG. Measured 2026-08-26:
    //
    //   - The probe was non-deterministic. `SELECT person_id … LIMIT 1` with no ORDER BY reads
    //     whichever row is physically first, so a resolve — which DELETEs and re-COPYs
    //     person_role — silently re-points it at a different person. That is the defect
    //     person_resolve.data.test.ts's privacy probe documents and fixed with ORDER BY.
    //   - The ceiling could not discriminate what its message claimed. Cost here tracks the
    //     PERSON'S ROLE COUNT, not the plan shape: company_politicians (44 pages) is
    //     seq-scanned once per qualifying role inside the nested loop, so a 1-role person costs
    //     77 buffers and a 25-role person costs 3,745 — and person_role is reached through
    //     person_role_pkey in BOTH. The 500 ceiling sat BELOW the worst legitimate plan, so on
    //     any corpus whose first physical row is a busy person it failed while nothing was wrong.
    //
    // So the assertion is now the plan SHAPE, which is what the comment always meant, and the
    // probe is the WORST realistic case rather than an arbitrary one — deterministic, and
    // chosen so this cannot be accused of passing by picking the cheapest person.
    const worst = await busiestBridgedPerson();
    const rows = await allRows<{ "QUERY PLAN": string }>(
      "EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT * FROM person_company_bridge_a WHERE person_id = $1",
      [worst.person_id],
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    const buffers = sumExecutionBuffers(rows);

    assert.ok(
      keyedOnPersonRole(plan),
      `the Bridge-A lookup no longer reaches person_role through person_role_pkey, so /person ` +
        `pays a scan of the whole table per request:\n${plan}`,
    );
    // The secondary guard, calibrated BETWEEN the two plans rather than against one sample:
    // the worst legitimate plan is 3,745 buffers (the 25-role person, identical on local and
    // Cloud SQL) and the scan this exists to catch is 95,232 local / 124,336 cloud. 20,000
    // leaves 5.3x headroom above the worst good plan — room for a person with ~130 roles —
    // and still sits ~5x below the cheapest bad one.
    assert.ok(
      buffers < 20_000,
      `the Bridge-A lookup touched ${buffers} buffers for the busiest person ` +
        `(${worst.roles} roles) — the worst legitimate plan measured 3,745. The plan is still ` +
        `keyed, so this is not a lost index: something widened the per-role fan-out.\n${plan}`,
    );
  },
);

test.skipIf(skip)(
  "…and that check still discriminates a scan from a lookup",
  async () => {
    // Without this the assertion above is only as good as its regex. A predicate that silently
    // stopped matching — a plan-node rename, an EXPLAIN format change — would report every plan
    // as keyed and the gate would pass for ever on a corpus doing full scans.
    //
    // So the bad plan is CONSTRUCTED and the same predicate run against it. Plain EXPLAIN, not
    // ANALYZE: the shape is all that is needed, and executing it would read ~1 GB. Inside a
    // transaction so the planner settings are LOCAL and nothing leaks to another session.
    const worst = await busiestBridgedPerson();
    const plan = await withTx(async (c) => {
      await c.query("SET LOCAL enable_indexscan = off");
      await c.query("SET LOCAL enable_indexonlyscan = off");
      await c.query("SET LOCAL enable_bitmapscan = off");
      const { rows } = await c.query<{ "QUERY PLAN": string }>(
        "EXPLAIN (COSTS OFF) SELECT * FROM person_company_bridge_a WHERE person_id = $1",
        [worst.person_id],
      );
      return rows.map((r) => r["QUERY PLAN"]).join("\n");
    });
    assert.ok(
      /Seq Scan on person_role\b/.test(plan),
      "could not construct a scanning plan even with index scans disabled — the calibration " +
        "above is then untestable, so re-derive it rather than trusting the ceiling",
    );
    assert.equal(
      keyedOnPersonRole(plan),
      false,
      `keyedOnPersonRole() reports a deliberately index-free plan as keyed, so it discriminates ` +
        `nothing and the assertion above is vacuous:\n${plan}`,
    );
  },
);
