// Dev DB API. Mounts /api/db/* on the Vite dev server so the person/company/
// procurement pages query Postgres directly in dev — the SAME route table the
// production `db` Cloud Function serves (functions/db_routes.js), so dev == prod
// by construction. `apply: "serve"` + configureServer only → in production these
// routes are served by the function via the `/api/db/**` hosting rewrite, not
// this plugin.
//
// See docs/plans/postgres-migration-v1.md.

import type { Plugin } from "vite";
import { allRows, withReadOnlyTx } from "../scripts/db/lib/pg";
// Shared route table + server-side table engine, colocated with the Cloud
// Function so dev == prod. CJS default-import → the exports object.
import dbRoutes from "../functions/db_routes.js";
import type { DbRows } from "../functions/db_table";

const withHint = (msg: string): string =>
  /ECONNREFUSED|reachable|connect/i.test(msg)
    ? `${msg} — is Postgres up? run \`npm run db:pg:up\` + \`db:load:pg\` + \`db:load:tr:pg\`.`
    : msg;

type RouteResult = { status?: number; body: unknown };
type RouteFn = (
  q: (sql: string, params: unknown[]) => Promise<unknown[]>,
  query: Record<string, string>,
) => Promise<RouteResult>;

const DB_ROUTES = dbRoutes.DB_ROUTES as Record<string, RouteFn>;

export const dbApi = (): Plugin => ({
  name: "db-api-dev",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/api/db", (req, res) => {
      const send = (code: number, obj: unknown): void => {
        res.statusCode = code;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(obj));
      };
      const url = new URL(req.url ?? "/", "http://localhost");
      // Match the last path segment exactly, same as the Cloud Function.
      const seg = url.pathname.split("/").filter(Boolean).pop() ?? "";
      const route = DB_ROUTES[seg];
      if (!route) return send(404, { error: "unknown /api/db endpoint" });
      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => {
        query[k] = v;
      });
      // Pin the table engine's rows + aggregate queries to one READ ONLY snapshot.
      const q: DbRows = (sql, params) => allRows(sql, params);
      q.tx = (cb) => withReadOnlyTx(cb);
      route(q, query).then(
        ({ status = 200, body }) => send(status, body),
        (e: unknown) => send(400, { error: withHint((e as Error).message) }),
      );
    });
  },
});
