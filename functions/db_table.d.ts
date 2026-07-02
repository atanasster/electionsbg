// Types for the CJS server-side table engine (db_table.js), so the dev Vite
// plugin (vite/db-api.ts) can import it type-safely. Runtime is plain JS shared
// with the Cloud Function.

export interface DbTableResult {
  rows: Record<string, unknown>[];
  total: number;
  totalExact: boolean;
  page: number;
  pageSize: number;
  aggregates: Record<string, number>;
}

declare const dbTable: {
  runDbTable: (
    q: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>,
    req: unknown,
  ) => Promise<DbTableResult>;
  REGISTRY: Record<string, unknown>;
};

export default dbTable;
