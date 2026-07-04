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

export interface DbFacetsResult {
  facets: Record<string, { value: string; count: number }[]>;
}

// The caller's query fn. May optionally expose `tx(cb)` — runs `cb` with a query
// fn pinned to one READ ONLY-transaction snapshot, so runDbTable's rows +
// aggregate queries stay consistent across a concurrent ingest COMMIT.
export type DbRows = ((
  sql: string,
  params: unknown[],
) => Promise<Record<string, unknown>[]>) & {
  tx?: <T>(cb: (q: DbRows) => Promise<T>) => Promise<T>;
};

declare const dbTable: {
  runDbTable: (q: DbRows, req: unknown) => Promise<DbTableResult>;
  runDbFacets: (q: DbRows, req: unknown) => Promise<DbFacetsResult>;
  REGISTRY: Record<string, unknown>;
};

export default dbTable;
