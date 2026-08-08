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
// The same URL parser + not-found body the Cloud Function uses for the /officials 301
// (T1.1). Production reaches that branch through an `/officials/*` hosting rewrite which
// does not exist yet (it lands with the prerender swap — see the branch's comment in
// functions/index.js); the dev server has no rewrite layer at all, so the middleware below
// is how the redirect is exercised until then.
import {
  officialsPath,
  NOT_FOUND_HTML,
} from "../functions/officials_redirect.js";
// Same again for the /person retired-slug 301. In production an `/person/*` hosting rewrite
// hands this to the Cloud Function; the dev server has no rewrite layer, so the middleware
// below mounts the same parser against the same SQL.
import {
  personPath,
  RETIRED_TARGET_SQL,
} from "../functions/person_redirect.js";

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

    // /officials/<slug> -> /person/<slug>, 301 (T1.1). In production the `/officials/*`
    // hosting rewrite hands this to the same Cloud Function that serves /api/db; the dev
    // server has no rewrite layer, so it is mounted here against the same parser and the
    // same SQL function. Without it the redirect could only be tested by deploying.
    //
    // Mounted on the whole server rather than under a prefix because Vite's `use(path, …)`
    // strips the prefix from req.url, and the parser needs the full path to tell
    // /officials from /en/officials.
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const hit = officialsPath(url.pathname);
      if (!hit) return next();
      const notFound = (): void => {
        // The same honest 404 as production: bouncing an unresolvable slug to a plausible
        // page would be a soft-404.
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(NOT_FOUND_HTML);
      };
      if (!hit.slug) return notFound();
      allRows<{ slug: string | null }>(
        "SELECT officials_person_slug($1) AS slug",
        [hit.slug],
      ).then(
        (rows) => {
          const target = rows[0]?.slug;
          if (!target) return notFound();
          res.statusCode = 301;
          // Query string carried over, as in production: ?elections= is real cross-page
          // state and ?utm_* is attribution.
          res.setHeader(
            "Location",
            `${hit.prefix}/person/${target}${url.search}`,
          );
          res.end();
        },
        // A dev database that has never had 106 applied should show the SPA, not a wall —
        // OfficialProfileScreen still exists until it is deleted alongside the rewrite.
        () => next(),
      );
    });

    // /person/<retired-slug> -> /person/<current-slug>, 301. Production reaches this through
    // the `/person/*` rewrite; here it is middleware for the same reason as above.
    //
    // Every non-redirect path calls next() and lets Vite serve the SPA — the dev-server
    // equivalent of the Cloud Function's "hand back the shell", and the reason this cannot
    // 404: a current slug, a legacy name link and a dead slug all still have to render.
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const hit = personPath(url.pathname);
      if (!hit || !hit.slug) return next();
      allRows<{ slug: string | null }>(RETIRED_TARGET_SQL, [hit.slug]).then(
        (rows) => {
          const target = rows[0]?.slug;
          if (!target) return next();
          res.statusCode = 301;
          // Query string carried over: ?elections= is real cross-page state, ?utm_* is
          // attribution.
          res.setHeader(
            "Location",
            `${hit.prefix}/person/${target}${url.search}`,
          );
          res.end();
        },
        // A dev database with no person_slug_retired table just shows the SPA.
        () => next(),
      );
    });
  },
});
