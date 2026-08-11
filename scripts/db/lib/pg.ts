// Postgres connection for the data pipeline. Local dev uses the Docker Compose
// Postgres (docker-compose.yml, host :5433); prod points DATABASE_URL at the
// deployed cloud Postgres (Cloud SQL / Neon) — same engine, same queries, so
// local === deployed. See docs/plans/postgres-migration-v1.md.

import { Pool, type PoolClient } from "pg";
import { splitSqlStatements } from "./split_sql";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Point node-pg's .pgpass lookup at the repo-local .pgpass when the caller
// hasn't set PGPASSFILE. node-pg only consults it when a connection has NO inline
// password, so this is a no-op for the local default below (which carries its
// password inline) and only kicks in for a password-less DATABASE_URL — i.e. the
// Cloud SQL proxy target (db:dump:cloud), whose password lives in .pgpass. Keeps
// the cloud password out of source and out of argv.
const REPO_PGPASS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
  ".pgpass",
);
if (fs.existsSync(REPO_PGPASS) && !process.env.PGPASSFILE)
  process.env.PGPASSFILE = REPO_PGPASS;

// The docker-compose Postgres (password inline, works out of the box).
export const LOCAL_DATABASE_URL =
  "postgres://postgres:postgres@localhost:5433/electionsbg";

// Local dev = the docker-compose Postgres.
// Override DATABASE_URL to target the Cloud SQL proxy WITHOUT a password so the
// password is read from .pgpass, e.g.
//   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg   (see db:dump:cloud)
export const DATABASE_URL = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL;

// Explicit local override, wins over any ambient DATABASE_URL. Set by the AI
// harness (see ai/tools/dbFetcherNode.ts): the regression/tool harnesses are
// DEFINED to verify against the local docker Postgres, but a cloud DATABASE_URL
// left in the shell (from db:dump:cloud) is password-less and resolves its
// password from .pgpass — the CLOUD password — which fails auth against local
// PG and breaks the predeploy `ai:test`. Call pinLocalDatabase() before the
// first query to pin local regardless of the shell env.
let urlOverride: string | null = null;

export const pinLocalDatabase = (): void => {
  urlOverride = LOCAL_DATABASE_URL;
};

/** The URL getPool() will actually dial — `urlOverride` included. Anything deciding
 *  behaviour from "which database am I on" must read THIS, not DATABASE_URL: a process
 *  that called pinLocalDatabase() with a cloud DATABASE_URL in its shell reads local while
 *  DATABASE_URL still says cloud, and the two disagree for the whole run. */
export const connectionUrl = (): string => urlOverride ?? DATABASE_URL;

// The Cloud SQL proxy every `:cloud` script targets (see the package.json twins). Kept here
// so "is this the database that serves production" has one definition.
const CLOUD_SQL_PROXY_HOST = "127.0.0.1";
const CLOUD_SQL_PROXY_PORT = "5434";

/** True only when `url` names the Cloud SQL proxy — i.e. the database that SERVES production.
 *
 *  An ALLOWLIST on purpose: its callers gate writes to committed artifacts and prod-write
 *  warnings, so every unrecognised target (a second local instance, a staging proxy, a
 *  malformed URL) must read as "not serving". A denylist of the local URL would pass all three.
 *
 *  Takes a URL rather than reading the ambient connection because not every caller HAS an
 *  ambient connection: `sync_enrichment.ts` dials two databases at once and must ask about the
 *  one it is writing to. Before this existed that caller carried its own full-string equality
 *  check against a re-declared URL — the weakest of what were then four spellings of this
 *  question, and the one gating the only "you are about to write to prod" banner in a CLI whose
 *  target is a free-form flag. */
export const isServingUrl = (url: string): boolean => {
  try {
    const u = new URL(url);
    return (
      u.hostname === CLOUD_SQL_PROXY_HOST && u.port === CLOUD_SQL_PROXY_PORT
    );
  } catch {
    return false;
  }
};

/** The same question about the connection `getPool()` will actually dial — `urlOverride`
 *  included, so a process that called `pinLocalDatabase()` reads "not serving" even with a
 *  cloud DATABASE_URL in its shell. */
export const isServingDatabase = (): boolean => isServingUrl(connectionUrl());

let pool: Pool | null = null;

