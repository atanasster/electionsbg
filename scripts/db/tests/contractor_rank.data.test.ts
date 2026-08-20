// The per-scope contractor leaderboard precompute (migration 122).
//
// WHAT THESE PIN. contractor_rank + contractor_scope_kpis replace the top-1,000
// full-corpus blob /procurement/contractors used to ship. Like 119, this is DERIVED
// data: every failure mode is a number that is merely wrong, never an error. A broken
// GROUPING SETS rollup double-counts or drops billions; a numeric total_eur blanks
// every money cell; a stale KPI blob shows last month's concentration — all green.
//
// The reconciliation test is the important one: the 'all' scope must still agree,
// contractor for contractor, with the live contractor_ranks_windowed() function (the
// single source of the aggregation methodology). That chain is what lets the old blob
// path be retired.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM contractor_rank",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};
const ok = await reachable();

afterAll(async () => {
  await end();
});

test.skipIf(!ok)("every scope has a KPI row", async () => {
  // The 3 headline KPIs read this by scope_key. A scope in procurement_scopes that has
  // ranking rows but no KPI row renders blank tiles. (A scope may legitimately have NO
  // rows at all when its window predates the corpus — checked against contractor_rank,
  // not the raw scope list, exactly as 119 does.)
  const rows = await allRows<{ scope_key: string }>(`
    SELECT DISTINCT r.scope_key
      FROM contractor_rank r
     WHERE NOT EXISTS (SELECT 1 FROM contractor_scope_kpis k
                        WHERE k.scope_key = r.scope_key)
     ORDER BY 1`);
  assert.deepEqual(
    rows.map((r) => r.scope_key),
    [],
  );
});

test.skipIf(!ok)(
  "no malformed-CPV row leaked in as a division row",
  async () => {
    // The 'ALL' rollup absorbs null/malformed-CPV contracts; a per-division row must
    // always carry a real 2-digit division. A leak here means a bogus division bucket.
    const [r] = await allRows<{ n: string }>(`
      SELECT count(*) n FROM contractor_rank
       WHERE division <> 'ALL' AND division !~ '^[0-9]{2}$'`);
    assert.equal(r.n, "0");
  },
);

test.skipIf(!ok)(
  "the 'ALL' row is the true total, never the sum of division rows",
  async () => {
    // The header promise: 'ALL' is a super-aggregate computed independently, so it must
    // be >= the sum of the division rows (malformed-CPV contracts live only in 'ALL'),
    // never < it (which would be a double-count / wrong-grouping bug).
    //   - contract_count is INTEGER-exact and carries NO tolerance: 'ALL' counts every
    //     contract, division rows count only real-CPV ones, so 'ALL' >= Σdiv always.
    //   - total_eur carries a tolerance of the division COUNT: each division row is
    //     ROUNDed independently (≤0.5 EUR each), so Σ(rounded div) can exceed the single
    //     rounded 'ALL' total by up to n_div * 0.5 — pure rounding, not a rollup error
    //     (verified: eik 130570683 is 2 EUR over 7 divisions, counts exact).
    const bad = await allRows<{ scope_key: string; eik: string; why: string }>(`
      WITH div AS (
        SELECT scope_key, eik,
               SUM(total_eur) AS div_eur, SUM(contract_count) AS div_n,
               count(*) AS n_div
          FROM contractor_rank WHERE division <> 'ALL'
         GROUP BY scope_key, eik
      )
      SELECT a.scope_key, a.eik,
             format('all €%s vs Σdiv €%s (%s div), cnt %s vs %s',
               a.total_eur, div.div_eur, div.n_div, a.contract_count, div.div_n) AS why
        FROM contractor_rank a
        JOIN div ON div.scope_key = a.scope_key AND div.eik = a.eik
       WHERE a.division = 'ALL'
         AND (a.total_eur < div.div_eur - div.n_div OR a.contract_count < div.div_n)`);
    assert.deepEqual(
      bad.map((r) => `${r.scope_key}/${r.eik}: ${r.why}`),
      [],
      "an 'ALL' row is smaller than its own division rows — rollup is wrong",
    );
  },
);

test.skipIf(!ok)(
  "the KPI blob reconciles to the 'ALL' ranking rows",
  async () => {
    // contractor_scope_kpis is built FROM contractor_rank WHERE division='ALL'. If it
    // drifts (e.g. refreshed before the rank matview), the tiles disagree with the table.
    const bad = await allRows<{
      scope_key: string;
      why: string;
    }>(`
      SELECT k.scope_key,
             format('count %s vs %s, total %s vs %s',
               k.contractor_count, agg.n,
               ROUND(k.total_eur), ROUND(agg.eur)) AS why
        FROM contractor_scope_kpis k
        JOIN (
          SELECT scope_key, count(*) AS n, SUM(total_eur) AS eur
            FROM contractor_rank WHERE division = 'ALL'
           GROUP BY scope_key
        ) agg ON agg.scope_key = k.scope_key
       WHERE k.contractor_count <> agg.n
          OR ABS(k.total_eur - agg.eur) > GREATEST(1, agg.n)`);
    assert.deepEqual(
      bad.map((r) => `${r.scope_key}: ${r.why}`),
      [],
    );
  },
);

