// Correctness gate for `official_companies` (178) — the relation behind /governance/companies.
//
// The page lists companies against people in public life BY NAME, so every row is an
// attribution. Two things can go wrong quietly here and both have precedents in this repo:
// the population can be built on the wrong column and silently lose 40% of itself, and the
// people count can double-count exactly the best-evidenced rows.
//
// EXPECTATIONS ARE COMPUTED INDEPENDENTLY, in SQL that does not reuse the matview's own CTEs.
// A test that re-runs 178's query to check 178's output cannot fail.
//
// Auto-skips with a DISTINCT reason when the matview is absent or its inputs are unloaded —
// "the corpus is not built yet" must never read as "the rule holds".
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<string | false> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.official_companies') IS NOT NULL AS ok",
    );
    if (!t?.ok)
      return "official_companies absent — apply 178 (npm run db:load:declarations:pg -- --resolve)";
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM official_companies",
    );
    // NOT a skip: an empty matview is one of the two states this file exists to catch. The
    // skip covers "no database" and "178 never applied"; "applied and empty" is a failure.
    // Same discipline as procurement_settlement_payloads.data.test.ts.
    void c;
    return false;
  } catch {
    return "Postgres unreachable";
  }
};

const skip = await reachable();

afterAll(async () => {
  await end();
});

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  (await allRows<T>(sql, params))[0];

test.skipIf(skip)(
  "the population is the union of the two arms, independently recomputed",
  async () => {
    const r = await one<{
      mv: string;
      expected: string;
      missing: string;
      extra: string;
    }>(`
    WITH reg AS (
      SELECT DISTINCT ptr.ref AS uic
        FROM person_role ptr
        JOIN person pe ON pe.person_id = ptr.person_id
       WHERE ptr.source IN ('tr','ngo')
         AND ptr.confidence IN ('exact_id','high','manual')
         AND pe.status = 'active' AND pe.is_public_figure
         AND EXISTS (SELECT 1 FROM tr_person_roles t
                      WHERE t.uic = ptr.ref AND t.name_fold = pe.name_fold)
         AND EXISTS (SELECT 1 FROM tr_name_fold_people f
                      WHERE f.name_fold = pe.name_fold AND f.people_n = 1)),
    dec AS (
      SELECT DISTINCT sc.uic
        FROM declaration_stake_company sc
        JOIN person pe ON pe.person_id = sc.person_id
       WHERE pe.status = 'active' AND pe.is_public_figure),
    u AS (SELECT uic FROM reg UNION SELECT uic FROM dec)
    -- SET difference, both ways. Comparing count(*) to count(*) passes any swap that keeps
    -- the cardinality — which is exactly what a drifted predicate looks like.
    SELECT (SELECT count(*) FROM official_companies)::text AS mv,
           (SELECT count(*) FROM u)::text AS expected,
           (SELECT count(*) FROM (
              SELECT uic FROM u EXCEPT SELECT uic FROM official_companies) z)::text
             AS missing,
           (SELECT count(*) FROM (
              SELECT uic FROM official_companies EXCEPT SELECT uic FROM u) z)::text
             AS extra`);
    assert.ok(
      Number(r.mv) > 0,
      "official_companies is EMPTY — 178 applied but never built",
    );
    assert.equal(
      r.missing,
      "0",
      "companies the arms produce are missing from the matview",
    );
    assert.equal(
      r.extra,
      "0",
      "the matview carries companies the arms do not produce",
    );
    assert.equal(
      r.mv,
      r.expected,
      "the matview is stale or its predicate has drifted",
    );
  },
);

