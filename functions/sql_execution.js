// Shared execution core for the production function and Vite development
// adapter. Pool acquisition stays in each host; every SQL safety and result
// rule lives here so the two consoles cannot drift.

const { classifySql, SQL_LIMITS } = require("./sql_statement");

async function runWithClient(client, sql, limit, opts) {
  const rowCapMax = opts?.rowCapMax ?? SQL_LIMITS.rowCapMax;
  const timeout = opts?.statementTimeout ?? SQL_LIMITS.statementTimeout;
  const cap = Math.min(
    Math.max(1, Number(limit) || SQL_LIMITS.rowCapDefault),
    rowCapMax,
  );
  const classified = classifySql(sql);
  if (!classified.statementCount) throw new Error("empty query");
  if (!classified.complete) throw new Error("unterminated SQL quote or comment");
  const statement = classified.normalized;
  const t0 = Date.now();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      String(timeout),
    ]);
    let rows;
    let columns;
    let truncated;
    if (classified.cursorable) {
      await client.query(`DECLARE _b NO SCROLL CURSOR FOR ${statement}`);
      const result = await client.query(`FETCH ${cap + 1} FROM _b`);
      truncated = result.rows.length > cap;
      rows = truncated ? result.rows.slice(0, cap) : result.rows;
      columns = result.fields.map((field) => field.name);
    } else {
      const result = await client.query(statement);
      const last = Array.isArray(result) ? result[result.length - 1] : result;
      const all = last?.rows ?? [];
      truncated = all.length > cap;
      rows = truncated ? all.slice(0, cap) : all;
      columns =
        last?.fields?.map((field) => field.name) ??
        (rows.length ? Object.keys(rows[0]) : []);
    }
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated,
      elapsedMs: Date.now() - t0,
    };
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // A timeout can kill the connection; the host will release it.
    }
  }
}

module.exports = { runWithClient };
