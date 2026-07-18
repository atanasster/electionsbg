// Backend for the PUBLIC read-only SQL console (/api/sql, functions/index.js
// makeSql). Every query runs in a READ ONLY transaction with a statement_timeout
// and a server-side row cap (via cursor), so an arbitrary SELECT over the open
// data (TR + procurement) can't write, run forever, or return a million rows.
// Mirrors vite/sql-browser.ts (the dev version) — keep the two in sync.

const NON_SYSTEM = "table_schema NOT IN ('pg_catalog','information_schema')";

// Schema tree for the explorer: user tables/views + columns, PKs, indexes,
// estimated row counts.
async function readSchema(pool) {
  const q = (sql) => pool.query(sql).then((r) => r.rows);
  const tables = await q(
    `SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind,
            COALESCE(st.n_live_tup, c.reltuples)::bigint AS est
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_stat_user_tables st ON st.relid = c.oid
     WHERE c.relkind IN ('r','v','m')
       AND n.nspname NOT IN ('pg_catalog','information_schema')
       AND n.nspname NOT LIKE 'pg_temp%'
     ORDER BY n.nspname, c.relname`,
  );
  const cols = await q(
    `SELECT table_schema AS schema, table_name AS tbl, column_name AS col,
            data_type AS typ, is_nullable AS nullable
     FROM information_schema.columns
     WHERE ${NON_SYSTEM}
     ORDER BY table_schema, table_name, ordinal_position`,
  );
  const pks = await q(
    `SELECT tc.table_schema AS schema, tc.table_name AS tbl,
            kcu.column_name AS col
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema NOT IN ('pg_catalog','information_schema')`,
  );
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
      rowCount: t.kind === "v" ? 0 : Number(t.est),
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
