// Dev-only SQL browser backend. Mounts /api/sql/* on the Vite dev server so the
// /dev/sql page can run read-only queries against the Postgres source of truth
// (docs/plans/postgres-migration-v1.md) — contracts + tr_companies/tr_officers +
// contractor_search + the ingest tracking, all in one database, so cross-domain
// joins (contracts.contractor_eik = tr_companies.uic) are native.
//
// The DB never reaches the browser: the plugin runs the query in the Node dev
// process (via the shared pg pool) and returns JSON rows. `apply: "serve"` +
// configureServer only → absent from production builds and `vite preview`.
//
// Safety: every query runs inside BEGIN TRANSACTION READ ONLY (writes/DDL are
// rejected by Postgres) with a statement_timeout, and single SELECTs are capped
// server-side via a cursor so `SELECT * FROM tr_companies` can't pull 1M rows.
//
// Endpoints:
//   GET  /api/sql/schema  → schemas + tables (+ columns, indexes, est. row counts)
//   POST /api/sql/query  {sql, limit} → { columns, rows, rowCount, truncated, elapsedMs }

import type { Plugin } from "vite";
import { allRows, withClient, DATABASE_URL } from "../scripts/db/lib/pg";

const ROW_CAP_DEFAULT = 1000;
const ROW_CAP_MAX = 5000;
const STATEMENT_TIMEOUT = "20s";

interface ColumnInfo {
  name: string;
  type: string;
  pk: boolean;
  notnull: boolean;
  indexed: boolean;
}
interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}
interface TableInfo {
  db: string; // schema name
  table: string;
  /** Meaningless for views (no n_live_tup); an ESTIMATE otherwise. */
  rowCount: number;
  rowCountIsEstimate: boolean;
  kind: string;
  visibility: RelationVisibility;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
}

const dsnLabel = (): string => {
  try {
    const u = new URL(DATABASE_URL);
    return `postgres ${u.host}${u.pathname}`;
  } catch {
    return "postgres";
  }
};

// The SAME classification the deployed function uses (functions/sql_lib.js).
// This file used to carry a near-verbatim copy of readSchema under a "keep the
// two in sync" comment; sharing the catalog is what makes that true.
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);
const { classifyRelation, SCHEMA_SQL } = require_(
  "../functions/db_catalog.js",
) as {
  classifyRelation: (name: string, schema?: string) => RelationVisibility;
  SCHEMA_SQL: { tables: string; columns: string; primaryKeys: string };
};
type RelationVisibility = "data" | "derived" | "internal";

const readSchema = async (): Promise<unknown> => {
  const tables = await allRows<{
    schema: string;
    name: string;
    kind: string;
    est: string;
  }>(SCHEMA_SQL.tables);
  const cols = await allRows<{
    schema: string;
    tbl: string;
    col: string;
    typ: string;
    nullable: string;
  }>(SCHEMA_SQL.columns);
  const pks = await allRows<{ schema: string; tbl: string; col: string }>(
    SCHEMA_SQL.primaryKeys,
  );
  const idx = await allRows<{
    schema: string;
    tbl: string;
    idx: string;
    uniq: boolean;
    col: string;
  }>(
    `SELECT ns.nspname AS schema, t.relname AS tbl, i.relname AS idx,
            ix.indisunique AS uniq, a.attname AS col
     FROM pg_index ix
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_class t ON t.oid = ix.indrelid
     JOIN pg_namespace ns ON ns.oid = t.relnamespace
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
     WHERE ns.nspname NOT IN ('pg_catalog','information_schema')
     ORDER BY ns.nspname, t.relname, i.relname, a.attnum`,
  );

  const key = (s: string, t: string): string => `${s}.${t}`;
  const pkSet = new Set(pks.map((p) => `${key(p.schema, p.tbl)}.${p.col}`));
  const idxByTable = new Map<string, Map<string, IndexInfo>>();
  const indexedCols = new Map<string, Set<string>>();
  for (const r of idx) {
    const k = key(r.schema, r.tbl);
    if (!idxByTable.has(k)) idxByTable.set(k, new Map());
    const m = idxByTable.get(k)!;
    if (!m.has(r.idx))
      m.set(r.idx, { name: r.idx, unique: r.uniq, columns: [] });
    m.get(r.idx)!.columns.push(r.col);
    if (!indexedCols.has(k)) indexedCols.set(k, new Set());
    indexedCols.get(k)!.add(r.col);
  }
  const colsByTable = new Map<string, ColumnInfo[]>();
  for (const c of cols) {
    const k = key(c.schema, c.tbl);
    if (!colsByTable.has(k)) colsByTable.set(k, []);
    const pk = pkSet.has(`${k}.${c.col}`);
    colsByTable.get(k)!.push({
      name: c.col,
      type: c.typ,
      pk,
      notnull: c.nullable === "NO",
      indexed: pk || (indexedCols.get(k)?.has(c.col) ?? false),
    });
  }

  const tablesOut: TableInfo[] = tables.map((t) => {
    const k = key(t.schema, t.name);
    return {
      db: t.schema,
      table: t.name,
      rowCount: t.kind === "v" ? 0 : Number(t.est),
      rowCountIsEstimate: t.kind !== "v",
      kind: t.kind,
      visibility: classifyRelation(t.name, t.schema),
      columns: colsByTable.get(k) ?? [],
      indexes: [...(idxByTable.get(k)?.values() ?? [])],
    };
  });
  const schemas = [...new Set(tablesOut.map((t) => t.db))];
  return {
    databases: schemas.map((name) => ({ name, file: dsnLabel() })),
    tables: tablesOut,
  };
};

