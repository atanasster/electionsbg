// The analysis behind `report_skip_coverage.test.ts` — docs/plans/data-gate-skip-visibility-v1.md §6.
//
// It lives in its own module so the rules can be exercised against SYNTHETIC sources in
// `skip_gate_scan.test.ts` rather than only against the repo. The first cut of the gate was
// verified by hand-editing real files and re-running it; that found two blind spots and
// missed three more, because a hand mutation only ever probes the shape you thought of.

/** A variable that decides whether a gate runs. */
export interface Gate {
  name: string;
  /** The declaration text, e.g. `const skip = !haveDb ? "…" : false;`. */
  decl: string;
  declStart: number;
  declEnd: number;
}

export type ViolationKind = "unreported" | "ordering" | "literal-label";

export interface Violation {
  kind: ViolationKind;
  gate: string;
}

/** Scan forward from `from` to the `)` closing the paren already opened. */
const closeParen = (src: string, from: number): number => {
  let depth = 1;
  let i = from;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") depth--;
  }
  return i - 1;
};

/** Scan forward to the `;` that ends a statement at paren/brace depth zero. */
const statementEnd = (src: string, from: number): number => {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === ";" && depth <= 0) return i + 1;
  }
  return src.length;
};

/**
 * Every gate variable declared in the source.
 *
 * ⚠️ ANCHORED ON THE DECLARATION, NOT ON HOW IT IS USED — plan §6 says so, and the first
 * implementation inverted it by indexing on `skipIf(name)`. That made it blind to two whole
 * families: the ~120 COMPOUND `skipIf(a || b)` sites, and the `const d = skip ? describe.skip
 * : describe` form used by `aop_experts` and `isun_clean_delivery`, which contain no `skipIf(`
 * at all — so deleting their report went undetected by the gate meant to protect them.
 *
 * ⚠️ NOT COLUMN-ANCHORED either. `^(?:const|let)` dropped every INDENTED declaration with no
 * signal, and `scripts/parsers_local/local_bundles.data.test.ts` was live proof: a real
 * three-way reason, declared inside a `describe`, reported nowhere, invisible.
 */
export const gatesOf = (src: string): Gate[] => {
  const out: Gate[] = [];
  const re = /(?:^|[\s;{}()])(?:const|let)\s+(\w*[Ss]kip\w*)\s*(?::[^=;]*)?=/g;
  for (const m of src.matchAll(re)) {
    const name = m[1];
    if (name === "skipIf") continue;
    const start = m.index ?? 0;
    const declEnd = statementEnd(src, start);
    out.push({
      name,
      decl: src.slice(start, declEnd),
      declStart: start,
      declEnd,
    });
  }
  return out;
};

/** The argument list of every `reportSkip(...)` call, with its offset. */
export const reportCalls = (src: string): { index: number; args: string }[] => {
  const out: { index: number; args: string }[] = [];
  for (const m of src.matchAll(/\breportSkip\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length;
    out.push({
      index: m.index ?? 0,
      args: src.slice(open, closeParen(src, open)),
    });
  }
  return out;
};

/**
 * Does this gate ever hold a REASON rather than a bare boolean (plan §7, Tier 3)?
 *
 * ⚠️ THE DECLARATION ALONE IS NOT ENOUGH, and judging on it made the first cut exempt the
 * very file the gate was written about: `contractor_search_arms` declares
 * `let skip: string | false = false` — no string LITERAL — and fills the reasons below.
 */
export const carriesReason = (src: string, g: Gate): boolean => {
  const hasString = (s: string) =>
    s.includes('"') || s.includes("`") || s.includes("'");
  const rhs = g.decl.slice(g.decl.indexOf("=") + 1);
  if (hasString(rhs)) return true;
  const annotation = g.decl.slice(0, g.decl.indexOf("="));
  if (/:\s*[^=]*\bstring\b/.test(annotation)) return true;
  return assignmentsTo(src, g).some(({ text }) => hasString(text));
};

/**
 * Every assignment to the gate after its declaration.
 *
 * ⚠️ NOT line-anchored. `if (!haveDb) skip = "Postgres unreachable";` — the exact spelling
 * `contractor_search_arms` uses — puts the assignment mid-line, so a `^\s*name\s*=` regex
 * misses it and the ordering rule silently stops applying.
 */
export const assignmentsTo = (
  src: string,
  g: Gate,
): { index: number; text: string }[] => {
  const out: { index: number; text: string }[] = [];
  for (const m of src.matchAll(new RegExp(`\\b${g.name}\\s*=(?![=>])`, "g"))) {
    const i = m.index ?? 0;
    if (i >= g.declStart && i < g.declEnd) continue; // the declaration itself
    out.push({ index: i, text: src.slice(i, statementEnd(src, i)) });
  }
  return out;
};

/**
 * Violations for one file's source.
 *
 * ⚠️ `ctx.skip(reason)` does NOT count as reporting. Plan §1.1 measured that its note is
 * invisible under the default reporter — the channel this whole tier exists to reach — and an
 * earlier draft accepted `/\.skip\(/`, which also matched `describe.skip("some title")` and
 * read the prose title as an argument list.
 */
export const scanSource = (src: string): Violation[] => {
  const out: Violation[] = [];
  const calls = reportCalls(src);

  for (const c of calls)
    if (c.args.split(",")[0].trim() !== "import.meta.url")
      out.push({ kind: "literal-label", gate: c.args.split(",")[0].trim() });

  for (const g of gatesOf(src)) {
    if (!carriesReason(src, g)) continue; // bare boolean — plan §7, Tier 3
    const mine = calls.filter((c) =>
      new RegExp(`\\b${g.name}\\b`).test(c.args),
    );
    if (mine.length === 0) {
      out.push({ kind: "unreported", gate: g.name });
      continue;
    }
    const writes = assignmentsTo(src, g).map((a) => a.index);
    const after = Math.max(g.declEnd, ...writes, -1);
    if (!mine.some((c) => c.index > after))
      out.push({ kind: "ordering", gate: g.name });
  }
  return out;
};
