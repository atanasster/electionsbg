// Everything downstream of `kzk_appeals.outcome`, refreshed in dependency order.
//
// ONE DEFINITION, because a writer that refreshes a SUBSET ships a stale
// leaderboard and nothing fails. That is not hypothetical: this module exists
// because kzk_rejoin.ts was written as a partial copy of the crawler's
// post-commit block and dropped the last two steps, leaving 289 of 1,164
// `awarder_risk_grade_ranking` rows with an `upheld_share` that disagreed with
// the `buyer_appeal_stats` the same run had just rebuilt — i.e. the served A–F
// leaderboard contradicting the live per-entity grade, which is exactly the
// regression scripts/db/lib/riskGradeScoped.ts was created to prevent.
//
// Three writers call this: the intake crawler (kzk_appeals.ts), the offline
// rejoin (kzk_rejoin.ts) and the decisions crawler (kzk_decisions.ts). Adding a
// dependent means editing this file, not three.
//
// Same precedent as scripts/db/lib/scopedMatviews.ts — "the refresh list lives in
// exactly one place".

import { exec, getPool, withClient } from "../db/lib/pg";

/**
 * Run a statement, skipping ONLY when its object's migration is absent on this
 * database (42P01 undefined_table, 42883 undefined_function).
 *
 * Any other error — permissions, disk, a real SQL fault — is rethrown. A blanket
 * `.catch()` here is how a stale matview ships silently.
 */
const tryExec = (sql: string): Promise<void | undefined> =>
  exec(sql).catch((e: unknown) => {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42P01" || code === "42883") return undefined;
    throw e;
  });

/**
 * Refresh every object derived from `kzk_appeals.outcome` / `.unp`.
 *
 * Order matters: `buyer_appeal_stats` is rebuilt from the appeals table, and both
 * `awarder_risk_grade_ranking` and `awarder_risk_grade_scoped` read *it*, so they
 * come last.
 */
export const refreshAppealDependents = async (): Promise<void> => {
  // Refresh planner stats for the rows just written, BEFORE the matviews read
  // them, rather than leaving it to autovacuum.
  //
  // 2026-07-10: minutes after an ingest ran against Cloud SQL,
  // /api/db/kzk-appeals-summary began 500ing — kzk_appeals_summary() (LEFT JOIN
  // kzk_appeals→tenders on unp) measured 113 s against a 20 s route timeout, and
  // `ANALYZE tenders; ANALYZE kzk_appeals;` restored it to 168 ms. Stale stats on
  // the tenders side is the leading explanation, but it did NOT reproduce
  // locally — treat that as a hypothesis, not a proven cause. Analyzing both is
  // cheap and keeps the pair consistent whichever loader ran last.
  await tryExec("ANALYZE kzk_appeals");
  await tryExec("ANALYZE tenders");

  // appealed_ocids → the contracts-browser appeal badge.
  // upheld_ocids   → the contract Corruption Risk Index's procedureAppealUpheld
  //                  flag. This is why a stale outcome arm is not cosmetic: it
  //                  makes recently-appealed procedures grade CLEANER than they
  //                  are, with nothing red anywhere.
  await tryExec("REFRESH MATERIALIZED VIEW appealed_ocids");
  await tryExec("REFRESH MATERIALIZED VIEW upheld_ocids");

  // The kzk-appeals-summary route serves this cache (044), not the live function,
  // to dodge the tenders-join plan blowup described above.
  await tryExec("REFRESH MATERIALIZED VIEW kzk_appeals_summary_cache");

  // The upheld-appeal component of the awarder A–F grade (041).
  await tryExec(
    `DELETE FROM buyer_appeal_stats;
     INSERT INTO buyer_appeal_stats (buyer_eik, decided, upheld)
       SELECT buyer_eik,
         count(*) FILTER (WHERE outcome IN ('уважена','отхвърлена')),
         count(*) FILTER (WHERE outcome = 'уважена')
       FROM kzk_appeals WHERE buyer_eik IS NOT NULL AND outcome IS NOT NULL
       GROUP BY buyer_eik`,
  );

  // The per-contract risk index (112) stores a bitmask per contract, and its
  // procedureAppealUpheld bit is read from upheld_ocids — so a rebuilt
  // upheld_ocids without this leaves every newly-upheld procedure's contracts
  // carrying a mask that says "clean". Caught by risk_parity.data.test.ts, which
  // compares the live TS computation against the stored mask: after the first
  // rejoin the TS side fired appealUpheld on a contract the cache still called
  // clean. The crawler never needed this because it only ever ADDED intake rows;
  // a rejoin moves outcomes, which is what reaches this cache.
  await tryExec("SELECT rebuild_contract_risk_cache()");

  // ⚠️ THE TWO STEPS A PARTIAL COPY DROPS. Both read buyer_appeal_stats, so
  // rebuilding it without them leaves the SERVED leaderboard disagreeing with the
  // per-entity grade computed live.
  await tryExec("REFRESH MATERIALIZED VIEW awarder_risk_grade_ranking");

  // Repopulate the per-scope leaderboard so it reflects the fresh stats —
  // otherwise it stays stale until the next contract load. Guarded on the 041
  // schema being present: to_regclass returns NULL (not an error) for a missing
  // table, so a thrown query here is a real PG fault and must surface.
  const hasScoped = await getPool()
    .query("SELECT to_regclass('public.awarder_risk_grade_scoped') AS t")
    .then((r) => r.rows[0]?.t != null);
  if (hasScoped) {
    const { rebuildRiskGradeScoped } =
      await import("../db/lib/riskGradeScoped");
    await withClient((c) => rebuildRiskGradeScoped(c));
  }
};
