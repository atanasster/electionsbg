// Conservative PostgreSQL comment comparison. Quoted values (including dynamic
// SQL in dollar quotes) are opaque; only the outer SQL/PLpgSQL body is scanned.
// Keep whitespace/newlines: newline-separated SQL strings can concatenate, so
// collapsing whitespace would hide executable changes.
export function withoutSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const start = i;
    if (sql.startsWith("--", i)) {
      while (i < sql.length && sql[i] !== "\n" && sql[i] !== "\r") i++;
      out += " ";
    } else if (sql.startsWith("/*", i)) {
      i += 2;
      let depth = 1;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) return sql; // malformed input: never suppress drift
      out += " " + sql.slice(start, i).replace(/[^\r\n]/g, "");
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++];
      // Backslash escapes apply to E'...' strings, not ordinary SQL strings.
      const escaped =
        quote === "'" &&
        /[eE]/.test(sql[start - 1] ?? "") &&
        (start < 2 || !/[\w$]/.test(sql[start - 2]));
      while (i < sql.length) {
        if (escaped && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i++] === quote) {
          if (sql[i] === quote) i++;
          else break;
        }
      }
      out += sql.slice(start, i);
    } else {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      if (tag && (i === 0 || !/[\w$]/.test(sql[i - 1]))) {
        const end = sql.indexOf(tag, i + tag.length);
        if (end < 0) return sql;
        i = end + tag.length;
        out += sql.slice(start, i);
      } else out += sql[i++];
    }
  }
  return out;
}

export interface FunctionDefinition {
  def: string;
  body?: string | null;
  language?: string | null;
}

export function isCommentOnlyDrift(
  a: FunctionDefinition,
  b: FunctionDefinition,
): boolean {
  if (
    a.language !== b.language ||
    !["sql", "plpgsql"].includes(a.language ?? "")
  )
    return false;
  if (!a.body || !b.body || a.body === b.body) return false;
  // Require the entire surrounding definition to match too: volatility,
  // SECURITY DEFINER, SET options, arguments, etc. must still report drift.
  const envelope = (f: FunctionDefinition) => {
    const at = f.def.indexOf(f.body!);
    if (at < 0 || at !== f.def.lastIndexOf(f.body!)) return null;
    return [f.def.slice(0, at), f.def.slice(at + f.body!.length)];
  };
  const x = envelope(a),
    y = envelope(b);
  return (
    x !== null &&
    y !== null &&
    x[0] === y[0] &&
    x[1] === y[1] &&
    withoutSqlComments(a.body) === withoutSqlComments(b.body)
  );
}