export const getPool = (): Pool => {
  if (!pool) {
    pool = new Pool({ connectionString: urlOverride ?? DATABASE_URL, max: 8 });
    // A Pool with no 'error' listener CRASHES the process ("Unhandled 'error'
    // event") when an IDLE backend connection drops — e.g. the Cloud SQL proxy
    // (:5434) or the server itself closing an idle connection mid-run. pg has
    // already removed the dead client from the pool by the time this fires, so
    // logging is all that's needed; the next checkout dials a fresh connection.
    // Without this, a transient drop during a long rebuild (rebuild_catalog /
    // build_payloads) takes the whole ingest down after the data already
    // committed.
    pool.on("error", (err) => {
      console.error(
        "[pg] idle client error (dropped, pool recovered):",
        err.message,
      );
    });
  }
  return pool;
};

// `exec` is the DDL applier (schema/pg/*.sql). pg_trgm's fuzzy-search functions
// (006_contractor_search.sql, 035_procurement_search.sql, …) carry per-function
// `SET pg_trgm.word_similarity_threshold` clauses. On Cloud SQL the `postgres`
// role is NOT a real superuser, so `CREATE FUNCTION … SET <pg_trgm.*>` is
// rejected ("permission denied to set parameter") when pg_trgm's C module has
// not been LOADED in that connection: until the module runs, the param is only
// an unrecognized custom *placeholder*, and storing a placeholder into a
// function's config (validate_option_array_item) is superuser-only. A plain
// `SET pg_trgm.x` does NOT load the module (it just sets the placeholder) —
// only calling a pg_trgm function does. So force-load the module on the SAME
// pinned connection, awaited, immediately before the DDL runs.
//
// This is DDL-only. Read-serving (allRows / withReadOnlyTx) needs no preload —
// the trigram operators auto-load the module on first use, and prod's own
// serving pool (functions/index.js) carries no such hook. Preloading here on a
// pinned client (not a fire-and-forget pool `connect` handler) also avoids the
// pg@8.22 "client is already executing a query" deprecation, which fired when
// the connect-time query and the caller's first query stacked on one client.
export const exec = async (sql: string): Promise<void> => {
  await withClient(async (c) => {
    await c.query("SELECT similarity('', '')");
    await c.query(sql);
  });
};

/**
 * Like `exec`, but runs each top-level statement as its OWN query.
 *
 * `exec` sends the file as one string, and the simple query protocol wraps a
 * multi-statement string in a SINGLE implicit transaction — so every lock is
 * held until the last statement commits. For DDL spanning two hot tables that
 * is a deadlock generator against a live database: on 2026-07-29
 * `db:load:tenders:pg:cloud` died with 40P01 because
 * 113_procurement_browser_covering_indexes.sql held AccessExclusive on
 * `contracts` (from its first DROP INDEX) across the whole contracts index
 * rebuild while reaching for `tenders`, and a prod session holding `tenders`
 * was waiting to read `contracts`.
 *
 * Statement-by-statement, each lock is taken and released on the spot. Use this
 * for idempotent DDL (CREATE/DROP … IF [NOT] EXISTS) where per-file atomicity
 * buys nothing; keep `exec` where the file must apply all-or-nothing.
 */
export const execEach = async (sql: string): Promise<void> => {
  const statements = splitSqlStatements(sql);
  await withClient(async (c) => {
    await c.query("SELECT similarity('', '')");
    for (const stmt of statements) await c.query(stmt);
  });
};

export const allRows = async <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> => (await getPool().query(sql, params)).rows as T[];

/**
 * Structural "is there a database at all" probe, for gates that must SKIP when
 * no server is reachable but FAIL on a reachable-but-broken install.
 *
 * Deliberately NOT an error-message regex. `database "x" does not exist` and
 * `relation "x" does not exist` differ by one noun, so any predicate loose
 * enough to catch the first tends to swallow the second — which is exactly how
 * the risk-parity gate came to print "skipped" against a fully loaded
 * 407,693-row corpus after 042's `DROP … CASCADE` removed a view it read. A
 * message match also stops working under a non-English `lc_messages`, and has to
 * be extended for every driver phrasing (`SASL: … client password must be a
 * string`, `no pg_hba.conf entry`, `EAI_AGAIN`, …).
 *
 * With this probe the boundary is positional instead of lexical: a throw HERE is
 * "no database", and every failure after it is a broken install that must
 * surface. That is what the `scripts/db/tests/*.data.test.ts` convention already
 * does with its `to_regclass` + row-count probes.
 *
 * @returns `true` when a trivial query round-trips, `false` on any failure.
 */
