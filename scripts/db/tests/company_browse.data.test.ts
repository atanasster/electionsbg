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
import { readFileSync } from "node:fs";

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

// ---- every sortable NUMERIC column has an index the engine can actually walk ----------
//
// WHY THIS IS HERE AND NOT IN THE HOUSE-WIDE GATE. `db_table_sort_indexes.data.test.ts` catches
// an index whose NULLS ordering DISAGREES with what `buildOrder` emits. It cannot catch an index
// that is simply ABSENT: its catalog arm looks for a `DESC NULLS FIRST` key to complain about,
// and its plan arm EXPLAINs the ARRIVAL sort only — so a sortable column that is not the default
// sort and has no index at all is invisible to both.
//
// That is how `contract_count` shipped unindexed while its three siblings were covered: sorting
// „Поръчки" was a 23,578-buffer parallel seq scan against 5 for `person_count`.
//
// A blanket „every sortable column in the registry needs an index" arm is a different and much
// larger job — 187 columns declare `sort: true`, many on small or joined relations where a scan
// is the right plan. This gate is scoped to the four numeric columns of THIS page.
//
// ⚠️ THE ORDER BY IS COMPOSED THE WAY `buildOrder` COMPOSES IT, AND THE TIEBREAK IS THE PART
// THAT BITES. It appends exactly ONE tiebreak — `r.columns.key ? "key" : r.select[0]` — and
// `companies` declares no `key`, so it is `uic`, NOT `name, uic`. The first version of this gate
// spelled `, name, uic`, which is byte-identical to the index it was checking and therefore
// certified that index against itself; the engine's real sort left `uic` unsorted and degraded
// to an Incremental Sort. This is the mistake the house gate's header records ("THE ORDER BY
// MUST COME FROM THE ENGINE, NOT FROM THE TEST AUTHOR"), reached one tiebreak over.
//
// ⚠️ AND IT CHECKS A DEEP PAGE, because page 1 hides the defect this pair exists to prevent.
// The default view always sends `has_signal = true`; an index that does not lead with it still
// answers page 1 in 39 buffers while OFFSET 20000 reads 1,030,451 — worse than no index at all.

/** The numeric columns `/companies` lets a reader sort by, and the SQL each click produces.
 *
 *  ⚠️ A restatement of the registry, which is a drift risk — asserted non-empty below, and
 *  cross-checked against `functions/db_table.js` in the arm after it, so a column added there
 *  without an index cannot pass by simply not appearing here. */
const SORTABLE_NUMERIC = [
  "public_money_eur",
  "contractor_total_eur",
  "contract_count",
  "person_count",
] as const;

/** What `buildOrder` emits for a header click on `col`: the term, then ONE tiebreak. */
const arrivalOrder = (col: string) =>
  `ORDER BY ${col} DESC NULLS LAST, uic ASC`;

/** The page's two views. The default one is the whole point: `has_signal` is a client-side
 *  `extraFilters` entry, so it is in the WHERE of every query a reader makes without ticking
 *  „покажи всички" — and it rejects 90.3% of the corpus, which is what an index has to lead on
 *  to avoid re-reading the table. `showAll` sends no predicate and rides the plain half. */
const VIEWS = [
  ["default", "WHERE has_signal"],
  ["showAll", ""],
] as const;

/** Page 1 and a page a reader can actually reach — the default set is 98,737 rows at 25/page.
 *  ⚠️ THE DEEP PAGE IS THE ONE THAT DISCRIMINATES. Every shape measured here, correct and
 *  broken alike, is ~30 buffers on page 1; the broken ones only diverge with an OFFSET. */
const PAGES = [
  ["page 1", "LIMIT 25"],
  ["deep", "LIMIT 25 OFFSET 20000"],
] as const;