test.skipIf(skip)(
  "person_count counts DISTINCT people, not arm memberships",
  async () => {
    // THE MUTATION CHECK. A person reached by BOTH arms is one person. Summing the arms
    // instead would inflate exactly the best-evidenced rows — the ones where the registry and
    // the declarant agree — so the assertion is paired with proof that the two differ.
    const r = await one<{ mismatched: string; would_differ: string }>(`
    WITH reg AS (
      SELECT DISTINCT ptr.ref AS uic, pe.person_id
        FROM person_role ptr
        JOIN person pe ON pe.person_id = ptr.person_id
       WHERE ptr.source IN ('tr','ngo')
         AND ptr.confidence IN ('exact_id','high','manual')
         AND pe.status = 'active' AND pe.is_public_figure
         AND EXISTS (SELECT 1 FROM tr_person_roles t
                      WHERE t.uic = ptr.ref AND t.name_fold = pe.name_fold)
         AND EXISTS (SELECT 1 FROM tr_name_fold_people f
                      WHERE f.name_fold = pe.name_fold AND f.people_n = 1)),
    dec AS (
      SELECT DISTINCT sc.uic, sc.person_id
        FROM declaration_stake_company sc
        JOIN person pe ON pe.person_id = sc.person_id
       WHERE pe.status = 'active' AND pe.is_public_figure),
    distinct_people AS (
      SELECT uic, count(*) AS n FROM (
        SELECT uic, person_id FROM reg UNION SELECT uic, person_id FROM dec) z
       GROUP BY uic),
    summed AS (
      SELECT uic, count(*) AS n FROM (
        SELECT uic, person_id FROM reg UNION ALL SELECT uic, person_id FROM dec) z
       GROUP BY uic)
    SELECT (SELECT count(*) FROM official_companies oc
              JOIN distinct_people d ON d.uic = oc.uic
             WHERE oc.person_count <> d.n)::text AS mismatched,
           (SELECT count(*) FROM distinct_people d
              JOIN summed s ON s.uic = d.uic
             WHERE s.n <> d.n)::text AS would_differ`);
    assert.equal(
      r.mismatched,
      "0",
      "person_count disagrees with a distinct recount",
    );
    assert.ok(
      Number(r.would_differ) > 0,
      "no company is reached by both arms, so a summing implementation would also pass — " +
        "this check is vacuous on the current corpus",
    );
  },
);

test.skipIf(skip)(
  "it is NOT built on tr_company_place, which needs a resolved seat",
  async () => {
    // G2. `tr_company_place.person_link_n` answers almost this question and is already
    // indexed, so it looks like the ready-made basis — 151 uses it. But it holds only
    // companies whose free-text seat resolved to an EKATTE, so building on it drops a large
    // share of the population silently, at a 200, on the page whose job is to list them.
    const r = await one<{ total: string; placed: string }>(`
    SELECT count(*)::text AS total,
           count(*) FILTER (WHERE oblast_name IS NOT NULL)::text AS placed
      FROM official_companies`);
    assert.ok(
      Number(r.total) > Number(r.placed),
      "every row has a resolved place — either the seat resolver became exhaustive, or this " +
        "matview has been re-based on tr_company_place and is now missing the unseated companies",
    );
    // The unplaced share is large enough that the substitution is not a rounding difference.
    assert.ok(
      Number(r.total) - Number(r.placed) > 1000,
      "the unplaced population has collapsed — check the basis",
    );
  },
);

test.skipIf(skip)(
  "both arms are populated, and neither is the whole",
  async () => {
    const r = await one<{ reg: string; dec: string; both: string }>(`
    SELECT count(*) FILTER (WHERE has_registry_link)::text AS reg,
           count(*) FILTER (WHERE has_declared_stake)::text AS dec,
           count(*) FILTER (WHERE has_registry_link AND has_declared_stake)::text AS both
      FROM official_companies`);
    assert.ok(Number(r.reg) > 0, "the registry arm is empty");
    assert.ok(Number(r.dec) > 0, "the declared arm is empty");
    // If either flag were constant-true the flags would carry no information and a surface
    // saying WHICH evidence it has would be lying.
    const [total] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM official_companies",
    );
    assert.ok(
      Number(r.dec) < Number(total.n),
      "has_declared_stake is true for every row",
    );
    assert.ok(
      Number(r.both) > 0,
      "the two arms never overlap — check the join keys",
    );
  },
);