export const dbReachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    return true;
  } catch {
    return false;
  }
};

/**
 * Run `fn` with one pooled connection. On success the connection is recycled; on
 * ANY throw it is passed to `release(err)`, which **destroys** it instead of
 * returning it to the pool.
 *
 * That distinction is load-bearing. `pg` does not reset a connection on release:
 * a bare `c.release()` after a failed `BEGIN … COMMIT` hands the next caller a
 * connection with an aborted transaction still open, and a failed COPY leaves it
 * in copy-in mode, where even a subsequent ROLLBACK can fail. Destroying costs one
 * reconnect on an error path that is already exceptional.
 */
export const withClient = async <T>(
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> => {
  const c = await getPool().connect();
  try {
    const out = await fn(c);
    c.release();
    return out;
  } catch (e) {
    c.release(e instanceof Error ? e : new Error(String(e)));
    throw e;
  }
};

/**
 * Run `fn` inside a read-write transaction: BEGIN, then COMMIT on success or
 * ROLLBACK on throw. The write-side sibling of `withReadOnlyTx` below.
 *
 * The bulk loaders (load_pg / load_tenders_pg / load_tr_pg) each hand-rolled
 * BEGIN … COMMIT with no rollback path, so a mid-load failure left the connection
 * mid-transaction. `withClient` now destroys an errored connection regardless, but
 * an explicit ROLLBACK is cheaper than a reconnect and keeps the intent visible.
 */
export const withTx = async <T>(
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> =>
  withClient(async (c) => {
    await c.query("BEGIN");
    try {
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    }
  });

/**
 * Run `fn` with a query fn pinned to ONE pooled connection inside a READ ONLY
 * transaction, so every statement it issues shares a single MVCC snapshot. Wired
 * as `q.tx` for the /api/db table engine (functions/db_table.js) so a page of
 * rows and its count/aggregate totals stay consistent across a concurrent
 * ingest COMMIT. On any error the transaction is rolled back and the error
 * rethrown; the connection is always released (via withClient).
 */
export const withReadOnlyTx = async <T>(
  fn: (
    q: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>,
  ) => Promise<T>,
): Promise<T> =>
  withClient(async (c) => {
    await c.query("BEGIN TRANSACTION READ ONLY");
    try {
      const out = await fn((sql, params) =>
        c.query(sql, params).then((r) => r.rows as Record<string, unknown>[]),
      );
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    }
  });

/**
 * VACUUM (ANALYZE) tables that were just rebuilt by a single-transaction
 * `TRUNCATE` + `INSERT`/`COPY`. Call it AFTER the load's COMMIT — never inside
 * `withTx`, since VACUUM cannot run in a transaction block.
 *
 * This is not tidying, and autovacuum does NOT cover it. That reload shape
 * leaves `relallvisible = 0`: TRUNCATE mints a new relfilenode with an empty
 * visibility map, and every page is then written by a transaction that has not
 * committed yet, so nothing can be marked all-visible. The insert-threshold
 * autovacuum that fires afterwards runs mid-`db:refresh`, where a concurrent
 * loader step holds back the xmin horizon — so it marks NOTHING, resets
 * `n_ins_since_vacuum` to 0, and, with `n_dead_tup` also 0, never revisits the
 * table. The empty map is therefore PERMANENT, not a transient post-load state.
 *
 * The cost is that no index-only scan is possible on that table, ever. Measured
 * on `fund_projects` (82,011 rows / 8,780 pages), which `funds_fit_basis()`
 * counts on every /funds view: `count(*)` planned as a Seq Scan touching all
 * 8,780 pages instead of an Index Only Scan over the smallest index (78 pages,
 * `Heap Fetches: 0`) — 25 ms local, and prod is a db-g1-small reading cold over
 * the Cloud SQL proxy under a 10 s `statement_timeout`.
 *
 * Placement matters for the same reason autovacuum fails: run at the end of the
 * loader, so the horizon is current and the bits actually get set. `db:refresh`
 * chains its steps with `&&`, so nothing else of its own is in flight there.
 *
 * But "nothing else is in flight" is an ASSUMPTION, not a guarantee, and when it
 * is false this function is a silent no-op — it holds the same held-back-horizon
 * mechanism that defeats autovacuum, and VACUUM reports success either way.
 * Measured 2026-08-11 on a standalone `db:load:nzok-activities:pg`: a concurrent
 * `db:resolve:persons` had held one snapshot open for 15 minutes, the VACUUM ran
 * and stamped `last_vacuum`, `relallvisible` stayed 0, and the loader exited 0.
 * Cloud SQL is the case that matters — it serves live traffic continuously, so
 * there is always some chance a request's snapshot is older than the reload.
 *
 * So the map is READ BACK and a shortfall is reported, naming the oldest holder.
 * It WARNS rather than throws: this runs after the load has committed, the data
 * is correct, and the shortfall is repairable by re-running the VACUUM later —
 * aborting the loader here would turn a slow plan into a broken `db:refresh`
 * chain, which is the same trade `PARALLEL 0` below is making. The point is only
 * that it stops being invisible, which is the entire defect class.
 *
 * `PARALLEL 0` is not a tuning knob — it is what makes this callable at all on a
 * table with many indexes. Parallel vacuum allocates one DSM segment up front,
 * and the docker Postgres runs with the container default `/dev/shm` of 64 MB:
 * `VACUUM (ANALYZE) tenders` (14 indexes) died with `could not resize shared
 * memory segment … to 67145792 bytes: No space left on device`. That throw would
 * land AFTER the loader's COMMIT, which is the worst place for it — `db:refresh`
 * chains with `&&` and its only verification (`test:data`) is the LAST step, so
 * a post-commit abort publishes the corpus and leaves the whole suite unrun.
 *
 * Nothing is lost by disabling it. Parallelism in VACUUM covers the index-vacuum
 * phase only, and these tables were just rebuilt — `n_dead_tup = 0`, so there are
 * no dead index entries to reclaim and that phase has no work to do. Measured on
 * `tenders` (42,072 pages / 14 indexes): 2.5 s serial, against a default that
 * does not complete.
 */
export const vacuumAfterReload = async (
  ...tables: readonly string[]
): Promise<void> => {
  await withClient(async (c) => {
    for (const t of tables) {
      if (!/^[a-z_][a-z0-9_]*$/.test(t))
        throw new Error(
          `vacuumAfterReload: unsafe identifier ${JSON.stringify(t)}`,
        );
      await c.query(`VACUUM (ANALYZE, PARALLEL 0) ${t}`);
    }

    // Did it actually take? An empty table (relpages 0) has nothing to mark and
    // is not a shortfall. 90% rather than 100%: the final partly-filled page is
    // legitimately unmarked, so an exact compare would cry wolf on every table.
    const { rows: short } = await c.query<{
      relname: string;
      relpages: number;
      relallvisible: number;
    }>(
      `SELECT relname, relpages, relallvisible FROM pg_class
        WHERE relname = ANY($1) AND relpages > 0
          AND relallvisible < relpages * 0.9`,
      [tables],
    );
    if (short.length === 0) return;

    // Name the cause, not just the symptom — the fix is "re-run the VACUUM when
    // that transaction is gone", which is unguessable from a coverage number.
    const { rows: holder } = await c.query<{ pid: number; running: string }>(
      `SELECT pid, (now() - xact_start)::text AS running
         FROM pg_stat_activity
        WHERE backend_xmin IS NOT NULL AND pid <> pg_backend_pid()
        ORDER BY age(backend_xmin) DESC LIMIT 1`,
    );
    const because = holder[0]
      ? `pid ${holder[0].pid} has held a snapshot open for ${holder[0].running}`
      : "no snapshot holder is visible now, so this may be a transient race";
    console.warn(
      `[pg] VACUUM left the visibility map short on ` +
        short
          .map((r) => `${r.relname} (${r.relallvisible}/${r.relpages} pages)`)
          .join(", ") +
        ` — index-only scans stay unavailable there. Cause: ${because}. ` +
        `The load itself is fine; re-run \`VACUUM (ANALYZE) ${short
          .map((r) => r.relname)
          .join(", ")};\` once nothing long-running is in flight.`,
    );
  });
};

export const end = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};
