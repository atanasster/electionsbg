// node --env-file=.env.local --import tsx ai/llm/currentEval.run.ts baseline|revised
// Real production prompt + Gemini compatibility endpoint + server payload settings.
// Operator credentials; no public-proxy bypass. No cache; every run has unique provenance.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildToolSystemPrompt } from "../orchestrator/prompts";
import { TOOLS } from "../tools/registry";
import {
  registryEvalCases,
  evalUserContent,
  scoreProduction,
  summarize,
  type EvalScore,
} from "./currentEval";
import { CHALLENGES, UNSUPPORTED } from "./currentEval.cases";
import { REALISTIC, CONVERSATIONS } from "./currentEval.realistic";
const { payload, MODEL } = createRequire(import.meta.url)(
  "../../functions/llm_security.js",
);
const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY required; no evaluation performed");
const label = process.argv[2];
if (!["baseline", "revised"].includes(label))
  throw new Error("Specify baseline or revised");
const cases = [
  ...registryEvalCases(),
  ...CHALLENGES,
  ...UNSUPPORTED,
  ...REALISTIC,
  ...CONVERSATIONS,
];
const referencePromptPath = process.env.EVAL_REFERENCE_PROMPTS;
if (referencePromptPath && label !== "baseline")
  throw new Error("Reference prompts are baseline-only");
const prompts = referencePromptPath
  ? JSON.parse(readFileSync(referencePromptPath, "utf8"))
  : {
      en: buildToolSystemPrompt("en"),
      bg: buildToolSystemPrompt("bg"),
    };
const hash = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
const resumeDir = process.argv[3];
if (resumeDir && !/^data\/ai\/evals\/runs\/[a-zA-Z0-9.-]+$/.test(resumeDir))
  throw new Error("Resume path must be a run directory");
const prior = resumeDir
  ? JSON.parse(readFileSync(`${resumeDir}/report.json`, "utf8"))
  : undefined;
if (
  prior &&
  (prior.promptHash !== hash(prompts) ||
    prior.suiteHash !== hash(cases) ||
    prior.model !== MODEL ||
    prior.label !== label)
)
  throw new Error("Cannot resume: model, prompts or suite changed");
const startedAt = prior?.startedAt ?? new Date().toISOString();
const dir =
  resumeDir ?? `data/ai/evals/runs/${startedAt.replace(/[:.]/g, "-")}-${label}`;
const commit =
  prior?.commit ??
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (prior && !existsSync(`${dir}/initial-report.json`))
  writeFileSync(
    `${dir}/initial-report.json`,
    JSON.stringify(prior, null, 2) + "\n",
  );
mkdirSync(dir, { recursive: true });
const tasks = cases.flatMap((c) =>
  (["en", "bg"] as const).map((lang) => ({ c, lang })),
);
if (tasks.length > 1000) throw new Error("Review request budget: >1000 calls");
const rows: (EvalScore & {
  ms: number;
  usage?: unknown;
  finishReason?: string;
  previousErrors?: string[];
})[] = prior?.rows ?? new Array(tasks.length);
let next = 0,
  done = 0;
async function worker() {
  for (;;) {
    const i = next++;
    if (i >= tasks.length) return;
    if (rows[i] && !rows[i].error) continue; // Retry transport failures only, never model mistakes.
    const previousErrors = rows[i]
      ? [...(rows[i].previousErrors ?? []), rows[i].error!]
      : [];
    const { c, lang } = tasks[i];
    const started = Date.now();
    let raw = "",
      error: string | undefined,
      usage: unknown,
      finishReason: string | undefined;
    try {
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
              messages: [
                { role: "system", content: prompts[lang] },
                { role: "user", content: evalUserContent(c, lang) },
              ],
              temperature: 0,
              max_tokens: 120,
              response_format: { type: "json_object" },
            }),
          ),
          signal: AbortSignal.timeout(45000),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error("provider error");
      raw = data.choices?.[0]?.message?.content ?? "";
      usage = data.usage;
      finishReason = data.choices?.[0]?.finish_reason;
      if (!raw) throw new Error("empty completion");
    } catch (e) {
      error = e instanceof Error ? e.message : "request failed";
    }
    rows[i] = {
      ...scoreProduction(c, lang, raw, error),
      ms: Date.now() - started,
      usage,
      finishReason,
      ...(previousErrors.length ? { previousErrors } : {}),
    };
    writeFileSync(
      `${dir}/checkpoint.json`,
      JSON.stringify(rows.filter(Boolean), null, 2) + "\n",
    );
    if (++done % 25 === 0) console.log(`${done}/${tasks.length} completed`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
const artifact = {
  schemaVersion: 2,
  suiteVersion: "2026-09-10-v2-reviewed",
  referencePromptPath,
  label,
  model: MODEL,
  provider: "Gemini OpenAI compatibility API (direct, same as production)",
  startedAt,
  finishedAt: new Date().toISOString(),
  commit,
  retriedErrors: rows.reduce((n, r) => n + (r.previousErrors?.length ?? 0), 0),
  toolCount: TOOLS.length,
  caseCount: cases.length,
  promptHash: hash(prompts),
  suiteHash: hash(cases),
  scoringVersion: "v2-production-normalization",
  scoringHash: hash(
    [
      "ai/llm/currentEval.ts",
      "ai/orchestrator/routeScope.ts",
      "ai/orchestrator/validateArguments.ts",
      "ai/tools/argumentCompatibility.ts",
    ].map((p) => readFileSync(p, "utf8")),
  ),
  registryHash: hash(
    TOOLS.map(({ name, description, params }) => ({
      name,
      description,
      params,
    })),
  ),
  settings: {
    max_tokens: 120,
    temperature: 0,
    reasoning_effort: "minimal",
    concurrency: 4,
  },
  scope:
    "Isolated model routing with the production prompt and parser; not tool execution, narration, or the deterministic fallback. Registry examples are in-distribution. Authored holdout is reported separately. Arguments use exact accepted values at their named keys; all annotated cases remain in the denominator. Invalid output and API errors never count as abstention.",
  metrics: summarize(rows),
  groups: Object.fromEntries(
    [...new Set(cases.map((c) => c.group))].map((g) => [
      g,
      summarize(rows.filter((r) => r.group === g)),
    ]),
  ),
  costUSD:
    rows.reduce(
      (sum, r) => sum + (Number((r.usage as { cost?: number })?.cost) || 0),
      0,
    ) || null,
  cases,
  rows,
};
writeFileSync(`${dir}/report.json`, JSON.stringify(artifact, null, 2) + "\n");
writeFileSync(`${dir}/prompts.json`, JSON.stringify(prompts, null, 2) + "\n");
console.log(
  JSON.stringify(
    { dir, metrics: artifact.metrics, groups: artifact.groups },
    null,
    2,
  ),
);
// Publication is deliberate: incomplete runs cannot replace the current page artifact.
if (!rows.some((r) => r.error))
  writeFileSync(
    `data/ai/evals/current_${label}.json`,
    JSON.stringify(artifact, null, 2) + "\n",
  );
else process.exitCode = 1;