test.skipIf(skip)(
  "money_eur is 127's figure, and absent money is €0 rather than NULL",
  async () => {
    const r = await one<{ nulls: string; drift: string }>(`
    SELECT count(*) FILTER (WHERE money_eur IS NULL)::text AS nulls,
           (SELECT count(*) FROM official_companies oc
              JOIN company_public_money m ON m.eik = oc.uic
             WHERE oc.money_eur IS DISTINCT FROM COALESCE(m.public_money_eur, 0))::text
             AS drift
      FROM official_companies`);
    // NULL would sort beside the largest values on a money-ordered page.
    assert.equal(r.nulls, "0", "money_eur is NULL somewhere — it must be 0");
    assert.equal(
      r.drift,
      "0",
      "money_eur has drifted from company_public_money (127)",
    );
  },
);

test.skipIf(skip)(
  "the uniqueness key holds, so the page cannot list a company twice",
  async () => {
    const r = await one<{ dupes: string }>(
      "SELECT (count(*) - count(DISTINCT uic))::text AS dupes FROM official_companies",
    );
    assert.equal(r.dupes, "0");
  },
);

test.skipIf(skip)(
  "the fold gate is RE-CHECKED here, not inherited from resolve time",
  async () => {
    // person_role's confidence was decided when the resolver last ran, and the registry moves
    // underneath it. Without a live join to tr_name_fold_people, rows keyed on a fold the
    // Commerce Registry NOW says belongs to several people stay published — naming the wrong
    // individual as a company's officer. 150's header documents the same staleness.
    const r = await one<{ shared: string }>(`
    SELECT count(*)::text AS shared
      FROM official_companies oc
     WHERE oc.has_registry_link
       AND NOT oc.has_declared_stake
       AND EXISTS (
         SELECT 1
           FROM person_role ptr
           JOIN person pe ON pe.person_id = ptr.person_id
           JOIN tr_name_fold_people f ON f.name_fold = pe.name_fold
          WHERE ptr.ref = oc.uic
            AND ptr.source IN ('tr','ngo')
            AND pe.status = 'active' AND pe.is_public_figure
            AND f.people_n > 1)
       AND NOT EXISTS (
         SELECT 1
           FROM person_role ptr
           JOIN person pe ON pe.person_id = ptr.person_id
           JOIN tr_name_fold_people f ON f.name_fold = pe.name_fold
          WHERE ptr.ref = oc.uic
            AND ptr.source IN ('tr','ngo')
            AND pe.status = 'active' AND pe.is_public_figure
            AND f.people_n = 1)`);
    assert.equal(
      r.shared,
      "0",
      "a company is published on a name the registry says belongs to more than one person",
    );
  },
);

test.skipIf(skip)(
  "has_current_role discriminates, so a withdrawn filing is not published present-tense",
  async () => {
    // 2,342 companies rest ENTIRELY on erased registry rows. Listing them is right — a former
    // directorship is a real fact — but listing them unlabelled is not, and /person already
    // renders the same pair as former via 150's erasedAt. The flag is only worth anything if
    // it is not constant, so both sides are asserted.
    const r = await one<{
      current: string;
      former: string;
      stake_only: string;
    }>(`
    SELECT count(*) FILTER (WHERE has_current_role)::text AS current,
           count(*) FILTER (WHERE has_registry_link AND NOT has_current_role)::text AS former,
           count(*) FILTER (WHERE NOT has_registry_link)::text AS stake_only
      FROM official_companies`);
    assert.ok(Number(r.current) > 0, "no company has a current role");
    assert.ok(
      Number(r.former) > 0,
      "no company is former-only — has_current_role has stopped discriminating, so the page " +
        "cannot tell a sitting officer from a withdrawn filing",
    );
    // A declared stake carries no erasure date, so a stake-only row must never claim currency.
    const [bad] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM official_companies
        WHERE NOT has_registry_link AND has_current_role`,
    );
    assert.equal(
      bad.n,
      "0",
      "a stake-only company claims a current role, which no filing can support",
    );
  },
);
