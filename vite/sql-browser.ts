// Dev-only SQL browser backend. Mounts /__sql/* on the Vite dev server so the
// /dev/sql page can run read-only queries against the procurement source-of-
// truth SQLite (docs/plans/sql-migration-v1.md). It auto-discovers every
// *.sqlite under raw_data/ and ATTACHes them, so cross-domain joins work — most
// usefully procurement↔TR commerce registry
// (contracts.contractor_eik = tr.companies.uic / tr.company_persons.uic).
//
// The DB never reaches the browser: the plugin opens it in the Node dev process,
// runs the query, and returns JSON rows. `apply: "serve"` + configureServer only
// → absent from production builds and `vite preview`.
//
// Endpoints:
//   GET  /__sql/schema[?reopen=1]  → attached DBs + tables (+ columns, indexes, row counts)
//   POST /__sql/query  {sql, limit} → { columns, rows, rowCount, truncated, elapsedMs }

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Plugin } from "vite";

const REPO_ROOT = process.cwd();
const RAW_DIR = path.resolve(REPO_ROOT, "raw_data");
const PRIMARY_DB = path.resolve(RAW_DIR, "procurement/procurement.sqlite");

const ROW_CAP_DEFAULT = 1000;
const ROW_CAP_MAX = 5000;

let db: DatabaseSync | null = null;

// Every *.sqlite under raw_data/ (depth ≤ 2 — where the domain DBs live; avoids
// deep-walking the multi-GB raw tree). Skips WAL/shm/journal sidecars.
const discoverSqlite = (): string[] => {
  const out: string[] = [];
  if (!fs.existsSync(RAW_DIR)) return out;
  const scan = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name.endsWith(".sqlite")) out.push(p);
      else if (e.isDirectory() && depth > 0) scan(p, depth - 1);
    }
  };
  scan(RAW_DIR, 1);
  return out.sort();
};

// Stable, valid-identifier alias for an attached DB. tr/state.sqlite → "tr";
// generic basenames (state/db/data) fall back to the parent dir name.
const aliasFor = (p: string, used: Set<string>): string => {
  const base = path.basename(p, ".sqlite");
  const parent = path.basename(path.dirname(p));
  let a = /^(state|db|data)$/.test(base) ? parent : base;
  a = a
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^([0-9])/, "_$1");
  if (!a || a === "main" || a === "temp") a = "db";
  let cand = a;
  let i = 2;
  while (used.has(cand)) cand = `${a}_${i++}`;
  used.add(cand);
  return cand;
};

const openConnection = (): DatabaseSync => {
  if (!fs.existsSync(PRIMARY_DB)) {
    throw new Error(
      "procurement.sqlite not found — run `npm run db:load` first " +
        `(expected at ${path.relative(REPO_ROOT, PRIMARY_DB)}).`,
    );
  }
  const conn = new DatabaseSync(PRIMARY_DB, { readOnly: true });
  // Attach every OTHER discovered DB (before locking read-only), so cross-domain
  // joins are available. A failed attach (locked/corrupt) is skipped, not fatal.
  const used = new Set(["main", "temp"]);
  for (const p of discoverSqlite()) {
    if (path.resolve(p) === PRIMARY_DB) continue;
    const alias = aliasFor(p, used);
    try {
      conn.exec(`ATTACH DATABASE '${p.replace(/'/g, "''")}' AS ${alias}`);
    } catch {
      used.delete(alias);
    }
  }
  // Hard read-only: blocks INSERT/UPDATE/DELETE/DDL on every attached DB, so an
  // arbitrary pasted statement can never mutate anything.
  conn.exec("PRAGMA query_only = ON");
  return conn;
};

const getDb = (reopen = false): DatabaseSync => {
  if (reopen && db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    db = null;
  }
  if (!db) db = openConnection();
  return db;
};

const qi = (name: string): string => `"${String(name).replace(/"/g, '""')}"`;

interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}
interface ColumnInfo {
  name: string;
  type: string;
  pk: boolean;
  notnull: boolean;
  indexed: boolean;
}
interface TableInfo {
  db: string;
  table: string;
  rowCount: number;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
}

