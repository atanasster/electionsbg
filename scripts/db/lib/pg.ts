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
// Cloud SQL proxy target (db:push:cloud), whose password lives in .pgpass. Keeps
// the cloud password out of source and out of argv.
const REPO_PGPASS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
  ".pgpass",
);
if (fs.existsSync(REPO_PGPASS) && !process.env.PGPASSFILE)
  process.env.PGPASSFILE = REPO_PGPASS;

// Local dev = the docker-compose Postgres (password inline, works out of the box).
// Override DATABASE_URL to target the Cloud SQL proxy WITHOUT a password so the
// password is read from .pgpass, e.g.
//   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg   (see db:push:cloud)
export const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5433/electionsbg";

let pool: Pool | null = null;

export const getPool = (): Pool => {
  if (!pool) pool = new Pool({ connectionString: DATABASE_URL, max: 8 });
  return pool;
};

export const exec = async (sql: string): Promise<void> => {
  await getPool().query(sql);
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
