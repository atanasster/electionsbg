// Shared lexical classification for the production and Vite SQL consoles.
// It recognizes top-level statement delimiters while ignoring comments and
// quoted text. PostgreSQL still enforces READ ONLY; this module decides only
// whether one read statement can use the server-side cursor row cap.

const WORD = /[A-Za-z0-9_$]/;
const SQL_LIMITS = Object.freeze({
  rowCapDefault: 1000,
  rowCapMax: 2000,
  statementTimeout: "8s",
});

function classifySql(input) {
  const sql = String(input ?? "");
  const statements = [];
  let start = 0;
  let firstKeyword = "";
  let hasCode = false;
  let mode = "normal";
  let blockDepth = 0;
  let dollarTag = "";
  let escapeString = false;

  const finish = (end) => {
    if (hasCode)
      statements.push({
        sql: sql.slice(start, end).trim(),
        firstKeyword,
      });
    start = end + 1;
    firstKeyword = "";
    hasCode = false;
  };

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (mode === "line-comment") {
      if (ch === "\n" || ch === "\r") mode = "normal";
      continue;
    }
    if (mode === "block-comment") {
      if (ch === "/" && next === "*") {
        blockDepth += 1;
        i += 1;
      } else if (ch === "*" && next === "/") {
        blockDepth -= 1;
        i += 1;
        if (blockDepth === 0) mode = "normal";
      }
      continue;
    }
    if (mode === "single-quote") {
      if (escapeString && ch === "\\") i += 1;
      else if (ch === "'" && next === "'") i += 1;
      else if (ch === "'") mode = "normal";
      continue;
    }
    if (mode === "double-quote") {
      if (ch === '"' && next === '"') i += 1;
      else if (ch === '"') mode = "normal";
      continue;
    }
    if (mode === "dollar-quote") {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length - 1;
        mode = "normal";
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      mode = "line-comment";
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      mode = "block-comment";
      blockDepth = 1;
      i += 1;
      continue;
    }
    if (ch === "'") {
      const ePrefix = /[eE]/.test(sql[i - 1] ?? "") &&
        !WORD.test(sql[i - 2] ?? "");
      const unicodePrefix = /[uU]/.test(sql[i - 2] ?? "") &&
        sql[i - 1] === "&" && !WORD.test(sql[i - 3] ?? "");
      escapeString = ePrefix || unicodePrefix;
      mode = "single-quote";
      hasCode = true;
      continue;
    }
    if (ch === '"') {
      mode = "double-quote";
      hasCode = true;
      continue;
    }
    if (ch === "$") {
      const tag = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        mode = "dollar-quote";
        dollarTag = tag;
        hasCode = true;
        i += tag.length - 1;
        continue;
      }
    }
    if (ch === ";") {
      finish(i);
      continue;
    }
    if (!/\s/.test(ch)) {
      hasCode = true;
      if (!firstKeyword && /[A-Za-z]/.test(ch)) {
        let end = i + 1;
        while (end < sql.length && WORD.test(sql[end])) end += 1;
        firstKeyword = sql.slice(i, end).toLowerCase();
        i = end - 1;
      }
    }
  }
  const complete = mode === "normal" || mode === "line-comment";
  finish(sql.length);

  const single = statements.length === 1 ? statements[0] : null;
  return {
    statements,
    statementCount: statements.length,
    firstKeyword: single?.firstKeyword ?? "",
    normalized: single?.sql ?? sql.trim(),
    complete,
    cursorable:
      complete &&
      !!single &&
      ["select", "with", "table", "values"].includes(single.firstKeyword),
  };
}

module.exports = { classifySql, SQL_LIMITS };
