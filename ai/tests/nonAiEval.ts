import {
  registryEvalCases,
  expectedArgs,
  LEGACY_GROUPS,
  type EvalCase,
} from "../llm/currentEval";
import { CHALLENGES, UNSUPPORTED } from "../llm/currentEval.cases";
import { REALISTIC, CONVERSATIONS } from "../llm/currentEval.realistic";
import { STARTER_CASES } from "../llm/currentEval.starters";
import { selectHeuristicRoute } from "../llm/heuristicRoute";
import { validateToolArgs } from "../orchestrator/toolSchema";
import { decodeProcurementQuery } from "../../src/lib/procurementQuery";
import type { Route } from "../orchestrator/router";
import type { Lang, ToolArgs } from "../tools/types";
// Re-exported from currentEval so the group list, the billed harness's selector
// and this floor denominator have one source of truth.
export { LEGACY_GROUPS };
export const NON_AI_CASES = [
  ...registryEvalCases(),
  ...CHALLENGES,
  ...UNSUPPORTED,
  ...REALISTIC,
  ...CONVERSATIONS,
  ...STARTER_CASES,
];

// The deterministic lane still emits the legacy `openTenders` envelope for some
// Bulgarian procurement starters, carrying the real query URL-encoded in
// `canonical`. Accepting it as the declared `procurementQuery` intent is the
// REVIEWED rule of the repository — `ai/app/starters.test.ts:62-72` normalizes it
// exactly this way and passes 738/738, and `parseModelRoute` does the same for
// the model lane (`ai/orchestrator/routeScope.ts`). Scoring the literal tool name
// here judged the same question two ways by language.
//
// The rewrite is conditional on the case's GOLD tool, exactly as in
// starters.test.ts: a starter that genuinely declares `openTenders` keeps that
// identity and only loses the opaque `canonical` blob, so its args are still
// scored against its own gold.
const normalizeRoute = (r: Route, expectedTool: string | null): Route => {
  if (!r || r.tool !== "openTenders" || !r.args.canonical) return r;
  const decoded = decodeProcurementQuery(String(r.args.canonical));
  if (expectedTool === "procurementQuery" && decoded.ok)
    return { tool: "procurementQuery", args: decoded.query as ToolArgs };
  // Undecodable, or a genuinely-`openTenders` expectation: keep the tool and drop
  // the opaque blob so argument scoring reports the real missing keys instead of
  // one unparseable string.
  const { canonical: _canonical, ...legacy } = r.args;
  void _canonical;
  return { ...r, args: legacy as ToolArgs };
};
export function nonAiInput(c: EvalCase, lang: Lang) {
  const history = c.history?.[lang];
  let prev = history?.at(-1);
  let question = c[lang];
  // The original three conversation examples predate structured history.
  const legacy = question.match(
    /^(?:Previous tool|Предишен инструмент): (\w+), args: (\{[^\n]+\})\n(?:Current question|Текущ въпрос): ([\s\S]+)$/,
  );
  if (legacy) {
    prev = {
      question: "",
      tool: legacy[1],
      args: JSON.parse(legacy[2]) as ToolArgs,
    };
    question = legacy[3];
  }
  return {
    question,
    opts: {
      history,
      prev: prev?.tool ? { tool: prev.tool, args: prev.args ?? {} } : undefined,
    },
  };
}
const norm = (v: unknown) => String(v).normalize("NFC").trim().toLowerCase();
// Mirrors the production scorer's comparison: a list expectation is the whole
// list as one value, not a list of alternatives.
const sameValue = (
  actual: unknown,
  expected: string | number | (string | number)[],
): boolean =>
  Array.isArray(expected)
    ? Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((v, i) => norm(actual[i]) === norm(v))
    : norm(actual) === norm(expected);
export function evaluateNonAi(c: EvalCase, lang: Lang) {
  const { question, opts } = nonAiInput(c, lang);
  const result = selectHeuristicRoute(
    question,
    { lang, election: "2026_04_19" },
    opts,
  );
  const selected = normalizeRoute(result.route, c.tool);
  const toolOk = c.tool === null ? !selected : selected?.tool === c.tool;
  const expected = expectedArgs(c, lang);
  const args = selected ? validateToolArgs(selected.tool, selected.args) : null;
  // `null`, never `true`, when the case carries no expectation, so a consumer
  // averaging `argsOk` over rows cannot report an unannotated case as a pass.
  const argsOk: boolean | null =
    expected === undefined
      ? null
      : toolOk &&
        !!args &&
        Object.entries(expected).every(([k, values]) =>
          values.some((v) => sameValue(args[k], v)),
        );
  const callOk =
    c.tool === null ? !selected : toolOk && !!args && argsOk !== false;
  return {
    id: c.id,
    lang,
    group: c.group,
    question,
    expectedTool: c.tool,
    expectedArgs: expected,
    selected,
    notice: result.notice,
    toolOk,
    callOk,
    argsOk,
    argScored: expected !== undefined,
  };
}
export const nonAiResults = () =>
  NON_AI_CASES.flatMap((c) =>
    (["en", "bg"] as const).map((lang) => evaluateNonAi(c, lang)),
  );
