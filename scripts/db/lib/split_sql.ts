// Split a SQL script into top-level statements.
//
// Why this exists: `exec()` sends a whole file as ONE `client.query(sql)`. The
// simple query protocol wraps a multi-statement string in a SINGLE implicit
// transaction, so every lock the script takes is held until the LAST statement
// commits. For a pure-DDL file that touches two hot tables, that is a deadlock
// generator against a live database:
//
//   113_procurement_browser_covering_indexes.sql
//     DROP INDEX idx_contracts_tag_date     -- AccessExclusive on contracts …
//     CREATE INDEX … ON contracts (×3)      -- … still held, for the whole build
//     DROP INDEX idx_tenders_order          -- now wants AccessExclusive on tenders
//
// A concurrent prod session holding `tenders` and reading `contracts` closes the
// cycle; Postgres kills one side with 40P01. It happened on Cloud SQL on
// 2026-07-29 during db:load:tenders:pg:cloud.
//
// Run statement-by-statement instead and each lock is taken and released on the
// spot: the DROPs hold AccessExclusive only for their own duration, and
// CREATE INDEX takes ShareLock, which does not block readers at all. It also
// shrinks the window in which prod SELECTs on `contracts` are blocked from
// "the entire index rebuild" to "one DROP".
//
// Splitting SQL on `;` naively is wrong — semicolons appear inside string
// literals, dollar-quoted function bodies and comments. This handles all four
// so the helper is safe to point at any schema file, not just index DDL.

/** Split `sql` into statements on top-level semicolons. Blank/comment-only chunks are dropped. */
export const splitSqlStatements = (sql: string): string[] => {
  const out: string[] = [];
  let start = 0;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // -- line comment
    if (ch === "-" && next === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    // /* block comment */ — Postgres nests these.
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    // 'single-quoted' — '' is an escaped quote, not a terminator.
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") i += 2;
          else {
            i++;
            break;
          }
        } else i++;
      }
      continue;
    }
    // "quoted identifier" — "" is an escaped quote.
    if (ch === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') i += 2;
          else {
            i++;
            break;
          }
        } else i++;
      }
      continue;
    }
    // $tag$ dollar-quoted body $tag$ — the tag may be empty ($$) and is
    // matched verbatim, so $$ inside a $body$ block does not terminate it.
    if (ch === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? sql.length : end + tag.length;
        continue;
      }
    }
    if (ch === ";") {
      const stmt = sql.slice(start, i).trim();
      if (stmt) out.push(stmt);
      start = i + 1;
    }
    i++;
  }

  const tail = sql.slice(start).trim();
  if (tail) out.push(tail);
  // Drop chunks that are only comments/whitespace — they'd be a no-op round-trip.
  return out.filter((s) => stripComments(s).trim().length > 0);
};

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
