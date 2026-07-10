// Postgres connection for the data pipeline. Local dev uses the Docker Compose
// Postgres (docker-compose.yml, host :5433); prod points DATABASE_URL at the
// deployed cloud Postgres (Cloud SQL / Neon) — same engine, same queries, so
// local === deployed. See docs/plans/postgres-migration-v1.md.

import { Pool, type PoolClient } from "pg";
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

let pool: Pool | null = null;

export const getPool = (): Pool => {
  if (!pool) {
    pool = new Pool({ connectionString: urlOverride ?? DATABASE_URL, max: 8 });
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

export const allRows = async <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> => (await getPool().query(sql, params)).rows as T[];

export const withClient = async <T>(
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> => {
  const c = await getPool().connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
};

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

export const end = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};
