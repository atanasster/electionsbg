import { reviewCase } from "./currentEval.review";
import { parseModelRoute } from "../orchestrator/routeScope";
// Pure scoring for the production JSON router. Transport errors are never abstentions.
import { TOOLS } from "../tools/registry";
import {
  buildContext,
  CLOUD_BUDGET,
  renderRoutingContext,
  type TurnMemory,
} from "../orchestrator/memory";
import type { Lang } from "../tools/types";
export type EvalCase = {
  id: string;
  group:
    | "registry"
    | "challenge"
    | "holdout"
    | "unsupported"
    | "realistic"
    | "conversation"
    | "clarification";
  tool: string | null;
  en: string;
  bg: string;
  review?: string;
  history?: Record<Lang, TurnMemory[]>;
  args?: Record<string, (string | number)[]>;
};
export const registryEvalCases = (): EvalCase[] =>
  TOOLS.flatMap((t) =>
    t.examples.map((e, i) => ({
      id: `${t.name}:${i + 1}`,
      group: "registry" as const,
      tool: t.name,
      ...e,
    })),
  ).map(reviewCase);
const norm = (x: unknown) =>
  String(x).normalize("NFC").trim().toLocaleLowerCase();
export function scoreProduction(
  c: EvalCase,
  lang: Lang,
  raw: string,
  error?: string,
) {
  let obj: Record<string, unknown> | undefined;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) obj = v;
  } catch {
    /* invalid */
  }
  const parsed = parseModelRoute(raw, evalUserContent(c, lang));
  const selected = typeof obj?.tool === "string" ? obj.tool : null;
  const abstained = !!obj && obj.tool === null;
  const toolOk = !error && (c.tool === null ? abstained : selected === c.tool);
  const argScored = c.args !== undefined;
  const argsOk =
    !error &&
    parsed?.tool === c.tool &&
    !!parsed &&
    Object.entries(c.args ?? {}).every(([k, values]) =>
      values.some((v) => norm(parsed.args[k]) === norm(v)),
    );
  const callOk =
    !error &&
    (c.tool === null
      ? abstained
      : parsed?.tool === c.tool && !!parsed && (!argScored || argsOk));
  return {
    id: c.id,
    group: c.group,
    lang,
    expectedTool: c.tool,
    selected,
    parsed,
    jsonValid: !!obj && !error,
    toolOk,
    argScored,
    argsOk,
    callOk,
    raw,
    ...(error ? { error } : {}),
  };
}
export type EvalScore = ReturnType<typeof scoreProduction>;
export function summarize(scores: EvalScore[]) {
  const ratio = (
    xs: EvalScore[],
    key: "toolOk" | "callOk" | "jsonValid" | "argsOk",
  ) => (xs.length ? xs.filter((s) => s[key]).length / xs.length : null);
  return Object.fromEntries(
    (["en", "bg"] as const).map((lang) => {
      const rows = scores.filter((s) => s.lang === lang);
      return [
        lang,
        {
          n: rows.length,
          toolAcc: ratio(rows, "toolOk"),
          callAcc: ratio(rows, "callOk"),
          argN: rows.filter((s) => s.argScored).length,
          argAcc: ratio(
            rows.filter((s) => s.argScored),
            "argsOk",
          ),
          jsonValidRate: ratio(rows, "jsonValid"),
          irrelevanceAcc: ratio(
            rows.filter((s) => s.expectedTool === null),
            "callOk",
          ),
          errors: rows.filter((s) => s.error).length,
        },
      ];
    }),
  );
}

// Use the same bounded context representation as the cloud provider.
export function evalUserContent(c: EvalCase, lang: Lang): string {
  const context = renderRoutingContext(
    buildContext(c.history?.[lang] ?? [], CLOUD_BUDGET),
    lang,
  );
  return context
    ? `${context}\n\n${lang === "bg" ? "Текущ въпрос" : "Current question"}: ${c[lang]}`
    : c[lang];
}
