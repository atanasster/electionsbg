// The ONE place a risk-cache rebuild is issued from TypeScript.
//
// WHY IT EXISTS: `rebuild_contract_risk_cache(text)` stamps `contract_risk_meta`
// with the flag-catalogue version the masks were computed under, because the
// methodology page invites a reader to cite "flag set vX.Y.Z" and the version in
// the BUNDLE is not evidence of what the SERVED masks were built from (112's
// header explains the window). The version therefore has to travel from
// `CATALOG_VERSION` into every rebuild — and there were three call sites before
// this file (load_pg.ts, refresh_risk.ts, kzk_dependents.ts), which is exactly
// the "someone missed one" shape the catalogue itself exists to end.
//
// ⚠️ THE FALLBACK IS NOT OPTIONAL, AND LEAVING IT OUT WAS A REAL BUG.
// The stamped overload only exists on databases that have the current 112, and
// `load_pg.ts` is 112's ONLY applier — so on Cloud SQL it is absent until a
// ~90-minute contracts reload or a hand-run apply_functions.ts. `kzk_dependents.ts`
// calls the rebuild through a `tryExec` that deliberately swallows 42883
// (undefined_function) to tolerate a database without the migration at all. Point
// that call at the stamped form with no fallback and the two combine into silence:
// the rebuild is SKIPPED on every `kzk:rejoin:cloud`, and the comment directly
// above that call site describes exactly what follows — every newly-upheld
// procedure's contracts keep a mask that says "clean".
//
// So the helpers below try the stamped form and fall back to the bare one on
// 42883. A database that has neither still raises, which is what lets a caller
// that genuinely tolerates a missing migration keep doing so.

import { CATALOG_VERSION } from "../../../src/lib/riskFlagCatalog";

/** Single-quote a SQL string literal (doubling any embedded quote).
 *
 *  `CATALOG_VERSION` is asserted to be semver by riskFlagCatalog.test.ts, so this
 *  is belt-and-braces — but the alternative is a call site that interpolates into
 *  SQL without one, and that is a pattern worth never establishing. Escaping here
 *  rather than parameterising because `exec()` (the DDL applier the contracts load
 *  uses) takes SQL only: it sends a file as one string over the simple query
 *  protocol, which carries no bind parameters at all. */
const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** The STAMPED rebuild. Records which catalogue version produced the masks. */
export const rebuildRiskCacheSql = (): string =>
  `SELECT rebuild_contract_risk_cache(${lit(CATALOG_VERSION)})`;

/** Advisory-lock key serialising concurrent risk-cache rebuilds. `112` is the migration.
 *
 *  WHY: `rebuild_contract_risk_cache()` DROPs and recreates `risk_upheld_ocid`, and it reads
 *  `is_direct_award()`. Three data-test sites touch exactly those objects — the two in
 *  contract_risk_meta (one RENAMEs `is_direct_award` inside a rolled-back transaction, one runs
 *  a real rebuild) and the one in contracts_list_grant (REVOKE + rebuild). Run in parallel they
 *  take the same catalog rows in different orders, and Postgres resolves that as `40P01`
 *  deadlock, `XX000 tuple concurrently updated`, or — when the loser is the slow real rebuild —
 *  a 120 s test timeout. Measured across five full `npm run test:data` runs: 1, 0, 2, 1 and 3
 *  failures, entirely from this one contention, while every affected file passed alone.
 *
 *  ⚠️ A RETRY IS NOT ENOUGH AND WAS TRIED FIRST. It only re-runs the loser, so under real
 *  contention all three shapes still get through — the run that produced 3 failures had the
 *  retry in place and fired it. Serialising is what removes the race rather than re-rolling it.
 *
 *  ⚠️ TAKE IT AS THE FIRST STATEMENT IN THE TRANSACTION, before any REVOKE, RENAME or rebuild.
 *  A lock taken after the contended object has already been locked reintroduces the ordering
 *  problem it exists to remove.
 *
 *  Transaction-scoped, so it is released by COMMIT or ROLLBACK and no test can leak it — which
 *  matters here because two of the three sites deliberately end in ROLLBACK.
 *
 *  This is test-only serialisation. Production has ONE rebuild caller per process
 *  (load_pg / refresh_risk / kzk_dependents) and a real lock order between them, so it is
 *  deliberately NOT taken there — doing so would hide a genuine production lock-order defect,
 *  which the retry note in contracts_list_grant is careful to keep visible.
 */
export const RISK_CACHE_LOCK_KEY = 112112112;

/** Serialise against every other risk-cache rebuild. Must run INSIDE a transaction. */
export const RISK_CACHE_LOCK_SQL = `SELECT pg_advisory_xact_lock(${RISK_CACHE_LOCK_KEY})`;

/** The bare, UNSTAMPED rebuild — the pre-T1.5 overload.
 *
 *  Reached only as a fallback on a database whose 112 predates the stamp. It
 *  rebuilds identically and leaves `catalog_version` NULL, which the methodology
 *  page renders as "not stamped": correct, since such a database genuinely cannot
 *  attribute its masks to a version. */
export const REBUILD_RISK_CACHE_BARE_SQL =
  "SELECT rebuild_contract_risk_cache()";

const isUndefinedFunction = (e: unknown): boolean =>
  (e as { code?: string } | null)?.code === "42883";

/**
 * Run a rebuild through the caller's own executor, stamped where possible.
 *
 * Takes the runner rather than opening a connection: the callers differ (a
 * pooled `exec` inside the contracts load's transaction, a one-shot query in a
 * refresh script), and a helper owning the connection could not run inside that
 * transaction — where the rebuild must be, so a failed load cannot leave the
 * cache describing a corpus that was rolled back.
 *
 * Returns which form actually ran, so a caller can report it.
 */
export const execRebuildRiskCache = async (
  run: (sql: string) => Promise<unknown>,
): Promise<"stamped" | "unstamped"> => {
  try {
    await run(rebuildRiskCacheSql());
    return "stamped";
  } catch (e) {
    if (!isUndefinedFunction(e)) throw e;
    await run(REBUILD_RISK_CACHE_BARE_SQL);
    return "unstamped";
  }
};

/**
 * Same fallback, for a caller that needs the row count back.
 *
 * `query` receives SQL returning a single `n` column and yields the rows.
 */
export const queryRebuildRiskCache = async (
  query: (sql: string) => Promise<{ n: string }[]>,
): Promise<{ rows: string | undefined; stamped: boolean }> => {
  try {
    const r = await query(
      `SELECT rebuild_contract_risk_cache(${lit(CATALOG_VERSION)})::text AS n`,
    );
    return { rows: r[0]?.n, stamped: true };
  } catch (e) {
    if (!isUndefinedFunction(e)) throw e;
    const r = await query("SELECT rebuild_contract_risk_cache()::text AS n");
    return { rows: r[0]?.n, stamped: false };
  }
};