// Single SELECT-like statements are capped server-side via a cursor; EXPLAIN and
// multi-statement scripts run directly (then slice) — they don't buffer 1M rows.
const cursorable = (s: string): boolean =>
  !s.includes(";") && /^(select|with|table|values)\b/i.test(s);

const runQuery = async (sql: string, limit?: number): Promise<unknown> => {
  const cap = Math.min(
    Math.max(1, Number(limit) || ROW_CAP_DEFAULT),
    ROW_CAP_MAX,
  );
  const s = sql.trim().replace(/;+\s*$/, "");
  return withClient(async (c) => {
    const t0 = performance.now();
    await c.query("BEGIN TRANSACTION READ ONLY");
    await c.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    try {
      let rows: Array<Record<string, unknown>>;
      let columns: string[];
      let truncated: boolean;
      if (cursorable(s)) {
        await c.query(`DECLARE _b NO SCROLL CURSOR FOR ${s}`);
        const r = await c.query(`FETCH ${cap + 1} FROM _b`);
        truncated = r.rows.length > cap;
        rows = truncated ? r.rows.slice(0, cap) : r.rows;
        columns = r.fields.map((f) => f.name);
      } else {
        // A multi-statement script returns an array of results; take the last.
        type QR = {
          fields?: Array<{ name: string }>;
          rows?: Array<Record<string, unknown>>;
        };
        const res = (await c.query(sql)) as unknown as QR | QR[];
        const last = Array.isArray(res) ? res[res.length - 1] : res;
        const all = (last?.rows ?? []) as Array<Record<string, unknown>>;
        truncated = all.length > cap;
        rows = truncated ? all.slice(0, cap) : all;
        columns =
          last?.fields?.map((f) => f.name) ??
          (rows.length ? Object.keys(rows[0]) : []);
      }
      const elapsedMs = Math.round((performance.now() - t0) * 10) / 10;
      return { columns, rows, rowCount: rows.length, truncated, elapsedMs };
    } finally {
      await c.query("ROLLBACK");
    }
  });
};

// BigInt → string so JSON.stringify never throws (pg returns int8/numeric as
// strings already, but be safe).
const jsonReplacer = (_k: string, v: unknown): unknown =>
  typeof v === "bigint" ? v.toString() : v;

const withHint = (msg: string): string =>
  /ECONNREFUSED|reachable|connect/i.test(msg)
    ? `${msg} — is Postgres up? run \`npm run db:pg:up\` + \`db:load:pg\` + \`db:load:tr:pg\`.`
    : msg;

export const sqlBrowser = (): Plugin => ({
  name: "sql-browser-dev",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/api/sql", (req, res) => {
      const send = (code: number, obj: unknown): void => {
        res.statusCode = code;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(obj, jsonReplacer));
      };
      const fail = (e: unknown): void =>
        send(400, { error: withHint((e as Error).message) });
      const url = req.url ?? "/";
      if (req.method === "GET" && url.startsWith("/schema")) {
        readSchema().then((r) => send(200, r), fail);
        return;
      }
      if (req.method === "POST" && url.startsWith("/query")) {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          let sql: string | undefined;
          try {
            ({ sql } = JSON.parse(body || "{}") as { sql?: string });
          } catch (e) {
            return fail(e);
          }
          if (!sql || typeof sql !== "string")
            return send(400, { error: "missing `sql`" });
          const { limit } = JSON.parse(body || "{}") as { limit?: number };
          runQuery(sql, limit).then((r) => send(200, r), fail);
        });
        return;
      }
      send(404, { error: "unknown /api/sql endpoint" });
    });
  },
});
