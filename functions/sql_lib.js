// Backend for the PUBLIC read-only SQL console (/api/sql, functions/index.js
// makeSql). Every query runs in a READ ONLY transaction with a statement_timeout
// and a server-side row cap (via cursor), so an arbitrary SELECT over the open
// data (TR + procurement) can't write, run forever, or return a million rows.
// Shares its catalogue query and relation classification with the dev server
// (vite/sql-browser.ts) through db_catalog.js, so the two cannot drift.

const NON_SYSTEM = "table_schema NOT IN ('pg_catalog','information_schema')";

// Schema tree for the explorer: user tables/views + columns, PKs, indexes,
// estimated row counts.
const { classifyRelation, SCHEMA_SQL } = require("./db_catalog");

async function readSchema(pool) {
  const q = (sql) => pool.query(sql).then((r) => r.rows);
  const tables = await q(SCHEMA_SQL.tables);
  const cols = await q(SCHEMA_SQL.columns);
  const pks = await q(SCHEMA_SQL.primaryKeys);
  const idx = await q(
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

  const key = (s, t) => `${s}.${t}`;
  const pkSet = new Set(pks.map((p) => `${key(p.schema, p.tbl)}.${p.col}`));
  const idxByTable = new Map();
  const indexedCols = new Map();
  for (const r of idx) {
    const k = key(r.schema, r.tbl);
    if (!idxByTable.has(k)) idxByTable.set(k, new Map());
    const m = idxByTable.get(k);
    if (!m.has(r.idx)) m.set(r.idx, { name: r.idx, unique: r.uniq, columns: [] });
    m.get(r.idx).columns.push(r.col);
    if (!indexedCols.has(k)) indexedCols.set(k, new Set());
    indexedCols.get(k).add(r.col);
  }
  const colsByTable = new Map();
  for (const c of cols) {
    const k = key(c.schema, c.tbl);
    if (!colsByTable.has(k)) colsByTable.set(k, []);
    const pk = pkSet.has(`${k}.${c.col}`);
    colsByTable.get(k).push({
      name: c.col,
      type: c.typ,
      pk,
      notnull: c.nullable === "NO",
      indexed: pk || (indexedCols.get(k)?.has(c.col) ?? false),
    });
  }
  const tablesOut = tables.map((t) => {
    const k = key(t.schema, t.name);
    return {
      db: t.schema,
      table: t.name,
      // Stays a NUMBER. A view has no n_live_tup, so 0 here is meaningless —
      // but emitting null would crash any already-deployed bundle calling
      // .toLocaleString() on it, and /db has no ErrorBoundary. `kind` is what
      // tells a caller not to render this; see rowCountIsEstimate too.
      rowCount: t.kind === "v" ? 0 : Number(t.est),
      // ⚠️ An ESTIMATE (n_live_tup), stale until autovacuum runs: a table
      // freshly loaded with 258 rows still reports 0. Never act on it.
      rowCountIsEstimate: t.kind !== "v",
      kind: t.kind,
      visibility: classifyRelation(t.name, t.schema),
      columns: colsByTable.get(k) ?? [],
      indexes: [...(idxByTable.get(k)?.values() ?? [])],
    };
  });
  const schemas = [...new Set(tablesOut.map((t) => t.db))];
  return {
    databases: schemas.map((name) => ({ name, file: "electionsbg" })),
    tables: tablesOut,
  };
}

// Single SELECT-like statements are capped server-side via a cursor; EXPLAIN /
// multi-statement scripts run directly then slice.
const cursorable = (s) =>
  !s.includes(";") && /^(select|with|table|values)\b/i.test(s);

async function runQuery(pool, sql, limit, opts) {
  const rowCapMax = opts?.rowCapMax ?? 2000;
  const timeout = opts?.statementTimeout ?? "8s";
  const cap = Math.min(Math.max(1, Number(limit) || 1000), rowCapMax);
  const s = String(sql || "").trim().replace(/;+\s*$/, "");
  if (!s) throw new Error("empty query");
  const client = await pool.connect();
  const t0 = Date.now();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      String(timeout),
    ]);
    let rows, columns, truncated;
    if (cursorable(s)) {
      await client.query(`DECLARE _b NO SCROLL CURSOR FOR ${s}`);
      const r = await client.query(`FETCH ${cap + 1} FROM _b`);
      truncated = r.rows.length > cap;
      rows = truncated ? r.rows.slice(0, cap) : r.rows;
      columns = r.fields.map((f) => f.name);
    } else {
      const res = await client.query(s);
      const last = Array.isArray(res) ? res[res.length - 1] : res;
      const all = last?.rows ?? [];
      truncated = all.length > cap;
      rows = truncated ? all.slice(0, cap) : all;
      columns =
        last?.fields?.map((f) => f.name) ??
        (rows.length ? Object.keys(rows[0]) : []);
    }
    return { columns, rows, rowCount: rows.length, truncated, elapsedMs: Date.now() - t0 };
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection may be dead after a timeout; releasing is enough */
    }
    client.release();
  }
}

module.exports = { readSchema, runQuery };
