// Gemini alone, and Jev + Gemini, on the robustness questions.
//
//   node --env-file=.env.local --import tsx ai/llm/robustnessGemini.ts
//   npx tsx ai/llm/robustnessGemini.ts --rescore      # no API calls
//
// Reads the 1,953 variant questions from data/ai/evals/jev_robustness.json (as
// written, with typos, reworded, Bulgarian in Latin letters) and adds the two
// AI-lane columns to the three that run already scored (rules, Jev's raw pick,
// the no-AI Jev lane). Writes data/ai/evals/gemini_robustness.json.
//
// Three things keep the five columns comparable:
//  - SAME SCORER: the tool is read with `parseModelRoute` and normalised with
//    `normalizeRouteForScoring`, exactly as jevRobustness.ts scores the rules
//    and the Jev lane. Only the tool is scored — a rewording keeps the tool but
//    not the expected parameter values.
//  - SAME JEV DECISIONS: Jev + Gemini uses the pick and confidence recorded in
//    the robustness run rather than asking Jev again. Jev's confidence moves a
//    little between calls, and re-asking would compare a different sample of
//    Jev against the "Jev raw" column beside it.
//  - SAME GEMINI REQUEST AS PRODUCTION: `narrowCatalogueForBudget` +
//    `routingMessages` with the proxy's own payload, and for Jev + Gemini the
//    provider's rule, `jevRoutingStep`, with its full-prompt fallback.

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { parseModelRoute } from "../orchestrator/routeScope";
import { normalizeRouteForScoring } from "../tests/nonAiEval";
import { narrowCatalogueForBudget } from "./openrouter";
import { routingMessages } from "./promptBudget";
import { jevRoutingStep, type AiTurnPlan } from "./jevAiLane";
import { JEV_CONFIDENCE_GATE } from "./jev";
import type { RobustRow } from "./jevRobustness";
import type { Lang } from "../tools/types";

const { payload, MODEL } = createRequire(import.meta.url)(
  "../../functions/llm_security.js",
);
const IN = "data/ai/evals/jev_robustness.json";
const OUT = "data/ai/evals/gemini_robustness.json";

type Messages = ReturnType<typeof routingMessages>;

const gemini = async (key: string, messages: Messages): Promise<string> => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          payload({
            model: MODEL,
            messages,
            temperature: 0,
            max_tokens: 120,
            response_format: { type: "json_object" },
          }),
        ),
        signal: AbortSignal.timeout(45000),
      },
    ).catch((e: unknown) => e as Error);
    const transient =
      res instanceof Error || res.status === 429 || res.status >= 500;
    if (transient && attempt < 6) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (res instanceof Error) throw res;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }
};

/** The tool a routing reply names, scored like every other column. */
const toolOf = (
  raw: string,
  question: string,
  allowed: readonly string[] | undefined,
  expected: string,
): string | null =>
  normalizeRouteForScoring(
    parseModelRoute(raw, question, allowed ? new Set(allowed) : undefined),
    expected,
  )?.tool ?? null;

export type GeminiRow = {
  index: number;
  geminiTool: string | null;
  geminiOk: boolean;
  jevGeminiTool: string | null;
  jevGeminiOk: boolean;
  step: "run" | "fill" | "full";
  fellBack: boolean;
  error?: string;
};

const scoreOne = async (
  key: string,
  r: RobustRow,
  index: number,
): Promise<GeminiRow> => {
  const lang = r.lang as Lang;
  const full = narrowCatalogueForBudget(r.question, lang, r.question);
  const fullMessages = routingMessages(lang, full, r.question);
  const geminiTool = toolOf(
    await gemini(key, fullMessages),
    r.question,
    full,
    r.expectedTool,
  );

  // The plan the provider would have had: Jev's recorded pick, gated.
  const plan: AiTurnPlan = {
    tool:
      r.jevPick && (r.jevConfidence ?? 0) >= JEV_CONFIDENCE_GATE
        ? r.jevPick
        : null,
    toolConfidence: r.jevConfidence ?? undefined,
    noTool: false,
    compound: false,
    kind: null,
    degraded: r.jevConfidence == null,
  };
  const step = jevRoutingStep(plan);
  let jevGeminiTool: string | null;
  let fellBack = false;
  if (step.kind === "run") jevGeminiTool = step.tool;
  else if (step.kind === "fill") {
    const raw = await gemini(
      key,
      routingMessages(lang, [step.tool], r.question),
    );
    const parsed = parseModelRoute(raw, r.question, new Set([step.tool]));
    if (parsed?.tool === step.tool)
      jevGeminiTool = toolOf(raw, r.question, [step.tool], r.expectedTool);
    else {
      fellBack = true;
      // The full-prompt answer was already fetched above for the Gemini column;
      // the provider would send the identical request, so it is reused.
      jevGeminiTool = geminiTool;
    }
  } else jevGeminiTool = geminiTool;

  return {
    index,
    geminiTool,
    geminiOk: geminiTool === r.expectedTool,
    jevGeminiTool,
    jevGeminiOk: jevGeminiTool === r.expectedTool,
    step: step.kind,
    fellBack,
  };
};