const readSchema = (reopen: boolean): unknown => {
  const conn = getDb(reopen);
  const databases = conn.prepare("PRAGMA database_list").all() as Array<{
    name: string;
    file: string;
  }>;
  const tables: TableInfo[] = [];
  for (const d of databases) {
    const names = conn
      .prepare(
        `SELECT name, type FROM ${qi(d.name)}.sqlite_master ` +
          `WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string; type: string }>;
    for (const t of names) {
      const cols = conn
        .prepare(`PRAGMA ${qi(d.name)}.table_info(${qi(t.name)})`)
        .all() as Array<{
        name: string;
        type: string;
        pk: number;
        notnull: number;
      }>;
      // Index list + which columns each covers.
      const idxRows = conn
        .prepare(`PRAGMA ${qi(d.name)}.index_list(${qi(t.name)})`)
        .all() as Array<{ name: string; unique: number }>;
      const indexes: IndexInfo[] = [];
      const indexedCols = new Set<string>();
      for (const ix of idxRows) {
        const info = conn
          .prepare(`PRAGMA ${qi(d.name)}.index_info(${qi(ix.name)})`)
          .all() as Array<{ name: string | null }>;
        const columns = info.map((r) => r.name).filter((n): n is string => !!n);
        columns.forEach((c) => indexedCols.add(c));
        indexes.push({ name: ix.name, unique: !!ix.unique, columns });
      }
      const { n } = conn
        .prepare(`SELECT COUNT(*) AS n FROM ${qi(d.name)}.${qi(t.name)}`)
        .get() as { n: number };
      tables.push({
        db: d.name,
        table: t.name,
        rowCount: n,
        columns: cols.map((c) => ({
          name: c.name,
          type: c.type,
          pk: !!c.pk,
          notnull: !!c.notnull,
          indexed: !!c.pk || indexedCols.has(c.name),
        })),
        indexes,
      });
    }
  }
  return {
    databases: databases.map((d) => ({
      name: d.name,
      file: d.file || "(memory)",
    })),
    tables,
  };
};

const runQuery = (sql: string, limit?: number): unknown => {
  const conn = getDb();
  const cap = Math.min(
    Math.max(1, Number(limit) || ROW_CAP_DEFAULT),
    ROW_CAP_MAX,
  );
  const stmt = conn.prepare(sql);
  const rows: Array<Record<string, unknown>> = [];
  let truncated = false;
  const t0 = performance.now();
  const iter = stmt.iterate() as IterableIterator<Record<string, unknown>>;
  for (const row of iter) {
    if (rows.length >= cap) {
      truncated = true;
      if (typeof iter.return === "function") iter.return();
      break;
    }
    rows.push(row);
  }
  const elapsedMs = Math.round((performance.now() - t0) * 10) / 10;
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns, rows, rowCount: rows.length, truncated, elapsedMs };
};

// BigInt (large INTEGER) → string so JSON.stringify never throws on it.
const jsonReplacer = (_k: string, v: unknown): unknown =>
  typeof v === "bigint" ? v.toString() : v;

export const sqlBrowser = (): Plugin => ({
  name: "sql-browser-dev",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/__sql", (req, res) => {
      const send = (code: number, obj: unknown): void => {
        res.statusCode = code;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(obj, jsonReplacer));
      };
      const url = req.url ?? "/";
      try {
        if (req.method === "GET" && url.startsWith("/schema")) {
          return send(200, readSchema(url.includes("reopen")));
        }
        if (req.method === "POST" && url.startsWith("/query")) {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const { sql, limit } = JSON.parse(body || "{}") as {
                sql?: string;
                limit?: number;
              };
              if (!sql || typeof sql !== "string")
                return send(400, { error: "missing `sql`" });
              send(200, runQuery(sql, limit));
            } catch (e) {
              send(400, { error: (e as Error).message });
            }
          });
          return;
        }
        send(404, { error: "unknown /__sql endpoint" });
      } catch (e) {
        send(400, { error: (e as Error).message });
      }
    });
  },
});
