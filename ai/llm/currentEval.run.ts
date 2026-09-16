// node --env-file=.env.local --import tsx ai/llm/currentEval.run.ts baseline|revised
// Real production prompt + Gemini compatibility endpoint + server payload settings.
// Operator credentials; no public-proxy bypass. No cache; every run has unique provenance.
//
// Which groups run (default: the seven the published baselines cover):
//   EVAL_CASE_GROUPS=starter node --env-file=.env.local --import tsx \
//     ai/llm/currentEval.run.ts baseline
// A group-subset run NEVER replaces data/ai/evals/current_{baseline,revised}.json —
// that artifact is what ai/app/EvalsScreen.tsx renders as the product's routing
// score, and a starter-only corpus would silently restate its caseCount and
// metrics. Subset runs are written into their own run directory instead.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildToolSystemPrompt } from "../orchestrator/prompts";
import { routingMessages, ROUTING_BYTE_BUDGET } from "./promptBudget";
import { narrowCatalogueForBudget } from "./openrouter";
import { TOOLS } from "../tools/registry";
import {
  EVAL_GROUPS,
  LEGACY_GROUPS,
  type EvalGroup,
  registryEvalCases,
  evalUserContent,
  scoreProduction,
  summarize,
  type EvalCase,
  type EvalScore,
} from "./currentEval";
import { CHALLENGES, UNSUPPORTED } from "./currentEval.cases";
import { REALISTIC, CONVERSATIONS } from "./currentEval.realistic";
import { STARTER_CASES } from "./currentEval.starters";
const { payload, MODEL } = createRequire(import.meta.url)(
  "../../functions/llm_security.js",
);
const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY required; no evaluation performed");
const label = process.argv[2];
// Labels are ARTIFACT IDENTITIES, so a new run never inherits an old one's name. The
// two historical labels are the published before/after pair from 2026-09-10;
// `narrowed` is this plan's run, kept alongside them so the comparison exists.
const LABELS = ["baseline", "revised", "narrowed", "production"] as const;
if (!(LABELS as readonly string[]).includes(label))
  throw new Error(`Specify one of: ${LABELS.join(", ")}`);
// Which groups to run. The default is EXACTLY the suite the published baselines
// were measured on, for two reasons: the starter bank is 367 pairs, which would
// push this harness past its own >1000-call budget guard below, and mixing it in
// would move the denominator of the G1a accuracy threshold. Run the bank
// separately with EVAL_CASE_GROUPS=starter.
const FULL_GROUPS = LEGACY_GROUPS;
const requested = (process.env.EVAL_CASE_GROUPS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const unknown = requested.filter(
  (g) => !(EVAL_GROUPS as readonly string[]).includes(g),
);
if (unknown.length)
  throw new Error(
    `Unknown EVAL_CASE_GROUPS: ${unknown.join(", ")} (known: ${EVAL_GROUPS.join(", ")})`,
  );
const caseGroups: EvalGroup[] = requested.length
  ? (requested as EvalGroup[])
  : [...FULL_GROUPS];
const isFullSuite =
  caseGroups.length === FULL_GROUPS.length &&
  FULL_GROUPS.every((g) => caseGroups.includes(g));
const cases = [
  ...registryEvalCases(),
  ...CHALLENGES,
  ...UNSUPPORTED,
  ...REALISTIC,
  ...CONVERSATIONS,
  ...STARTER_CASES,
].filter((c) => caseGroups.includes(c.group));
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
// Forced only for the G1a run, which must narrow on EVERY case to have a sample large
// enough to judge the narrowed path. Unset = the production budget.
const forcedBudget = process.env.EVAL_ROUTING_BUDGET
  ? Number(process.env.EVAL_ROUTING_BUDGET)
  : undefined;
if (forcedBudget !== undefined && !Number.isFinite(forcedBudget))
  throw new Error("EVAL_ROUTING_BUDGET must be a number");
const requestFor = (c: EvalCase, lang: "en" | "bg") => {
  const userContent = evalUserContent(c, lang);
  const candidates = narrowCatalogueForBudget(
    c[lang],
    lang,
    userContent,
    forcedBudget,
  );
  return {
    messages: routingMessages(lang, candidates, userContent),
    // The gold-in-candidates rate: whether the tool the case EXPECTS survived
    // narrowing. Reported so a retrieval miss is separable from a model miss — the
    // plan's own requirement for this gate.
    candidatesKept: candidates?.length ?? null,
    goldInCandidates:
      candidates === undefined || !c.tool ? true : candidates.includes(c.tool),
    allowed: candidates ? new Set(candidates) : undefined,
  };
};
const tasks = cases.flatMap((c) =>
  (["en", "bg"] as const).map((lang) => ({ c, lang })),
);
if (tasks.length > 1000) throw new Error("Review request budget: >1000 calls");
const rows: (EvalScore & {
  ms: number;
  usage?: unknown;
  finishReason?: string;
  previousErrors?: string[];
  // Narrowing evidence, recorded per row so the gold-in-candidates rate can be
  // computed from the artifact rather than re-derived.
  candidatesKept?: number | null;
  goldInCandidates?: boolean;
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
    // Computed ONCE per task: the narrowing is deterministic, but it costs ~33 ms and
    // calling it twice would double that for no benefit.
    const built = requestFor(c, lang);
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
              // THE PRODUCTION COMPOSITION, not a hand-built prompt: the same
              // `narrowCatalogueForBudget` + `routingMessages` that `selectRoute`
              // sends, so this measures what a user actually gets. An earlier version
              // sent the full catalogue directly and could not exercise the narrowing
              // path at all.
              messages: built.messages,
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
      // The candidate set is threaded into the parse, as production does.
      ...scoreProduction(c, lang, raw, error, built.allowed),
      candidatesKept: built.candidatesKept,
      goldInCandidates: built.goldInCandidates,
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
  // Derived from the group set, so two artifacts covering different corpora are
  // never indistinguishable. `caseGroups` alone would be advisory.
  suiteVersion: `2026-09-10-v2-reviewed+${[...caseGroups].sort().join("+")}`,
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
  // Which groups this run covers. Without it a starter-bank run (367 pairs, no
  // published baseline) is indistinguishable from a G1a-eligible run.
  caseGroups,
  // Which budget the narrowing ran under, so a forced-budget run is never mistaken
  // for a production-shaped one.
  routingBudget: forcedBudget ?? ROUTING_BYTE_BUDGET,
  forcedBudget: forcedBudget !== undefined,
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
// Publication is deliberate: incomplete runs cannot replace the current page
// artifact, and NEITHER can a group-subset run. `current_{baseline,revised}.json`
// is what EvalsScreen renders as the product's routing score, so a starter-only
// corpus (caseCount 367, starter-only metrics) overwriting a full-suite artifact
// would restate the score with nothing in the file to notice.
if (rows.some((r) => r.error)) process.exitCode = 1;
else if (!isFullSuite) {
  writeFileSync(
    `${dir}/subset-report.json`,
    JSON.stringify(artifact, null, 2) + "\n",
  );
  console.log(
    `Group-subset run (${caseGroups.join(",")}) written to ${dir}/subset-report.json — ` +
      `NOT published over data/ai/evals/current_${label}.json.`,
  );
} else
  writeFileSync(
    `data/ai/evals/current_${label}.json`,
    JSON.stringify(artifact, null, 2) + "\n",
  );