const VARIANTS = ["original", "typo", "latin", "paraphrase"] as const;
const share = (xs: boolean[]) =>
  xs.length ? xs.filter(Boolean).length / xs.length : null;
const pct = (x: number | null) =>
  x == null ? "  n/a" : `${(100 * x).toFixed(1).padStart(5)}%`;

export const summarise = (rows: RobustRow[], g: GeminiRow[]) => {
  const out: Record<string, Record<string, number | null>> = {};
  for (const [slice, keep] of [
    ["all", () => true],
    ["examples", (r: RobustRow) => r.group === "registry"],
    ["handwritten", (r: RobustRow) => r.group !== "registry"],
  ] as const)
    for (const lang of ["en", "bg"] as const)
      for (const v of VARIANTS) {
        const pairs = g
          .map((x) => ({ r: rows[x.index], x }))
          .filter(
            ({ r, x }) =>
              keep(r) && r.lang === lang && r.variant === v && !x.error,
          );
        if (!pairs.length) continue;
        out[`${slice}|${lang}:${v}`] = {
          n: pairs.length,
          rules: share(pairs.map(({ r }) => r.rulesOk)),
          jevRaw: share(pairs.map(({ r }) => r.jevRawOk)),
          jevLane: share(pairs.map(({ r }) => r.laneOk)),
          gemini: share(pairs.map(({ x }) => x.geminiOk)),
          jevGemini: share(pairs.map(({ x }) => x.jevGeminiOk)),
        };
      }
  return out;
};

const print = (s: ReturnType<typeof summarise>) => {
  let slice = "";
  for (const [k, m] of Object.entries(s)) {
    const [sl, key] = k.split("|");
    if (sl !== slice) {
      slice = sl;
      console.log(
        `\n${sl.toUpperCase()}\n  lang:variant        n   rules  Jev raw  Jev lane   Gemini  Jev+Gemini`,
      );
    }
    console.log(
      `  ${key.padEnd(16)} ${String(m.n).padStart(4)} ${pct(m.rules)} ${pct(m.jevRaw)}   ${pct(m.jevLane)}  ${pct(m.gemini)}    ${pct(m.jevGemini)}`,
    );
  }
};

const main = async () => {
  const { rows } = JSON.parse(readFileSync(IN, "utf8")) as {
    rows: RobustRow[];
  };
  if (process.argv.includes("--rescore")) {
    const { rows: g } = JSON.parse(readFileSync(OUT, "utf8")) as {
      rows: GeminiRow[];
    };
    print(summarise(rows, g));
    return;
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is required");
  const out: GeminiRow[] = new Array(rows.length);
  let next = 0,
    done = 0;
  const worker = async () => {
    while (next < rows.length) {
      const i = next++;
      try {
        out[i] = await scoreOne(key, rows[i], i);
      } catch (e) {
        out[i] = {
          index: i,
          geminiTool: null,
          geminiOk: false,
          jevGeminiTool: null,
          jevGeminiOk: false,
          step: "full",
          fellBack: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
      if (++done % 200 === 0) console.error(`  ${done}/${rows.length}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const summary = summarise(rows, out);
  const errors = out.filter((x) => x.error).length;
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        model: MODEL,
        source: IN,
        errors,
        summary,
        rows: out,
      },
      null,
      2,
    ) + "\n",
  );
  print(summary);
  console.log(`\nerrors (excluded from the figures): ${errors}`);
  console.log(`wrote ${OUT}`);
};

if (process.argv[1]?.endsWith("robustnessGemini.ts")) main();
