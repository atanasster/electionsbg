import { registryEvalCases, type EvalCase } from "../llm/currentEval";
import { CHALLENGES, UNSUPPORTED } from "../llm/currentEval.cases";
import { REALISTIC, CONVERSATIONS } from "../llm/currentEval.realistic";
import { selectHeuristicRoute } from "../llm/heuristicRoute";
import { validateToolArgs } from "../orchestrator/toolSchema";
import type { Lang, ToolArgs } from "../tools/types";
export const NON_AI_CASES = [
  ...registryEvalCases(),
  ...CHALLENGES,
  ...UNSUPPORTED,
  ...REALISTIC,
  ...CONVERSATIONS,
];
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
export function evaluateNonAi(c: EvalCase, lang: Lang) {
  const { question, opts } = nonAiInput(c, lang);
  const result = selectHeuristicRoute(
    question,
    { lang, election: "2026_04_19" },
    opts,
  );
  const selected = result.route;
  const toolOk = c.tool === null ? !selected : selected?.tool === c.tool;
  const args = selected ? validateToolArgs(selected.tool, selected.args) : null;
  const argsOk =
    toolOk &&
    !!args &&
    Object.entries(c.args ?? {}).every(([k, values]) =>
      values.some((v) => norm(args[k]) === norm(v)),
    );
  const callOk =
    c.tool === null
      ? !selected
      : toolOk && !!args && (c.args === undefined || argsOk);
  return {
    id: c.id,
    lang,
    group: c.group,
    question,
    expectedTool: c.tool,
    expectedArgs: c.args,
    selected,
    notice: result.notice,
    toolOk,
    callOk,
    argsOk,
    argScored: c.args !== undefined,
  };
}
export const nonAiResults = () =>
  NON_AI_CASES.flatMap((c) =>
    (["en", "bg"] as const).map((lang) => evaluateNonAi(c, lang)),
  );
