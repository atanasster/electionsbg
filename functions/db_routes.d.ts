// Types for the CJS shared /api/db route table (db_routes.js), so the dev Vite
// plugin (vite/db-api.ts) can import it type-safely. Runtime is plain JS shared
// with the Cloud Function.

import type { DbRows } from "./db_table";

export type DbRouteResult = { status?: number; body: unknown };

// `dbRows` may optionally expose `tx(cb)` (see DbRows) so the table engine can
// pin its rows + aggregate queries to one READ ONLY-transaction snapshot.
export type DbRouteFn = (
  dbRows: DbRows,
  query: Record<string, string>,
) => Promise<DbRouteResult>;

declare const dbRoutes: {
  DB_ROUTES: Record<string, DbRouteFn>;
};

export default dbRoutes;
