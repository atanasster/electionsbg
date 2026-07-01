// Dev-only DB API. Mounts /__db/* on the Vite dev server so the DB-backed person
// page can query Postgres directly (contracts + TR + curated politician links) —
// the same seam a deployed Cloud Function would later fill. `apply: "serve"` +
// configureServer only → absent from production builds and `vite preview`.
//
// Endpoints (all read-only, via the shared pg pool):
//   GET /__db/person?name=…          → { name, profile[], politicians[] }
//   GET /__db/connection?a=…&b=…     → { shared[] }  (co-officership between names)
//   GET /__db/person-search?q=…      → { people[] }  (distinct officer-name matches)
//
// See docs/plans/postgres-migration-v1.md.

import type { Plugin } from "vite";
import { allRows } from "../scripts/db/lib/pg";

const withHint = (msg: string): string =>
  /ECONNREFUSED|reachable|connect/i.test(msg)
    ? `${msg} — is Postgres up? run \`npm run db:pg:up\` + \`db:load:pg\` + \`db:load:tr:pg\`.`
    : msg;

export const dbApi = (): Plugin => ({
  name: "db-api-dev",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/__db", (req, res) => {
      const send = (code: number, obj: unknown): void => {
        res.statusCode = code;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(obj));
      };
      const fail = (e: unknown): void =>
        send(400, { error: withHint((e as Error).message) });
      const url = new URL(req.url ?? "/", "http://localhost");
      const q = (k: string): string => (url.searchParams.get(k) ?? "").trim();

      if (url.pathname.startsWith("/person-search")) {
        const term = q("q");
        if (!term) return send(400, { error: "missing `q`" });
        // Distinct officer names matching (fuzzy), most-connected first.
        allRows(
          `SELECT o.name, count(DISTINCT o.uic) AS companies
           FROM tr_officers o
           WHERE o.name_fold %> translit_bg_latin($1)
             AND (SELECT bool_and(tok <% o.name_fold)
                  FROM unnest(string_to_array(translit_bg_latin($1),' ')) tok WHERE tok<>'')
           GROUP BY o.name
           ORDER BY companies DESC, length(o.name)
           LIMIT 50`,
          [term],
        ).then((people) => send(200, { people }), fail);
        return;
      }

      if (url.pathname.startsWith("/connection")) {
        const a = q("a");
        const b = q("b");
        if (!a || !b) return send(400, { error: "missing `a` or `b`" });
        allRows("SELECT * FROM connection_between($1,$2)", [a, b]).then(
          (shared) => send(200, { a, b, shared }),
          fail,
        );
        return;
      }

      if (url.pathname.startsWith("/person")) {
        const name = q("name");
        if (!name) return send(400, { error: "missing `name`" });
        Promise.all([
          allRows("SELECT * FROM person_roles($1)", [name]),
          allRows("SELECT * FROM person_politicians($1)", [name]),
        ]).then(
          ([roles, politicians]) => send(200, { name, roles, politicians }),
          fail,
        );
        return;
      }

      send(404, { error: "unknown /__db endpoint" });
    });
  },
});
