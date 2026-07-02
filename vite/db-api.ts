// Dev DB API. Mounts /api/db/* on the Vite dev server so the person/company
// pages query Postgres directly in dev — the SAME path + shapes the production
// `db` Cloud Function serves (functions/index.js), so dev == prod. `apply:
// "serve"` + configureServer only → in production these routes are served by the
// function via the `/api/db/**` hosting rewrite, not this plugin.
//
// Endpoints (all read-only, via the shared pg pool):
//   GET /api/db/person?name=…       → { name, roles[], politicians[] }
//   GET /api/db/company?eik=…       → { company, summary, officers[], politicians[] }
//   GET /api/db/connection?a=…&b=…  → { shared[] }  (co-officership between names)
//   GET /api/db/person-search?q=…   → { people[] }
//   GET /api/db/tenders?eik=…       → { summary, recent[] }  (per-buyer pipeline)
//   GET /api/db/tender?ocid=|unp=…  → { tender, awards[] }   (forecast vs actual)
//
// See docs/plans/postgres-migration-v1.md.

import type { Plugin } from "vite";
import { allRows } from "../scripts/db/lib/pg";
// Shared server-side table engine (registry + query builder), colocated with the
// Cloud Function so dev == prod. CJS default-import → the exports object.
import dbTable from "../functions/db_table.js";