test.skipIf(!ok)("KPI shares stay within [0, 1]", async () => {
  // top10_share / mp_tied_share are fractions; a > 1 value means the numerator escaped
  // the denominator (e.g. an MP-tied filter counting rows outside the 'ALL' set).
  const rows = await allRows<{ scope_key: string }>(`
    SELECT scope_key FROM contractor_scope_kpis
     WHERE top10_share  < 0 OR top10_share  > 1
        OR mp_tied_share < 0 OR mp_tied_share > 1
     ORDER BY 1`);
  assert.deepEqual(
    rows.map((r) => r.scope_key),
    [],
  );
});

test.skipIf(!ok)(
  "matches the live function for the full corpus, row for row",
  async () => {
    // The end-to-end check against the ACTUAL source of truth: unnest
    // contractor_ranks_windowed(NULL, NULL) and diff it against the 'all' scope rows.
    // Everything else here is internal consistency; this is correctness.
    const [r] = await allRows<{ n: string }>(`
      WITH live AS (
        SELECT eik, division, name, total_eur, contract_count, award_count, is_mp_tied
          FROM contractor_ranks_windowed(NULL, NULL)
      ),
      cached AS (
        SELECT eik, division, name, total_eur, contract_count, award_count, is_mp_tied
          FROM contractor_rank WHERE scope_key = 'all'
      )
      SELECT count(*) n
        FROM live FULL OUTER JOIN cached USING (eik, division)
       WHERE live.eik IS NULL OR cached.eik IS NULL
          OR cached.name           IS DISTINCT FROM live.name
          OR cached.contract_count IS DISTINCT FROM live.contract_count
          OR cached.award_count    IS DISTINCT FROM live.award_count
          OR cached.is_mp_tied     IS DISTINCT FROM live.is_mp_tied
          -- total_eur is compared with a 1 EUR tolerance, NOT exactly: contracts.amount_eur
          -- is double precision, so a total straddling a .5 boundary flips by one euro
          -- between the matview snapshot and a fresh evaluation (same as 119).
          OR ABS(COALESCE(cached.total_eur, 0) - COALESCE(live.total_eur, 0)) > 1`);
    assert.equal(r.n, "0");
  },
);

test.skipIf(!ok)(
  "the search fold matches Latin input against Cyrillic names",
  async () => {
    // Shliokavica: the server-side replacement for the in-memory filter. Folded at write
    // time here and at query time in the table engine, both through translit_bg_latin —
    // which is also what makes the gin_trgm index usable.
    const rows = await allRows<{ name: string }>(`
      SELECT name FROM contractor_rank
       WHERE scope_key = 'all' AND division = 'ALL'
         AND name_fold LIKE '%' || translit_bg_latin('sofarma') || '%'
       ORDER BY total_eur DESC LIMIT 1`);
    assert.match(rows[0]?.name ?? "", /СОФАРМА/i);
  },
);

test.skipIf(!ok)("orders deterministically, with a tiebreak", async () => {
  // Equal-valued rows must not swap between pages mid-scroll. total_eur alone is not a
  // total order. Taken as OFFSET 0/50/100 slices under the exact ORDER BY the browser
  // sends (default scope+division), which is where a non-total order shows up.
  const paged = await allRows<{ eik: string }>(`
    SELECT eik FROM contractor_rank
     WHERE scope_key = 'all' AND division = 'ALL'
     ORDER BY total_eur DESC NULLS LAST, eik LIMIT 150`);
  const slices = await Promise.all(
    [0, 50, 100].map((off) =>
      allRows<{ eik: string }>(
        `SELECT eik FROM contractor_rank
          WHERE scope_key = 'all' AND division = 'ALL'
          ORDER BY total_eur DESC NULLS LAST, eik LIMIT 50 OFFSET ${off}`,
      ),
    ),
  );
  assert.deepEqual(
    slices.flat().map((r) => r.eik),
    paged.map((r) => r.eik),
    "paginating the ranking drops or repeats rows — the sort is not a total order",
  );
  // The index that serves the default sort carries the tiebreak — AND spells the sort the
  // way db_table.js's buildOrder spells it. `DESC` alone is `DESC NULLS FIRST`, which
  // Postgres will not use for the `DESC NULLS LAST` the engine emits, so this assertion
  // pinned the broken shape until 2026-08-20: it required exactly the spelling that made
  // the arrival a seq scan + top-N heapsort. The house-wide rule and the plan-level proof
  // live in scripts/db/tests/db_table_sort_indexes.data.test.ts.
  const [i] = await allRows<{ def: string }>(`
    SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'idx_contractor_rank_total'`);
  assert.match(i.def, /total_eur DESC NULLS LAST, eik/);
});
