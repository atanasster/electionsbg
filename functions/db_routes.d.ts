// Types for the CJS shared /api/db route table (db_routes.js), so the dev Vite
// plugin (vite/db-api.ts) can import it type-safely. Runtime is plain JS shared
// with the Cloud Function.

export type DbRouteResult = { status?: number; body: unknown };

export type DbRouteFn = (
  dbRows: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>,
  query: Record<string, string>,
) => Promise<DbRouteResult>;

declare const dbRoutes: {
  DB_ROUTES: Record<string, DbRouteFn>;
};

export default dbRoutes;