/** Max `shared hit + read` on any node of a plan. */
const maxBuffers = (plan: string) =>
  [...plan.matchAll(/Buffers: shared ([a-z=0-9 ]+)/g)]
    .map((m) =>
      [...m[1].matchAll(/(hit|read)=(\d+)/g)].reduce(
        (n, x) => n + Number(x[2]),
        0,
      ),
    )
    .reduce((a, b) => Math.max(a, b), 0);

test.skipIf(skip)(
  "every sortable numeric column on /companies is index-served, in both views and at depth",
  async () => {
    assert.ok(SORTABLE_NUMERIC.length >= 4, "the column list went empty");
    for (const col of SORTABLE_NUMERIC) {
      for (const [view, where] of VIEWS) {
        for (const [page, tail] of PAGES) {
          // ⚠️ EVERY ROW. `EXPLAIN (FORMAT TEXT)` returns the plan ONE LINE PER ROW, so reading
          // `[0]` yields „Limit (cost=…)" alone — which contains neither „Index Scan" nor „Seq
          // Scan", so one assertion fails on a good plan and the other passes on a bad one.
          const rows = await allRows<Record<string, string>>(
            `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT TEXT)
              SELECT uic, name FROM company_browse_table
              ${where} ${arrivalOrder(col)} ${tail}`,
          );
          const plan = rows.map((r) => Object.values(r).join("")).join("\n");
          const at = `${col} (${view}, ${page})`;
          assert.ok(
            /Index (Only )?Scan/.test(plan),
            `${at} is not index-served:\n${plan}`,
          );
          assert.ok(
            !/Seq Scan/.test(plan),
            `${at} falls back to a Seq Scan:\n${plan}`,
          );
          // ⚠️ A FULL `Sort` IS A FAILURE; an `Incremental Sort` IS NOT — the house gate's rule
          // (db_table_sort_indexes.data.test.ts), and it is right. Incremental means the leading
          // key WAS index-served and only the tiebreak remains, a sort within rows of equal
          // money that costs almost nothing; all four columns do it in the `showAll` view, where
          // the plain indexes carry `name` ahead of `uic`. A full Sort means the ordering was
          // not served at all — which is exactly what `person_count` did before its partner
          // existed, at 23,331 buffers.
          //
          // Anchored on the cost parenthetical every plan NODE carries, so it cannot fire on the
          // `Sort Key:` / `Sort Method:` DETAIL lines an Incremental Sort prints beneath itself.
          // A bare /\bSort\b/ matches those and fails on a column that was already correct.
          assert.ok(
            !/(^|\n)\s*(->\s+)?Sort\s+\(cost=/.test(plan),
            `${at} needs a full sort:\n${plan}`,
          );
          // ⚠️ THE CEILING IS THE ARM THAT CATCHES THE REAL DEFECT, and neither shape check
          // above can. An index that sorts correctly but does NOT lead with `has_signal` still
          // produces a clean „Index Scan" with no Sort node — it just reads the whole 1.02M-row
          // table and throws 90.3% away as a row Filter. Measured before the has_signal-leading
          // partners existed: contractor_total_eur 1,031,019 buffers at this depth and
          // contract_count 1,030,451, against 206 for the one column that had one.
          //
          // 60,000 is ~3x the measured 20,122 worst case — loose enough not to trip on planner
          // drift or a growing corpus, two orders of magnitude below the defect it catches.
          const buffers = maxBuffers(plan);
          assert.ok(
            buffers > 0 && buffers < 60_000,
            `${at} reads ${buffers} buffers — an index that sorts right but does not lead ` +
              `with has_signal re-reads the whole table:\n${plan}`,
          );
        }
      }
    }
  },
);

test.skipIf(skip)(
  "the SORTABLE_NUMERIC list still matches what the registry declares",
  async () => {
    // Closes the drift the list above admits to: a numeric column that GAINS `sort: true` in
    // db_table.js is a column a reader can make seq-scan the table, and the loop above would
    // simply not test it.
    const src = readFileSync("functions/db_table.js", "utf8");
    const start = src.indexOf('base: "company_browse_table"');
    assert.ok(start > 0, "could not find the companies resource");
    const block = src.slice(start, src.indexOf("\n  },\n", start));
    const declared = [
      ...block.matchAll(/^\s{6}(\w+): \{[^\n]*\n?[^\n]*sort: true/gm),
    ]
      .map((m) => m[1])
      .filter((c) => !["name", "uic", "entity_class"].includes(c));
    for (const col of declared)
      assert.ok(
        (SORTABLE_NUMERIC as readonly string[]).includes(col),
        `db_table.js declares ${col} sortable and this gate does not test it — add it to ` +
          "SORTABLE_NUMERIC and give it an index, or it can seq-scan 1.02M rows on a click",
      );
  },
);

test.skipIf(skip)(
  "every has_signal-leading sort index exists with the NULLS ordering buildOrder emits",
  async () => {
    // ⚠️ ANCHORED ON THE PARENS, so each shape pins the WHOLE column list. Unanchored,
    // `/contract_count DESC NULLS LAST, uic/` also matches the has_signal-leading definition,
    // and the plain index — the one `showAll` rides — could silently acquire a leading column
    // that makes it useless there while this arm stayed green.
    //
    // The catalog half. `DESC NULLS LAST` is not decoration: a plain DESC btree is NULLS FIRST,
    // Postgres compares pathkeys structurally and bridges neither direction, so a mismatched
    // index is not a candidate at all — the page silently returns to the seq scan with every
    // row and count still correct.
    for (const [name, shape] of [
      [
        "idx_company_browse_contracts_default",
        /\(has_signal, contract_count DESC NULLS LAST, uic\)/,
      ],
      [
        "idx_company_browse_contract_count",
        /\(contract_count DESC NULLS LAST, uic\)/,
      ],
      [
        "idx_company_browse_contractor_total_default",
        /\(has_signal, contractor_total_eur DESC NULLS LAST, uic\)/,
      ],
      [
        "idx_company_browse_person_count_default",
        /\(has_signal, person_count DESC NULLS LAST, uic\)/,
      ],
    ] as const) {
      const [row] = await allRows<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
          WHERE tablename = 'company_browse_table' AND indexname = $1`,
        [name],
      );
      assert.ok(
        row,
        `${name} is missing — apply 193_company_browse_sort_indexes.sql`,
      );
      assert.match(
        row.indexdef,
        shape,
        `${name} has the wrong shape: ${row.indexdef}`,
      );
    }
  },
);

// ── The premises the /companies SEARCH-FIRST rework rests on ──────────────────────────────
//
// docs/plans/companies-search-first-v1.md. Each of these is a claim the SERVING code makes and
// cannot check for itself: the KPI band withholds two cells because certain figures are
// tautologies, the money cell is safe to SUM, the „Вид" picker is coarse because `legal_form`
// is unusable, and `?obshtina` prints a raw code because Sofia has a fourth spelling. If 188's
// definition or the corpus moves under any of them, the page keeps publishing at a 200.

test.skipIf(skip)(
  "⚠️ each has_signal arm IMPLIES has_signal, at zero counterexamples",
  async () => {
    // WHAT THIS PROTECTS. `companiesKpiBasis` has no „С публична следа" cell precisely because
    // it would read 100% under ?political=1, ?contracts=1, ?money=1 and each NGO class — the
    // scope read back to the reader rather than a figure. That refusal is only correct while
    // these implications hold. Narrow `has_signal` in 188 and the band silently starts
    // withholding a cell that had become informative, with nothing else noticing.
    for (const [name, predicate] of [
      ["is_official_linked", "is_official_linked"],
      ["contract_count > 0", "contract_count > 0"],
      ["public_money_eur > 0", "public_money_eur > 0"],
      ["ngo_assoc", "entity_class = 'ngo_assoc'"],
      ["ngo_found", "entity_class = 'ngo_found'"],
      ["chitalishte", "entity_class = 'chitalishte'"],
    ] as const) {
      const r = await one<{ n: string; bad: string }>(
        `SELECT count(*)::text AS n,
                count(*) FILTER (WHERE NOT has_signal)::text AS bad
           FROM company_browse_table WHERE ${predicate}`,
      );
      // Non-vacuity first: an arm that matched nothing would satisfy the implication trivially.
      assert.ok(
        Number(r.n) > 0,
        `${name} matches no rows — the check is vacuous`,
      );
      assert.equal(
        r.bad,
        "0",
        `${r.bad} rows satisfy ${name} but NOT has_signal — the /companies KPI band's ` +
          `withholding rules assume this implication (plan §1.7)`,
      );
    }
  },
);

test.skipIf(skip)(
  "⚠️ the ONLY money outside has_signal is the two NEGATIVE rows, and the gap is exactly them",
  async () => {
    // The §2.1 money-sort property, and the reason the head's money cell may be a SUM at all.
    //
    // ⚠️ THE GAP IS NOT FLOAT NOISE, and calling it that was wrong. `has_signal` tests
    // `public_money_eur > 0`, so a company whose only public-money record is NEGATIVE is
    // HIDDEN — measured 2026-08-26, 4 rows carry negative money and 2 of them are hidden
    // (€−0.01 each; the other two are читалища at €−16.67 and €−598.83, which stay visible via
    // the linked arm). So the whole-table sum is exactly €0.02 BELOW the floored one, and that
    // is a fact about the corpus rather than an artifact of double precision.
    //
    // Asserted as an EQUALITY against the hidden arm rather than as a tolerance, because a
    // tolerance wide enough to swallow €0.02 also swallows any future hidden row up to that
    // size — and the failure that matters here is a POSITIVE-money row falling outside the
    // floor, which would mean the floor had stopped implying money and the „от целия регистър"
    // caption had started describing a smaller number.
    const r = await one<{
      all: string;
      sig: string;
      hidden: string;
      hidden_pos: string;
    }>(`
      SELECT sum(public_money_eur)::numeric::text AS all,
             (sum(public_money_eur) FILTER (WHERE has_signal))::numeric::text AS sig,
             (SELECT sum(public_money_eur)::numeric::text
                FROM company_browse_table WHERE NOT has_signal) AS hidden,
             (SELECT count(*)::text FROM company_browse_table
                WHERE NOT has_signal AND public_money_eur > 0) AS hidden_pos
        FROM company_browse_table`);
    assert.ok(
      Number(r.all) > 0,
      "no public money in the corpus — the check is vacuous",
    );
    // The load-bearing half: not one euro of POSITIVE money sits outside the floor.
    assert.equal(
      r.hidden_pos,
      "0",
      `${r.hidden_pos} rows hold positive public money and are hidden by the floor — the ` +
        `/companies money cell sums the whole table under a caption naming the active scope`,
    );
    // …and the whole-table sum is the floored one plus exactly the hidden (negative) residue.
    assert.ok(
      Math.abs(Number(r.all) - (Number(r.sig) + Number(r.hidden))) < 1e-6,
      `the sums do not reconcile: all ${r.all} vs signal ${r.sig} + hidden ${r.hidden}`,
    );
    assert.ok(
      Number(r.hidden) <= 0,
      `the hidden arm holds ${r.hidden} in public money — it is supposed to be negative-only`,
    );
  },
);

test.skipIf(skip)(
  "⚠️ legal_form still carries a DOUBLED vocabulary — the reason there is no picker for it",
  async () => {
    // ⚠️ INVERTED ON PURPOSE. This fails the day the TR ingest normalises the column, and that
    // failure MEANS „the §1.5 refusal can be revisited" — a decision nobody would otherwise
    // re-open. Roughly half the 41 values are Cyrillic labels for codes already in the list
    // (EOOD 677,498 beside „Еднолично дружество с ограничена отговорност" 52,498), so a picker
    // would offer both and silently lose the other; `entity_class` is the de-duplicated answer.
    const pairs = [
      ["EOOD", "Еднолично дружество с ограничена отговорност"],
      ["OOD", "Дружество с ограничена отговорност"],
      ["ASSOC", "Сдружение"],
      ["FOUND", "Фондация"],
    ] as const;
    let doubled = 0;
    for (const [code, label] of pairs) {
      const r = await one<{ c: string; l: string }>(
        `SELECT count(*) FILTER (WHERE legal_form = $1)::text AS c,
                count(*) FILTER (WHERE legal_form = $2)::text AS l
           FROM company_browse_table`,
        [code, label],
      );
      if (Number(r.c) > 0 && Number(r.l) > 0) doubled += 1;
    }
    assert.ok(
      doubled > 0,
      "legal_form no longer carries any code/label pair — the doubling that made a picker " +
        "unsafe is gone, so docs/plans/companies-search-first-v1.md §1.5 can be revisited",
    );
  },
);

test.skipIf(skip)(
  "⚠️ Sofia is SOF46 here and nothing else — the ?obshtina chip prints a raw code because of it",
  async () => {
    // THE FAILURE THAT LOOKS LIKE AN EMPTY RESULT RATHER THAN AN ERROR. `canonicalObshtina()`
    // maps the governance routes' `SOF00` to `SFO_CITY`, which `person_browse_table` speaks and
    // this corpus does not — so folding a `?obshtina` here filters the largest municipality in
    // the country to nothing, under a confident Bulgarian chip. It is one fold away from
    // happening the first time anyone builds a producer for this param.
    const r = await one<{ sof46: string; others: string; districts: string }>(`
      SELECT count(*) FILTER (WHERE obshtina_code = 'SOF46')::text AS sof46,
             count(*) FILTER (WHERE obshtina_code IN ('SOF00','SOF','SFO_CITY'))::text AS others,
             count(*) FILTER (WHERE obshtina_code LIKE 'S2%')::text AS districts
        FROM company_browse_table`);
    assert.ok(
      Number(r.sof46) > 100_000,
      `SOF46 holds ${r.sof46} rows — Sofia's spelling in this corpus has changed`,
    );
    assert.equal(
      r.others,
      "0",
      `${r.others} rows use SOF00/SOF/SFO_CITY — this corpus is supposed to speak only SOF46, ` +
        `and CompaniesActiveFilters prints the raw code on that basis`,
    );
    assert.equal(
      r.districts,
      "0",
      `${r.districts} rows carry an S2*** district code — tr_company_place folds Sofia's 24 ` +
        `rayoni into SOF46, unlike person_browse_table, which keeps them`,
    );
  },
);

test.skipIf(skip)(
  "⚠️ every EXAMPLE_TERMS chip on /companies returns rows",
  async () => {
    // The chips are the first thing a new reader clicks, and the constant's own contract is
    // that each returns rows. Only a PG gate can hold that — `companiesExamples.test.ts` runs
    // without Postgres and can check the SHAPE rules only (no quote, single token, one EIK).
    // Routed by shape exactly as db_table.js routes it: digits reach the exact `uic` arm,
    // everything else the transliterated name fold.
    const { EXAMPLE_TERMS } =
      await import("../../../src/screens/companies/companiesBrowseConstants");
    for (const term of EXAMPLE_TERMS) {
      const isEik = /^[0-9]{8,14}$/.test(term);
      const r = await one<{ n: string }>(
        isEik
          ? `SELECT count(*)::text AS n FROM company_browse_table WHERE uic = $1`
          : `SELECT count(*)::text AS n FROM company_browse_table
               WHERE name_fold LIKE '%' || translit_bg_latin($1) || '%'`,
        [term],
      );
      assert.ok(
        Number(r.n) > 0,
        `the example chip "${term}" returns NOTHING — a chip that answers with „няма ` +
          `резултати" is a worse introduction than no chip`,
      );
    }
  },
);
