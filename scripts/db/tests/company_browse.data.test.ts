// Correctness gate for `company_browse_table` (188) — the relation behind /companies.
//
// Supersedes official_companies (178, now a tombstone): this matview widens 178's population
// (companies linked to a person in public life) to the FULL tr_companies corpus, carrying
// 178's old population as one filter column (`is_official_linked`) instead of a separate
// relation. Registry-consistency tests (does db_table.js's `companies` resource agree with
// this matview's actual columns) are added by the migration that registers that resource —
// this file only tests the matview against sources it is independently recomputable from.
//
// EXPECTATIONS ARE COMPUTED INDEPENDENTLY, in SQL that does not reuse the matview's own CTEs.
// A test that re-runs 188's query to check 188's output cannot fail.
//
// Auto-skips with a DISTINCT reason when the matview is absent or its inputs are unloaded —
// "the corpus is not built yet" must never read as "the rule holds".
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const reachable = async (): Promise<string | false> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.company_browse_table') IS NOT NULL AS ok",
    );
    if (!t?.ok)
      return "company_browse_table absent — apply 188 (npx tsx scripts/db/apply_functions.ts 188_company_browse.sql)";
    // NOT a skip: an empty matview is one of the states this file exists to catch, same
    // discipline as official_companies.data.test.ts before it.
    return false;
  } catch {
    return "Postgres unreachable";
  }
};

const skip = await reachable();
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  (await allRows<T>(sql, params))[0];

test.skipIf(skip)(
  "the population is the FULL tr_companies corpus, not a subset",
  async () => {
    const r = await one<{ mv: string; tr: string }>(`
    SELECT (SELECT count(*) FROM company_browse_table)::text AS mv,
           (SELECT count(*) FROM tr_companies)::text AS tr`);
    assert.ok(Number(r.mv) > 0, "company_browse_table is EMPTY");
    assert.equal(
      r.mv,
      r.tr,
      "company_browse_table has fewer (or more) rows than tr_companies — the LEFT JOIN " +
        "chain has narrowed the population (an INNER JOIN slipped in) or duplicated a row " +
        "(one of the joined arms is not one-row-per-uic)",
    );
  },
);

test.skipIf(skip)(
  "the uniqueness key holds, so a company can never be listed twice",
  async () => {
    const r = await one<{ dupes: string }>(
      "SELECT (count(*) - count(DISTINCT uic))::text AS dupes FROM company_browse_table",
    );
    assert.equal(r.dupes, "0");
  },
);

test.skipIf(skip)(
  "is_official_linked reproduces official_companies' old population exactly",
  async () => {
    // Same two arms 178 unioned, recomputed independently of company_browse_table's own CTEs.
    // A company_browse_table row is is_official_linked iff it would have been a row in the
    // retired official_companies matview.
    const r = await one<{ expected: string; missing: string; extra: string }>(`
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
    SELECT (SELECT count(*) FROM u)::text AS expected,
           (SELECT count(*) FROM (
              SELECT uic FROM u EXCEPT
              SELECT uic FROM company_browse_table WHERE is_official_linked) z)::text AS missing,
           (SELECT count(*) FROM (
              SELECT uic FROM company_browse_table WHERE is_official_linked EXCEPT
              SELECT uic FROM u) z)::text AS extra`);
    assert.equal(
      r.missing,
      "0",
      "companies the old two arms produce are missing is_official_linked=true",
    );
    assert.equal(
      r.extra,
      "0",
      "is_official_linked is true for companies the old two arms do not produce",
    );
    assert.ok(Number(r.expected) > 0, "the union of both arms is empty");
  },
);

