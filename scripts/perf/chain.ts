// Pure helpers for expanding a package.json `&&`-chain script into its links.
// Separate from run_chain.ts's CLI so they can be unit-tested without the CLI
// executing on import.

/**
 * Split on TOP-LEVEL `&&` only — a `&&` inside quotes belongs to the command
 * (gsutil's -x regexes and psql -c bodies both carry shell metacharacters, and
 * cutting one in half would run two broken commands).
 *
 * Refuses `||` and `;`: both change the abort semantics run_chain reproduces,
 * so splitting on them would run a chain that behaves differently from the one
 * `npm run` would have run. Refusing is the only safe answer — a chain runner
 * that silently changes semantics is worse than no chain runner.
 */
export const splitChain = (script: string): string[] => {
  const parts: string[] = [];
  let buf = "";
  let quote: string | null = null;
  for (let i = 0; i < script.length; i += 1) {
    const c = script[i];
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "&" && script[i + 1] === "&") {
      parts.push(buf.trim());
      buf = "";
      i += 1;
      continue;
    }
    if (c === "|" && script[i + 1] === "|")
      throw new Error(
        "chain contains a top-level `||` — refusing to reinterpret it",
      );
    if (c === ";")
      throw new Error(
        "chain contains a top-level `;` — refusing to reinterpret it",
      );
    buf += c;
  }
  parts.push(buf.trim());
  return parts.filter(Boolean);
};

/**
 * `npm run db:load:pg -- --full` → `db:load:pg -- --full`; anything else
 * verbatim. The ARGS stay in the name on purpose: `db:refresh` runs
 * `person:slug-redirects` twice with different files, and folding those onto
 * one name would average two different steps together.
 */
export const stepName = (link: string): string =>
  link.replace(/^npm run /, "").trim();