const withHint = (msg: string): string =>
  /ECONNREFUSED|reachable|connect/i.test(msg)
    ? `${msg} — is Postgres up? run \`npm run db:pg:up\` + \`db:load:pg\` + \`db:load:tr:pg\`.`
    : msg;

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

      if (url.pathname.startsWith("/facets")) {
        let reqObj: unknown;
        try {
          reqObj = JSON.parse(q("q") || "{}");
        } catch {
          return send(400, { error: "bad `q`" });
        }
        dbTable
          .runDbFacets(
            (sql: string, params: unknown[]) => allRows(sql, params),
            reqObj,
          )
          .then((out: unknown) => send(200, out), fail);
        return;
      }

      if (url.pathname.startsWith("/table")) {
        let reqObj: unknown;
        try {
          reqObj = JSON.parse(q("q") || "{}");
        } catch {
          return send(400, { error: "bad `q` (expected URL-encoded JSON)" });
        }
        dbTable
          .runDbTable(
            (sql: string, params: unknown[]) => allRows(sql, params),
            reqObj,
          )
          .then((out: unknown) => send(200, out), fail);
        return;
      }

      if (url.pathname.startsWith("/tenders")) {
        const eik = q("eik");
        if (!eik) return send(400, { error: "missing `eik`" });
        const limit = Math.min(Math.max(Number(q("limit")) || 25, 1), 200);
        Promise.all([
          allRows("SELECT * FROM tenders_buyer_summary($1)", [eik]),
          allRows("SELECT * FROM tenders_by_buyer($1, $2)", [eik, limit]),
        ]).then(
          ([summary, recent]) =>
            send(200, { eik, summary: summary[0] ?? null, recent }),
          fail,
        );
        return;
      }

      if (url.pathname.startsWith("/tender")) {
        const ocid = q("ocid");
        const unp = q("unp");
        if (!ocid && !unp)
          return send(400, { error: "missing `ocid` or `unp`" });
        allRows(
          "SELECT * FROM tenders WHERE ($1 <> '' AND ocid = $1) OR ($2 <> '' AND unp = $2) LIMIT 1",
          [ocid, unp],
        ).then((rows) => {
          const tender = rows[0] ?? null;
          if (!tender) return send(200, { tender: null, awards: [] });
          allRows("SELECT * FROM tender_awards($1)", [tender.ocid ?? ""]).then(
            (awards) => send(200, { tender, awards }),
            fail,
          );
        }, fail);
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

      if (url.pathname.startsWith("/sector-peers")) {
        const division = q("division");
        const eik = q("eik");
        if (!division || !eik)
          return send(400, { error: "missing `division` or `eik`" });
        allRows<{ r: unknown }>("SELECT sector_peers($1,$2) AS r", [
          division,
          eik,
        ]).then(
          (rows) => send(200, rows[0]?.r ?? { division, peers: [] }),
          fail,
        );
        return;
      }

      if (url.pathname.startsWith("/procurement-overview")) {
        allRows<{ r: unknown }>("SELECT procurement_overview($1, $2) AS r", [
          q("from") || null,
          q("to") || null,
        ]).then((rows) => send(200, rows[0]?.r ?? null), fail);
        return;
      }

      if (url.pathname.startsWith("/company-search")) {
        const term = q("q");
        if (!term) return send(400, { error: "missing `q`" });
        // Any firm that signed a public contract (contractor_search covers
        // foreign contractors absent from TR); dedupe the several name variants
        // per eik to the best-matching one.
        allRows(
          `WITH s AS (SELECT * FROM search_contractors($1, 60))
           SELECT eik, name, contracts, contracts_eur AS "contractsEur"
           FROM (
             SELECT DISTINCT ON (eik) eik, name, contracts, contracts_eur, sim
             FROM s ORDER BY eik, sim DESC, length(name)
           ) d
           ORDER BY sim DESC, length(name), eik
           LIMIT 20`,
          [term],
        ).then((companies) => send(200, { companies }), fail);
        return;
      }

      if (url.pathname.startsWith("/company-connection")) {
        const eik = q("eik");
        const name = q("name");
        if (!eik || !name)
          return send(400, { error: "missing `eik` or `name`" });
        Promise.all([
          allRows<{ r: { direct?: unknown; shared?: unknown } }>(
            "SELECT company_connection($1,$2) AS r",
            [eik, name],
          ),
          allRows<{ r: unknown }>("SELECT company_person_path($1,$2,3) AS r", [
            eik,
            name,
          ]),
        ]).then(([conn, path]) => {
          const c = conn[0]?.r ?? { direct: [], shared: [] };
          send(200, {
            direct: c.direct ?? [],
            shared: c.shared ?? [],
            path: path[0]?.r ?? null,
          });
        }, fail);
        return;
      }

      if (url.pathname.startsWith("/company")) {
        const eik = q("eik");
        if (!eik) return send(400, { error: "missing `eik`" });
        Promise.all([
          allRows(
            "SELECT uic, name, legal_form, seat, status, funds_amount, funds_currency FROM tr_companies WHERE uic = $1",
            [eik],
          ),
          allRows(
            "SELECT count(*)::int AS contracts, coalesce(sum(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS contracts_eur FROM contracts WHERE contractor_eik = $1",
            [eik],
          ),
          allRows("SELECT * FROM company_officers($1)", [eik]),
          allRows(
            "SELECT politician, ref, kind, role, total_eur FROM company_politicians WHERE eik = $1 ORDER BY total_eur DESC NULLS LAST",
            [eik],
          ),
          allRows<{ r: unknown }>(
            "SELECT company_procurement($1, $2, $3) AS r",
            [eik, q("from") || null, q("to") || null],
          ),
          allRows("SELECT * FROM company_by_cabinet($1)", [eik]),
          allRows("SELECT * FROM company_debarred($1)", [eik]),
          allRows("SELECT * FROM fund_beneficiaries WHERE eik = $1", [eik]),
          allRows<{ r: unknown }>(
            "SELECT company_buyer_relationships($1) AS r",
            [eik],
          ),
          allRows<{ r: unknown }>("SELECT company_sectors($1) AS r", [eik]),
          allRows<{ r: unknown }>("SELECT company_related($1) AS r", [eik]),
          allRows<{ r: unknown }>("SELECT institution_identity($1) AS r", [
            eik,
          ]),
          allRows<{ r: unknown }>("SELECT company_geography($1) AS r", [eik]),
          allRows<{ r: unknown }>(
            "SELECT awarder_procurement($1, $2, $3) AS r",
            [eik, q("from") || null, q("to") || null],
          ),
          allRows(
            `SELECT contract_number, title, program_name, total_eur, paid_eur, status
             FROM fund_projects WHERE beneficiary_eik = $1
             ORDER BY total_eur DESC NULLS LAST LIMIT 6`,
            [eik],
          ),
        ]).then(
          ([
            company,
            summary,
            officers,
            politicians,
            procurement,
            cabinets,
            debarred,
            funds,
            relationships,
            sectors,
            related,
            institution,
            geography,
            awarderProcurement,
            fundProjects,
          ]) =>
            send(200, {
              eik,
              company: company[0] ?? null,
              summary: summary[0] ?? null,
              officers,
              politicians,
              procurement: procurement[0]?.r ?? null,
              cabinets,
              debarred,
              funds: funds[0] ?? null,
              relationships: relationships[0]?.r ?? null,
              sectors: sectors[0]?.r ?? null,
              related: related[0]?.r ?? null,
              institution: institution[0]?.r ?? null,
              geography: geography[0]?.r ?? null,
              awarderProcurement: awarderProcurement[0]?.r ?? null,
              fundProjects,
            }),
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
          allRows<{ r: unknown }>(
            "SELECT person_procurement($1, $2, $3) AS r",
            [name, q("from") || null, q("to") || null],
          ),
          allRows("SELECT * FROM person_by_cabinet($1)", [name]),
          allRows("SELECT * FROM person_associates($1)", [name]),
        ]).then(
          ([roles, politicians, procurement, cabinets, associates]) =>
            send(200, {
              name,
              roles,
              politicians,
              procurement: procurement[0]?.r ?? null,
              cabinets,
              associates,
            }),
          fail,
        );
        return;
      }

      send(404, { error: "unknown /api/db endpoint" });
    });
  },
});
