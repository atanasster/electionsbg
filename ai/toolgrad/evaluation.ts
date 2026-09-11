import { parseModelRoute } from "../orchestrator/routeScope";
import { validateArguments } from "../orchestrator/validateArguments";
import {
  scoreProduction,
  evalUserContent,
  type EvalCase,
} from "../llm/currentEval";
import { REALISTIC, CONVERSATIONS } from "../llm/currentEval.realistic";
import type { Lang, ToolArgs } from "../tools/types";
import type { Sample } from "./questions";

export type Task = {
  id: string;
  lang: Lang;
  split: "development" | "holdout" | "reference";
  question: string;
  expectedTool: string | null;
  expectedArgs?: ToolArgs;
  reference?: EvalCase;
  masked: boolean;
};
// No captured personal names, organisation IDs, or fact values are sent for evaluation.
// These synthetic entities test argument preservation, not real entity resolution.
const replacement = (key: string, lang: Lang) =>
  key === "name"
    ? lang === "bg"
      ? "Примерен Представител"
      : "Example Official"
    : key === "unp"
      ? "99999-2025-9999"
      : "901234567";
const privateKey = (key: string) =>
  ["name", "org", "company", "unp"].includes(key);
export function generatedTask(s: Sample): Task {
  let question = s.question;
  const args = { ...s.args };
  let masked = false;
  for (const [k, v] of Object.entries(args))
    if (privateKey(k)) {
      const fake = replacement(k, s.lang);
      question = question.split(String(v)).join(fake);
      args[k] = fake;
      masked = true;
    }
  return {
    id: s.id,
    lang: s.lang,
    split: s.split,
    question,
    expectedTool: s.tool,
    expectedArgs: args,
    masked,
  };
}
export function referenceTasks(): Task[] {
  return [...REALISTIC, ...CONVERSATIONS].flatMap((original) =>
    (["bg", "en"] as const).map((lang) => {
      const c: EvalCase = JSON.parse(JSON.stringify(original));
      let masked = false;
      const replace = (key: string, values: (string | number)[]) => {
        if (!privateKey(key)) return;
        masked = true;
        const fake = replacement(key, lang);
        for (const v of values) c[lang] = c[lang].split(String(v)).join(fake);
        if (c.args?.[key]) c.args[key] = [fake];
        for (const h of c.history?.[lang] ?? [])
          if (h.args && h.args[key] !== undefined) h.args[key] = fake;
      };
      for (const [k, values] of Object.entries(c.args ?? {}))
        replace(k, values);
      for (const h of c.history?.[lang] ?? [])
        for (const [k, v] of Object.entries(h.args ?? {}))
          replace(k, [String(v)]);
      return {
        id: `${c.id}:${lang}`,
        lang,
        split: "reference" as const,
        question: evalUserContent(c, lang),
        expectedTool: c.tool,
        reference: c,
        masked,
      };
    }),
  );
}
const aliases: Record<string, string> = {
  plovdiv: "пловдив",
  varna: "варна",
  ruse: "русе",
  gabrovo: "габрово",
  gerb: "герб",
  "2023": "2023_10_29_mi",
};
const normalize = (key: string, value: unknown) => {
  const raw = String(value).normalize("NFC").trim().toLowerCase();
  return key === "cycle"
    ? (aliases[raw] ?? raw)
    : ["place", "party"].includes(key)
      ? (aliases[raw] ?? raw)
      : raw;
};
export function scoreTask(task: Task, raw: string, error?: string) {
  if (task.reference) {
    const s = scoreProduction(task.reference, task.lang, raw, error);
    return {
      toolOk: s.toolOk,
      callOk: s.callOk,
      argsOk: s.argScored ? s.argsOk : null,
      parsed: s.parsed,
      clarificationOk: task.expectedTool === null ? s.callOk : null,
    };
  }
  let rawArgsValid = false;
  try {
    const obj = JSON.parse(raw);
    rawArgsValid =
      obj.tool === task.expectedTool &&
      !Object.keys(validateArguments(obj.tool, obj.args).errors).length;
  } catch {
    /* invalid output cannot pass */
  }
  const parsed = error ? null : parseModelRoute(raw, task.question);
  const toolOk = !!parsed && parsed.tool === task.expectedTool;
  const actual = parsed
    ? validateArguments(parsed.tool, parsed.args, { defaults: true })
    : null;
  const expected = validateArguments(task.expectedTool!, task.expectedArgs, {
    defaults: true,
  });
  // Compare the full validated call, not only a permissive subset: extra filters fail.
  const keys = new Set([
    ...Object.keys(actual?.args ?? {}),
    ...Object.keys(expected.args),
  ]);
  const argsOk =
    rawArgsValid &&
    toolOk &&
    actual !== null &&
    !Object.keys(actual.errors).length &&
    !Object.keys(expected.errors).length &&
    [...keys].every(
      (k) => normalize(k, actual.args[k]) === normalize(k, expected.args[k]),
    );
  return { toolOk, callOk: argsOk, argsOk, parsed, clarificationOk: null };
}
export type Row = Task &
  ReturnType<typeof scoreTask> & {
    raw: string;
    error?: string;
    elapsedMs: number;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cost?: number;
    };
  };
export function metrics(rows: Row[]) {
  const times = rows.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const clarification = rows.filter((r) => r.clarificationOk !== null);
  const argRows = rows.filter((r) => r.argsOk !== null);
  return {
    n: rows.length,
    toolCorrect: rows.filter((r) => r.toolOk).length,
    callCorrect: rows.filter((r) => r.callOk).length,
    argumentN: argRows.length,
    argumentCorrect: argRows.filter((r) => r.argsOk).length,
    clarificationN: clarification.length,
    clarificationCorrect: clarification.filter((r) => r.clarificationOk).length,
    errors: rows.filter((r) => r.error).length,
    masked: rows.filter((r) => r.masked).length,
    medianMs: times.length ? times[Math.floor(times.length / 2)] : null,
    p95Ms: times.length
      ? times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)]
      : null,
    promptTokens: rows.reduce((s, r) => s + (r.usage?.prompt_tokens ?? 0), 0),
    outputTokens: rows.reduce(
      (s, r) => s + (r.usage?.completion_tokens ?? 0),
      0,
    ),
    billedUSD:
      rows.length && rows.every((r) => typeof r.usage?.cost === "number")
        ? rows.reduce((s, r) => s + r.usage!.cost!, 0)
        : null,
  };
}
