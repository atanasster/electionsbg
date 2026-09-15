import { TOOLS_BY_NAME } from "../tools/registry";
import { STARTERS } from "../app/starters";
import { STARTER_GROUP, type EvalCase, type ExpectedArgs } from "./currentEval";

// The chat starter bank as an eval group — the richest argument ground truth in
// the repo, previously visible only to ai/app/starters.test.ts and to
// regression.ts's non-null smoke check.
//
// MEASURED (2026-09-16, 367 chat-ready starters):
//   - 242 EN / 241 BG declare expected arguments, over 73 distinct argument keys in
//     the MERGED bank (the raw starterPrompts.json has 39) — src/lib/questions/catalog.ts
//     contributes the rest via question defaults.
//   - 102 of 367 declare different bg and en values.
//   - 204 of the 284 RAW starterPrompts.json entries appear verbatim in
//     ai/tools/registry.ts.
//
// Two things about it are deliberate:
//
// 1. It is a RECALL-tainted set: the 204 verbatim entries live in the corpus the
//    lexical retriever indexes, so recall@K over this group is guaranteed by
//    construction. It must be EXCLUDED from retriever-recall measurement. It is
//    included for TOOL and ARGUMENT accuracy, where the expectation is gold
//    rather than retrievable text and contamination does not apply.
//
// 2. Arguments are per-language. `agencyProfile` declares "колко е точна алфа
//    рисърч?" against "how accurate is alpha research?", so a merged
//    "either value is acceptable" set would silently accept the wrong-language
//    gold. Differing starters therefore carry `argsByLang`, and the two languages
//    are compared by canonical key/value content rather than by
//    JSON.stringify — insertion order is not a difference.

const isScalar = (v: unknown): v is string | number =>
  typeof v === "string" || typeof v === "number";

// A starter declares its expected args as a plain object; an eval case wants, per
// key, the ACCEPTABLE VALUES. A scalar becomes one acceptable value. An array is
// a `stringList`/`numberList` parameter whose VALUE is the list, so it becomes one
// acceptable value that is itself a list — spreading it would turn
// `basePredicates: ["bulgarian","lead"]` into "acceptable: bulgarian or lead",
// which can never match the list the route actually returns.
const toExpected = (
  args: Record<string, unknown> | undefined,
): ExpectedArgs => {
  const out: ExpectedArgs = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (isScalar(value)) out[key] = [value];
    else if (Array.isArray(value) && value.every(isScalar))
      out[key] = [value as (string | number)[]];
  }
  return out;
};

// Order-insensitive equality of two expectation maps, so `differs` reports a real
// language disagreement rather than a differing key insertion order.
const sameExpectation = (a: ExpectedArgs, b: ExpectedArgs): boolean => {
  const ka = Object.keys(a),
    kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) => k in b && JSON.stringify(a[k]) === JSON.stringify(b[k]))
  );
};

export const starterEvalCases = (): EvalCase[] =>
  STARTERS.filter((s) => TOOLS_BY_NAME[s.tool]).map((s) => {
    const bg = toExpected(s.args.bg),
      en = toExpected(s.args.en);
    const overlay: Partial<Record<"bg" | "en", ExpectedArgs>> = {};
    if (!sameExpectation(bg, en)) {
      if (Object.keys(bg).length) overlay.bg = bg;
      if (Object.keys(en).length) overlay.en = en;
    }
    return {
      id: `starter:${s.id}`,
      group: STARTER_GROUP,
      tool: s.tool,
      bg: s.bg,
      en: s.en,
      // NOT `review` — that field means "a human revised this expectation" and the
      // eval screen renders it as such, which every starter row would falsely claim.
      source: `starter bank · ${s.category}/${s.subcategory}`,
      // Unannotated starters carry no expectation at all, so they are never
      // counted in the argument denominator.
      ...(Object.keys(overlay).length
        ? { argsByLang: overlay }
        : Object.keys(bg).length
          ? { args: bg }
          : {}),
    };
  });

export const STARTER_CASES: EvalCase[] = starterEvalCases();

// Starters whose declared tool is not in the registry. Exported so this silent
// drop path is asserted in a test rather than trusted: a tool rename would
// otherwise remove every starter pointing at it without failing anything.
export const droppedStarters = () =>
  STARTERS.filter((s) => !TOOLS_BY_NAME[s.tool]).map((s) => s.id);
