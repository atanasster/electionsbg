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

/** A connection URL safe to print: host, port, database and username kept, password dropped.
 *
 *  Lives HERE because this module owns connection URLs, and because it had grown three
 *  independent spellings across the repo with different failure modes — a `:[^:@/]*@` replace
 *  that leaves the password when it contains `/`, a `//[^@]*@` replace that also eats the
 *  username, and this `URL`-based one. Every CLI that prints which database it is about to
 *  write to was reaching for one of them, so the weakest copy decided whether a password
 *  reached a terminal. Returns a marker rather than the input on an unparseable URL — echoing
 *  it back is how a malformed string carrying a password gets printed verbatim. */
export const redactUrl = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username ? `${u.username}@` : ""}${u.host}${u.pathname}`;
  } catch {
    return "<unparseable url>";
  }
};

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
/** null = not yet probed. Cached per process, since the answer cannot change mid-run in any
 *  way that matters and this sits on the DDL path of every loader. */
let readonlyRolePresent: boolean | null = null;

/**
 * Warn ONCE per process when DDL grants to `app_readonly` on a cluster that has no such role.
 *
 * This exists because the guard sweep (docs/plans/grant-role-guard-sweep-v1.md) INVERTED the
 * failure mode it fixed. A bare `GRANT` on a roleless cluster raised 42704 and rolled its whole
 * migration back — destructive, but loud and impossible to miss. Now every guard simply skips:
 * the load SUCCEEDS, the objects are created with no ACL, and the first symptom is 42501 on a
 * serving endpoint against a corpus that looks perfectly loaded. Measured, isolated and rolled
 * back: with the role absent the DO block completes with no error and no ACL entry appears.
 *
 * `db:refresh` covers itself with an ORDER_PAIRS entry pinning `db:pg:bootstrap` in front of
 * `db:load:pg`. That mitigation does NOT reach two paths, which is why this lives here rather
 * than in a loader: `db:load:tr:pg` applies six guarded migrations and is a REFRESH_EXCLUSIONS
 * member run standalone by `tr:daily-refresh` and two watch skills; and every `:cloud` publish
 * is outside Tier 0 by design, since `bootstrap_roles.ts` refuses non-local targets and creating
 * a LOGIN role on the serving database stays the hand-run step roles_readonly.sql describes.
 *
 * On the DDL path rather than in each loader deliberately: a new loader cannot forget to call it.
 */
const warnIfGrantingToAbsentRole = async (
  c: PoolClient,
  sql: string,
): Promise<void> => {
  if (readonlyRolePresent !== null || !sql.includes("app_readonly")) return;
  const { rows } = await c.query(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') AS ok`,
  );
  readonlyRolePresent = rows[0].ok === true;
  if (readonlyRolePresent) return;
  console.warn(
    `[pg] app_readonly does not exist on ${redactUrl(connectionUrl())}, and this DDL grants to it.\n` +
      `     Every role guard will SKIP, so the objects are created with NO privileges and the\n` +
      `     load will report success — /api/db then fails with 42501 against a corpus that looks\n` +
      `     fully loaded. Fix: \`npm run db:pg:bootstrap\` (local), or apply\n` +
      `     scripts/db/schema/pg/roles_readonly.sql by hand (serving database), then re-run this loader.`,
  );
};

export const exec = async (sql: string): Promise<void> => {
  await withClient(async (c) => {
    await c.query("SELECT similarity('', '')");
    await warnIfGrantingToAbsentRole(c, sql);
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
    await warnIfGrantingToAbsentRole(c, sql);
    for (const stmt of statements) await c.query(stmt);
  });
};

/**
 * REFRESH a matview without blocking its readers, when that is possible.
 *
 * A plain `REFRESH MATERIALIZED VIEW` takes an AccessExclusiveLock for the whole rebuild, so
 * every reader of a SERVED matview is blocked — or, past the pool's statement_timeout, 500s —
 * for its full duration. `CONCURRENTLY` takes an ExclusiveLock instead and leaves SELECTs
 * running. It needs two things, and the second is the one that bites:
 *
 *   • a UNIQUE index on the matview — a permanent property of the migration that defines it;
 *   • the matview must ALREADY BE POPULATED. One created `WITH NO DATA` raises 55000
 *     (`object_not_in_prerequisite_state`) rather than returning zero rows, which is exactly
 *     the first-ever run on a cold database. So the populated state is PROBED, never assumed,
 *     and that one run pays the blocking refresh.
 *
 * Returns false when the matview does not exist — callers refresh objects owned by other
 * loaders' migrations, which may not have been applied yet, and a missing one is a skip.
 *
 * This exists because the rule was written out twice and then a third caller got it wrong:
 * `company_officer_counts` is on a serving path (`magistrate_politician_links()` in 071, and
 * 099), refreshed CONCURRENTLY by load_tr_pg and BLOCKINGLY by load_magistrates_pg. Same
 * matview, same readers, two answers.
 */
