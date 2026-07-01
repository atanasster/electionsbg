// Postgres connection for the data pipeline. Local dev uses the Docker Compose
// Postgres (docker-compose.yml, host :5433); prod points DATABASE_URL at the
// deployed cloud Postgres (Cloud SQL / Neon) — same engine, same queries, so
// local === deployed. See docs/plans/postgres-migration-v1.md.

import { Pool, type PoolClient } from "pg";

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

export const end = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};
