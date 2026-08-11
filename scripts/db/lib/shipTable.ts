// Stream one table's rows from the LOCAL docker Postgres into the connected
// database (in practice the Cloud SQL proxy on :5434), without going through JS.
//
// WHY THIS EXISTS: several datasets are far cheaper to compute once on a
// dedicated local core than on a shared-core Cloud SQL instance, so the cloud
// side is populated by shipping the already-computed rows rather than
// recomputing them. That pattern was written out by hand in load_pg.ts
// (procurement_normalcy_cache) and again in load_tenders_pg.ts
// (tender_normalcy_cache) — the same COPY TO STDOUT → COPY FROM STDIN pipeline,
// the same emptiness guard, the same row-count verification. A third copy was
// about to be added for company_founded, so it lives here now instead.
//
// ⚠️ NOT a substitute for `db:sync:cloud` and not the reverse of it: this ships
// ONE table and never drops anything else. `db:sync:cloud` is a destructive
// pg_restore --clean over the whole database.
//
// ⚠️ The count check is load-bearing. A partial COPY (dropped connection, a
// proxy timeout) otherwise leaves the cloud table silently short, and a short
// enrichment table reads as "these companies have no data" rather than as an
// error — the same class of silent-wrong-answer the company_founded fetcher was
// hardened against.

import { Pool } from "pg";
import { pipeline } from "node:stream/promises";
import { from as copyFrom, to as copyTo } from "pg-copy-streams";
import {
  LOCAL_DATABASE_URL,
  withClient,
  getPool,
  isServingDatabase,
  vacuumAfterReload,
} from "./pg";

/** True when the database this process will ship INTO is the Cloud SQL proxy rather than
 *  local docker.
 *
 *  Delegates rather than re-testing the URL, so there is ONE definition of "serves
 *  production" (pg.ts's `isServingUrl`). Two things changed when it stopped being its own
 *  `/:5434\b/` regex over `process.env.DATABASE_URL`, and both are tightenings:
 *
 *  - it is now host+port, so a staging proxy on some other host at :5434 reads as NOT cloud.
 *    The cost of that is speed, never correctness — a false `false` runs the build SQL in
 *    place (slow on a shared core, ~40 min for procurement_normalcy_cache) instead of
 *    shipping, and every `:cloud` npm script spells the target 127.0.0.1:5434 anyway;
 *  - it now reads the connection `getPool()` will actually dial instead of the raw env var,
 *    which is the connection `shipTable` COPYs into. A process that called
 *    `pinLocalDatabase()` with a cloud DATABASE_URL in its shell used to read "cloud" here
 *    and would have shipped local into local. */
export const targetIsCloud = (): boolean => isServingDatabase();

/**
 * Copy every row of `table` from local Postgres into the connected database,
 * replacing what is there. Returns the number of rows shipped.
 *
 * Throws when the local table is empty (almost always "you forgot to build it
 * locally first", and shipping zero rows would quietly blank the cloud copy) or
 * when the destination count does not match the source count.
 */
// The TRUNCATE this helper issues, spelled out per table.
//
// Not a style choice: `person_reload_locks.data.test.ts` reads the person serving surface out
// of the SQL and forbids TRUNCATE on any table a person route serves — and its scanner matches
// table names STATICALLY, so a `TRUNCATE ${table}` names nothing it can see. A generic helper
// is the worst place for that, because one invisible writer covers every call site at once.
// Listing them keeps all three visible to the gate (none is on the person surface today, which
// is only knowable because they are visible), and adding a fourth is one line that the gate
// then checks. Also removes the last path by which an identifier could reach SQL unvalidated.
const TRUNCATE_SQL: Record<string, string> = {
  procurement_normalcy_cache: "TRUNCATE procurement_normalcy_cache",
  tender_normalcy_cache: "TRUNCATE tender_normalcy_cache",
  company_founded: "TRUNCATE company_founded",
};

export const shipTable = async (table: string): Promise<number> => {
  if (!/^[a-z_][a-z0-9_]*$/.test(table))
    throw new Error(`shipTable: unsafe table name ${JSON.stringify(table)}`);
  const truncate = TRUNCATE_SQL[table];
  if (!truncate)
    throw new Error(
      `shipTable: ${table} has no entry in TRUNCATE_SQL. Add one — ` +
        `person_reload_locks.data.test.ts cannot see an interpolated identifier, so a ` +
        `table shipped this way would never be checked against the person serving surface.`,
    );

  const src = new Pool({ connectionString: LOCAL_DATABASE_URL, max: 1 });
  try {
    const localCount = await src
      .query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)
      .then((r) => Number(r.rows[0]?.n ?? "0"));
    if (localCount === 0)
      throw new Error(
        `local ${table} is empty — build it locally before shipping to cloud`,
      );

    const srcClient = await src.connect();
    try {
      await withClient(async (dst) => {
        await dst.query(truncate);
        const reader = srcClient.query(copyTo(`COPY ${table} TO STDOUT`));
        const writer = dst.query(copyFrom(`COPY ${table} FROM STDIN`));
        await pipeline(reader, writer);
      });
    } finally {
      srcClient.release();
    }

    const dstCount = await getPool()
      .query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)
      .then((r) => Number(r.rows[0]?.n ?? "0"));
    if (dstCount !== localCount)
      throw new Error(
        `${table} ship mismatch: local ${localCount} → destination ${dstCount}`,
      );

    // The TRUNCATE above mints a new relfilenode and the COPY fills it, so the
    // DESTINATION's visibility map is empty and no index-only scan can be planned
    // there — see vacuumAfterReload for why autovacuum never repairs that.
    //
    // Here rather than in each caller, so a fourth TRUNCATE_SQL entry is covered by
    // construction. That was not academic: `procurement_normalcy_cache` and
    // `tender_normalcy_cache` were covered only because load_pg / load_tenders_pg
    // happen to vacuum them for their own reasons, while `company_founded` — shipped
    // by load_company_founded_pg, which has no such call — was not covered at all.
    // That gap is CLOUD-ONLY and structurally invisible to the local gate, because
    // the local `company_founded` is upserted rather than truncated (636/636 pages
    // marked), so the one database in the bad state is the one nothing tests.
    await vacuumAfterReload(table);

    console.log(`  ${table}: shipped ${dstCount} row(s) from local → cloud`);
    return dstCount;
  } finally {
    await src.end();
  }
};