export const refreshMatviewConcurrently = async (
  name: string,
): Promise<boolean> => {
  const state = await getPool()
    .query(
      `SELECT c.relispopulated AS populated FROM pg_class c
        WHERE c.oid = to_regclass($1)`,
      [`public.${name}`],
    )
    .then((r) => r.rows[0] as { populated: boolean } | undefined)
    .catch(() => undefined);
  if (!state) return false;
  await exec(
    `REFRESH MATERIALIZED VIEW ${state.populated ? "CONCURRENTLY " : ""}${name}`,
  );
  return true;
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
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** The repair command, in ONE spelling. Exported because the runtime warning below, the
 *  `reload_visibility_map` gate's failure message and the CLAUDE.md runbook all quote it,
 *  and three hand-written copies had already drifted: `PARALLEL 0` — which this file
 *  documents as REQUIRED on the docker Postgres, whose 64 MB `/dev/shm` cannot fit the DSM
 *  segment a 14-index parallel vacuum asks for — was present in the prose and missing from
 *  every command. The warning was the sharpest case: it fires on the very machine where
 *  that ceiling was measured and handed the operator a command that dies there. */
export const vacuumRepairSql = (...tables: readonly string[]): string =>
  `VACUUM (ANALYZE, PARALLEL 0) ${tables.join(", ")};`;

/**
 * Is this table's visibility map short enough to mean "the map was never built"?
 *
 * ONE definition, shared by the post-vacuum read-back below and the
 * `reload_visibility_map` gate, so the loader's warning and the test cannot disagree
 * about what healthy looks like.
 *
 * The bar is deliberately low, because the defect is not a few percent of drift — it is
 * `relallvisible = 0`, every time. Two measurements set it:
 *
 * - **A ratio near 1.0 rejects healthy tables.** `contracts` is stage-MERGEd rather than
 *   truncated and is the standing proof that a map survives a reload — and under ordinary
 *   update churn it sits at 102,366/120,624 = **84.9%**. A 90% bar fires on it. So do
 *   `contract_first_seen` (74.5%) and `graph_company_node` (68.9%). A gate that cries wolf
 *   on a working table gets muted, which costs the whole file.
 * - **A pure ratio is TIGHTER than an exact compare on small tables.** The slack that is
 *   actually needed is the trailing partly-filled page — an absolute effect, one page. A
 *   10% ratio absorbs that only above 10 pages; at `relpages = 3` it demands 3 of 3.
 *
 * Hence the smaller of "all but two pages" and "half the table". Worked through:
 * 0/527 → short (the nzok defect state); 42,071/42,072 → fine (tenders, one trailing page);
 * 102,366/120,624 → fine (contracts); 2/3 → fine; 0/3 → short.
 *
 * Blind spot, stated rather than hidden: at `relpages <= 2` the absolute term goes to zero
 * or negative and nothing can ever be reported. That is intended — a one-page table is a
 * single heap read whether or not an index-only scan is available, so there is no cost to
 * detect. `nzok_activity_monthly` (1 page) lives there.
 */
export const visibilityMapShort = (
  relpages: number,
  relallvisible: number,
): boolean =>
  relpages > 0 && relallvisible < Math.min(relpages - 2, relpages * 0.5);

export const vacuumAfterReload = async (
  ...tables: readonly string[]
): Promise<void> => {
  // Validate the WHOLE list before issuing any VACUUM. Interleaved, a bad name in
  // position two would throw only after position one had already been vacuumed (2.5 s
  // on tenders), so a caller could not treat the throw as "nothing happened".
  for (const t of tables)
    if (!SAFE_IDENTIFIER.test(t))
      throw new Error(
        `vacuumAfterReload: unsafe identifier ${JSON.stringify(t)}`,
      );

  await withClient(async (c) => {
    for (const t of tables) await c.query(`VACUUM (ANALYZE, PARALLEL 0) ${t}`);

    // Did it actually take? Qualified by namespace and relkind: `relname` is unique only
    // per schema, and the VACUUMs above resolve through `search_path` — so an unqualified
    // read-back can measure a different relation than the one it just vacuumed and report
    // a shortfall that does not exist.
    const { rows } = await c.query<{
      relname: string;
      relpages: number;
      relallvisible: number;
    }>(
      `SELECT c.relname, c.relpages, c.relallvisible
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY(current_schemas(false))
          AND c.relkind IN ('r', 'm') AND c.relname = ANY($1)`,
      [tables],
    );
    const short = rows.filter((r) =>
      visibilityMapShort(r.relpages, r.relallvisible),
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
        `The load itself is fine; re-run \`${vacuumRepairSql(
          ...short.map((r) => r.relname),
        )}\` once nothing long-running is in flight.`,
    );
  });
};

/**
 * The size above which a table is NOT compacted. VACUUM FULL takes an
 * AccessExclusiveLock for the whole rewrite, so this cap is what keeps that lock
 * bounded — measured on the council tables at ~33 ms per MB (790 pages / 6.3 MB in
 * 210 ms), so 32 MB is about a second. Past it we warn and leave the slack: a
 * multi-second exclusive lock on a serving table is worse than the bloat it removes.
 */
export const COMPACT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Reclaim the heap slack a full-table rewrite leaves behind, then hand off to
 * `vacuumAfterReload`.
 *
 * WHY THIS EXISTS SEPARATELY FROM `vacuumAfterReload`. Plain VACUUM marks dead space
 * REUSABLE but never returns pages to the filesystem, so a loader whose merge rewrites
 * every row settles at ~2x its live size FOR EVER — stable, so no growth alarm ever
 * fires, and invisible to every row count. Measured on `council_resolution`: 224 pages
 * compacted, 439 after ONE ordinary `db:load:council:pg`, then 441 / 442 / 442 over
 * three more runs. The steady state is the defect. It cost `council_overview()` ~444
 * buffers of its 1,500 ceiling — the gate still passed, at 7% headroom.
 *
 * ⚠️ THE SECOND VACUUM IS MANDATORY AND IS THE WHOLE REASON THIS IS A HELPER. VACUUM
 * FULL rewrites the heap into a NEW relfilenode whose visibility map is EMPTY, so on its
 * own it trades bloat for the exact defect `visibilityMapShort` exists to catch: every
 * index-only scan silently degrades to a heap fetch. Measured, doing only the FULL:
 * `count(*) FROM council_vote` went 44 buffers -> 790, `council_overview()` 953 -> 2,502,
 * and `reload_visibility_map.data.test.ts` failed on both council tables. Compacting is
 * therefore never a bare `VACUUM FULL`; it is FULL followed by the plain VACUUM, which is
 * what `vacuumAfterReload` already does — including its read-back and its "who is holding
 * a snapshot open" diagnostic.
 *
 * Compaction is UNCONDITIONAL below the cap rather than gated on a bloat estimate. The
 * obvious gate — "did the heap grow this run?" — is precisely wrong here: at steady state
 * it does not grow (441 -> 442 -> 442), because the rewrite is reusing slack it already
 * owns, so the gate reads healthy on exactly the state worth fixing. Postgres exposes no
 * cheap exact bloat figure without pgstattuple, and an unconditional pass is self-limiting:
 * on an already-compact table there is little to copy (70 ms for council_resolution).
 */
export const compactAfterReload = async (
  ...tables: readonly string[]
): Promise<void> => {
  // Validate the WHOLE list up front, for the reason vacuumAfterReload gives: a bad name
  // in position two must not leave position one already rewritten.
  for (const t of tables)
    if (!SAFE_IDENTIFIER.test(t))
      throw new Error(
        `compactAfterReload: unsafe identifier ${JSON.stringify(t)}`,
      );

  await withClient(async (c) => {
    for (const t of tables) {
      // to_regclass, not a bare cast: an absent table is a skip, not a throw. Loaders
      // call this on tables a partial database may legitimately not have.
      const { rows } = await c.query<{ bytes: string | null }>(
        `SELECT pg_relation_size(to_regclass($1))::text AS bytes`,
        [t],
      );
      const bytes = Number(rows[0]?.bytes ?? 0);
      if (!Number.isFinite(bytes) || bytes === 0) continue;
      if (bytes > COMPACT_MAX_BYTES) {
        console.warn(
          `[pg] ${t} is ${(bytes / 1024 / 1024).toFixed(1)} MB — above the ` +
            `${COMPACT_MAX_BYTES / 1024 / 1024} MB compaction cap, so its heap slack is ` +
            `left in place rather than held under an AccessExclusiveLock to remove it.`,
        );
        continue;
      }
      await c.query(`VACUUM (FULL, ANALYZE) ${t}`);
    }
  });

  // NOT optional — see the header. The FULL above left every visibility map empty.
  await vacuumAfterReload(...tables);
};

export const end = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};
