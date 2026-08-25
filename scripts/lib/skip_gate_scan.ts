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

export type ViolationKind =
  | "unreported"
  | "ordering"
  | "literal-label"
  | "silent-inline-skip"
  | "unasserted-committed-input";

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
/**
 * A bare `return t.skip()` inside a test body, with no reason reported near it.
 *
 * ⚠️ THIS CLASS IS WORSE THAN AN UNREPORTED GATE, WHICH IS WHY IT HAS ITS OWN RULE.
 * `skipIf` at least leaves the FILE counted as skipped; a `t.skip()` inside the body
 * leaves it counted as **passed**. Measured before Tier 3a: 23 files, 115 tests standing
 * down, `Test Files 23 passed (23)`, one reason printed between them — a population the
 * §6 acceptance count could not even see, because it counts skipped files.
 *
 * Prefer hoisting the probe to a module-scope gate and using `test.skipIf`. When the
 * condition depends on a value computed INSIDE the test it cannot be hoisted, and then the
 * rule is simply: say why before standing down.
 *
 * ⚠️ IT MATCHES `.skip(` WITH ANY ARGUMENTS, NOT JUST EMPTY PARENS. The first cut required
 * `\(\s*\)`, so `return t.skip("a reason")` was invisible — 30 occurrences across 8 tracked
 * files, with the corpus gate green. A note passed to `ctx.skip` is NOT reporting: §1.1
 * measured that the default reporter does not render it, which is this tier's whole premise.
 *
 * The receiver must be a vitest CONTEXT, never `describe`/`test`/`it` — `describe.skip("a
 * prose title")` is a suite marker, not a gate standing down. And the reportSkip must be
 * NEARBY: one elsewhere in the file says nothing about this branch.
 */
const inlineSkips = (src: string): Violation[] => {
  const out: Violation[] = [];
  const reported = new Set(
    reportCalls(src).flatMap(
      (c) => c.args.match(/\b[A-Za-z_$][\w$]*\b/g) ?? [],
    ),
  );
  // ⚠️ TWO CALL SHAPES. `t.skip(…)` and the DESTRUCTURED `async ({ skip }) => skip(…)`,
  // which reads as a bare `skip(` and was invisible to the first rule — with a live
  // instance in budget_pg_roundtrip standing down for a real reason that reached nothing.
  const sites = [
    ...src.matchAll(/\b(\w+)\.skip\(/g),
    ...(/async\s*\(\s*\{[^}]*\bskip\b[^}]*\}\s*\)/.test(src)
      ? [...src.matchAll(/(?<![.\w])(skip)\(/g)]
      : []),
  ].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const m of sites) {
    const name = m[1];
    if (name === "describe" || name === "test" || name === "it") continue;
    const open = (m.index ?? 0) + m[0].length;
    const arg = src.slice(open, closeParen(src, open)).trim();
    // `return t.skip(gate)` where `gate` is already reported at module scope is fine: the
    // reason reached stderr once, and repeating it per test would read as several separate
    // gates standing down for one cause.
    if (/^[A-Za-z_$][\w$]*$/.test(arg) && reported.has(arg)) continue;
    // Otherwise PROXIMITY, not the whole file — a reportSkip elsewhere says nothing about
    // THIS branch. 400 chars covers the guard block that precedes a self-skip.
    const before = src.slice(Math.max(0, (m.index ?? 0) - 400), m.index ?? 0);
    if (!/reportSkip\s*\(/.test(before))
      out.push({
        kind: "silent-inline-skip",
        // The destructured form is a bare `skip(` — calling it "skip.skip()" would send a
        // reader looking for a receiver that is not there.
        gate: `${m[0].startsWith("skip(") ? "skip" : `${name}.skip`}(${arg ? "…" : ""})`,
      });
  }
  return out;
};

/**
 * A COMMITTED artifact used to gate a skip, with no presence assertion beside it.
 *
 * ⚠️ Tier 3c (plan §8.3): absence of a tracked file is a broken working copy, not a
 * supported state — CI does a full `actions/checkout`. Standing down for it hides a defect
 * as a `+1` on a skip count where 160-odd data gates already skip for want of a database.
 * `assertCommitted()` states it as an assertion instead, OUTSIDE the gate.
 *
 * `isTracked` is injected rather than shelling out to git here, so the rule stays a pure
 * function the synthetic harness can drive.
 */
const committedInputs = (
  src: string,
  isTracked: (p: string) => boolean,
): Violation[] => {
  // ⚠️ ANCHORED ON `existsSync`, NOT ON `skipIf(` — requiring the latter re-introduced
  // exactly the usage-anchoring `gatesOf` carries a ⚠️ against, and it had a live escapee:
  // `sector_stats_tourism` stands down through `return t.skip(skip)` and contains no
  // `skipIf(` at all, so it was exempt while eight sibling files on the same archetype
  // were covered.
  if (!/existsSync\s*\(/.test(src)) return [];
  const asserted = new Set(
    (src.match(/assertCommitted\(([\s\S]*?)\)/)?.[1] ?? "").match(
      /"([^"]+)"/g,
    ) ?? [],
  );
  const out: Violation[] = [];
  for (const m of src.matchAll(/"((?:data|raw_data|public)\/[^"]+)"/g)) {
    if (!isTracked(m[1])) continue;
    if (asserted.has(`"${m[1]}"`)) continue;
    if (out.some((v) => v.gate === m[1])) continue;
    out.push({ kind: "unasserted-committed-input", gate: m[1] });
  }
  return out;
};

export const scanSource = (
  src: string,
  isTracked: (p: string) => boolean = () => false,
): Violation[] => {
  const out: Violation[] = [
    ...inlineSkips(src),
    ...committedInputs(src, isTracked),
  ];
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
