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

/** One whitelisted column on a resource. `col` redirects a logical filter id to a
 *  different physical column; `search: true` enrols it in the global free-text OR.
 *
 *  A `filter: "semijoin"` column is VIRTUAL — it names no column of the base table, so
 *  it must never appear in `select`, `defaultSort`, or a facet request. It constrains
 *  `semiJoinCol` through `semiJoinSql`, a REGISTRY-owned subquery template carrying
 *  exactly one `?` into which the client's value is BOUND, never interpolated. */
export interface DbTableColumn {
  type: "text" | "int" | "number" | "bool";
  col?: string;
  sort?: boolean;
  filter?: string;
  /** Real base-table column a `semijoin` filter constrains. Must not be `viewOnly`:
   *  the aggregate query runs against `aggBase`, which lacks the view's columns. */
  semiJoinCol?: string;
  /** Subquery template with exactly one `?`. REGISTRY-owned — never request-derived. */
  semiJoinSql?: string;
  /** This filter is the caller's identity SCOPE, not a refinement: an absent value
   *  throws instead of widening the result to the whole corpus. */
  required?: boolean;
  search?: boolean;
  searchCol?: string;
  searchFold?: boolean;
  searchText?: boolean;
  facetExpr?: string;
}

export interface DbTableResource {
  base: string;
  scopeCols: string[];
  /** Applied by buildWhere when the caller sends no scope. Required for FAN-OUT bases
   *  (one row per entity per scope value), where the union of every bucket double-counts
   *  silently — see the mp_assets_rankings / mp_cars entries. */
  defaultScope?: { col: string; val: string };
  columns: Record<string, DbTableColumn>;
  select: string[];
  defaultSort?: [string, string][];
  aggregates?: { fn: string; col?: string }[];
  maxPageSize?: number;
}

/** The resource whitelist. Exported so a data test can check its column names against
 *  the live schema — db_table.test.js can only validate the registry against itself. */
export declare const REGISTRY: Record<string, DbTableResource>;

declare const dbTable: {
  runDbTable: (q: DbRows, req: unknown) => Promise<DbTableResult>;
  runDbFacets: (q: DbRows, req: unknown) => Promise<DbFacetsResult>;
  REGISTRY: Record<string, DbTableResource>;
};

export default dbTable;