test.skipIf(skip)(
  "person_count counts DISTINCT people, not arm memberships",
  async () => {
    // THE MUTATION CHECK. A person reached by BOTH arms is one person. Summing the arms
    // instead would inflate exactly the best-evidenced rows.
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
    SELECT (SELECT count(*) FROM company_browse_table cb
              JOIN distinct_people d ON d.uic = cb.uic
             WHERE cb.person_count <> d.n)::text AS mismatched,
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
  "has_current_role discriminates, so a withdrawn filing is not published present-tense",
  async () => {
    const r = await one<{ current: string; former: string }>(`
    SELECT count(*) FILTER (WHERE has_current_role)::text AS current,
           count(*) FILTER (WHERE has_registry_link AND NOT has_current_role)::text AS former
      FROM company_browse_table WHERE is_official_linked`);
    assert.ok(Number(r.current) > 0, "no company has a current role");
    assert.ok(
      Number(r.former) > 0,
      "no company is former-only — has_current_role has stopped discriminating",
    );
    const [bad] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM company_browse_table
        WHERE NOT has_registry_link AND has_current_role`,
    );
    assert.equal(
      bad.n,
      "0",
      "a stake-only company claims a current role, which no filing can support",
    );
  },
);

test.skipIf(skip)(
  "the fold gate is RE-CHECKED here, not inherited from resolve time",
  async () => {
    const r = await one<{ shared: string }>(`
    SELECT count(*)::text AS shared
      FROM company_browse_table cb
     WHERE cb.has_registry_link
       AND NOT cb.has_declared_stake
       AND EXISTS (
         SELECT 1
           FROM person_role ptr
           JOIN person pe ON pe.person_id = ptr.person_id
           JOIN tr_name_fold_people f ON f.name_fold = pe.name_fold
          WHERE ptr.ref = cb.uic
            AND ptr.source IN ('tr','ngo')
            AND pe.status = 'active' AND pe.is_public_figure
            AND f.people_n > 1)
       AND NOT EXISTS (
         SELECT 1
           FROM person_role ptr
           JOIN person pe ON pe.person_id = ptr.person_id
           JOIN tr_name_fold_people f ON f.name_fold = pe.name_fold
          WHERE ptr.ref = cb.uic
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
  "public_money_eur is 127's figure, and absent money is €0 rather than NULL",
  async () => {
    const r = await one<{ nulls: string; drift: string }>(`
    SELECT count(*) FILTER (WHERE public_money_eur IS NULL)::text AS nulls,
           (SELECT count(*) FROM company_browse_table cb
              JOIN company_public_money m ON m.eik = cb.uic
             WHERE cb.public_money_eur IS DISTINCT FROM COALESCE(m.public_money_eur, 0))::text
             AS drift
      FROM company_browse_table`);
    assert.equal(
      r.nulls,
      "0",
      "public_money_eur is NULL somewhere — it must be 0",
    );
    assert.equal(
      r.drift,
      "0",
      "public_money_eur has drifted from company_public_money (127)",
    );
  },
);

test.skipIf(skip)(
  "the contractor arm reads the corpus-wide (all-scope, all-division) row exactly",
  async () => {
    const r = await one<{ drift: string; nulls: string }>(`
    SELECT (SELECT count(*) FROM company_browse_table cb
              JOIN contractor_rank cr
                ON cr.eik = cb.uic AND cr.scope_key = 'all' AND cr.division = 'ALL'
             WHERE cb.contract_count <> COALESCE(cr.contract_count, 0)
                OR cb.contractor_total_eur IS DISTINCT FROM cr.total_eur)::text AS drift,
           (SELECT count(*) FROM company_browse_table WHERE contract_count IS NULL)::text
             AS nulls`);
    assert.equal(
      r.drift,
      "0",
      "contractor columns have drifted from contractor_rank (122)",
    );
    assert.equal(
      r.nulls,
      "0",
      "contract_count is NULL somewhere — it must be 0",
    );
  },
);

test.skipIf(skip)(
  "has_signal ORs its four conditions and is not constant in either direction",
  async () => {
    const r = await one<{
      total: string;
      signal: string;
      money_only: string;
      political_only: string;
      contract_only: string;
      wrong: string;
    }>(`
    SELECT count(*)::text AS total,
           count(*) FILTER (WHERE has_signal)::text AS signal,
           count(*) FILTER (WHERE has_signal AND public_money_eur = 0
                              AND NOT is_official_linked AND contract_count = 0
                              AND entity_class NOT IN ('ngo_assoc','ngo_found','chitalishte')
                            )::text AS wrong,
           count(*) FILTER (WHERE public_money_eur > 0 AND NOT has_signal)::text AS money_only,
           count(*) FILTER (WHERE is_official_linked AND NOT has_signal)::text AS political_only,
           count(*) FILTER (WHERE contract_count > 0 AND NOT has_signal)::text AS contract_only
      FROM company_browse_table`);
    assert.ok(Number(r.signal) > 0, "no company has a signal");
    assert.ok(
      Number(r.signal) < Number(r.total),
      "every company has a signal — has_signal has stopped narrowing anything",
    );
    assert.equal(
      r.wrong,
      "0",
      "has_signal is true for a company matching none of its four conditions",
    );
    assert.equal(
      r.money_only,
      "0",
      "a company with public money is not flagged has_signal — the OR has dropped an arm",
    );
    assert.equal(
      r.political_only,
      "0",
      "an officially-linked company is not flagged has_signal — the OR has dropped the political arm",
    );
    assert.equal(
      r.contract_only,
      "0",
      "a company with a contract is not flagged has_signal — the OR has dropped the contract arm",
    );
  },
);

test.skipIf(skip)(
  "entity_class NGOs are flagged has_signal even with no money or political link",
  async () => {
    const r = await one<{ n: string }>(`
    SELECT count(*)::text AS n FROM company_browse_table
     WHERE entity_class IN ('ngo_assoc','ngo_found','chitalishte') AND NOT has_signal`);
    assert.equal(
      r.n,
      "0",
      "an NGO/foundation/chitalishte is not flagged has_signal — the entity_class arm has broken",
    );
  },
);

test.skipIf(skip)(
  "place coverage matches tr_company_place exactly — never narrower, never wider",
  async () => {
    // 133 resolves a seat for a minority of the full corpus (unlike 178's officials-linked
    // population, where 133 covers the majority — see that file's retired note on this same
    // trap). This table must carry EXACTLY 133's placed set, neither dropping unplaced rows
    // nor inventing a place for one 133 does not have.
    const r = await one<{ mv: string; source: string }>(`
    SELECT (SELECT count(*) FROM company_browse_table WHERE oblast_name IS NOT NULL)::text AS mv,
           (SELECT count(*) FROM tr_company_place WHERE oblast IS NOT NULL)::text AS source`);
    assert.equal(
      r.mv,
      r.source,
      "the placed-row count disagrees with tr_company_place — a join has narrowed or widened it",
    );
    // The unplaced share must still be large — if it collapsed toward the full corpus, that is
    // itself evidence the join silently changed shape (e.g. degenerated to an inner join that
    // now happens to match everything).
    const [total] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM company_browse_table",
    );
    assert.ok(
      Number(total.n) - Number(r.mv) > 100000,
      "the unplaced population has collapsed — check the join",
    );
  },
);
