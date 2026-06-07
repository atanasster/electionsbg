// Build the published eval artifact: data/ai/evals/fc_eval.json
//
//   npx tsx ai/llm/fcEval.artifact.ts
//
// Composes the methodology + tool/case catalogue + per-model results into one
// versioned JSON. Cloud models are measured live (cheap, reproducible); the
// in-browser FunctionGemma result is read from a capture written by the browser
// run (ai/llm/fcEval.captures/<id>.json — outside data/ so it isn't deployed);
// rate-limited / unavailable models are recorded with a status + reason.
//
// Output goes to data/ai/evals/ which `npm run bucket:sync` ships to the GCS data
// bucket; the /evals page fetches it via fetchData("/ai/evals/fc_eval.json").

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FC_CASES, FC_TOOLS, type FcReport, type LangReport } from "./fcEval";
import { runCloudModel } from "./fcEval.cloud";

const ROOT = process.cwd();
const OUT = join(ROOT, "data/ai/evals/fc_eval.json");
const CAPTURES = join(ROOT, "ai/llm/fcEval.captures");
const K = Number(process.env.FC_EVAL_K) || 5;

type ModelSpec = {
  id: string;
  label: string;
  runtime: "cloud" | "webllm";
  params: string;
  source: "cloud-live" | "capture" | "unavailable";
  captureFile?: string; // basename under CAPTURES (capture source only)
  note?: string;
  reason?: string; // why unavailable / caveat
  delayMs?: number; // cloud pacing for free tiers
};

// Keep in sync with the cloud allowlist (functions/index.js) + ai/llm/models.ts.
const SPECS: ModelSpec[] = [
  {
    id: "google/gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    runtime: "cloud",
    params: "—",
    source: "cloud-live",
    note: "Production cloud router for the Наясно chat.",
  },
  {
    id: "google/gemma-4-31b-it:free",
    label: "Gemma 4 31B (free)",
    runtime: "cloud",
    params: "31B",
    source: "unavailable",
    reason:
      "OpenRouter free-tier daily rate limit (429 on every call). Re-run on a paid tier with FC_EVAL_DELAY_MS pacing.",
  },
  {
    id: "functiongemma-270m-it-q4f32_1-MLC",
    label: "FunctionGemma 270M (in-browser, untuned)",
    runtime: "webllm",
    params: "270M",
    source: "capture",
    captureFile: "functiongemma-270m-it-q4f32_1-MLC.json",
    reason:
      "Off-domain community build (no fine-tune on our tools, no grammar-constrained decoding). Runtime/format probe only.",
  },
];

const slim = (l: LangReport) => ({
  toolAcc: l.toolAcc,
  argAcc: l.argAcc,
  jsonValidRate: l.jsonValidRate,
  irrelevanceAcc: l.irrelevanceAcc,
});

const perCase = (report: FcReport) => {
  const byId = new Map<
    string,
    {
      id: string;
      expectedTool: string | null;
      en?: { toolOk: boolean; argsOk: boolean; got: string | null };
      bg?: { toolOk: boolean; argsOk: boolean; got: string | null };
    }
  >();
  for (const s of report.scores) {
    const e = byId.get(s.id) ?? { id: s.id, expectedTool: s.expectedTool };
    e[s.lang] = { toolOk: s.toolOk, argsOk: s.argsOk, got: s.gotTool };
    byId.set(s.id, e);
  }
  return [...byId.values()];
};

const entry = (spec: ModelSpec, report?: FcReport) => {
  const base = {
    id: spec.id,
    label: spec.label,
    runtime: spec.runtime,
    params: spec.params,
    note: spec.note,
    reason: spec.reason,
  };
  if (!report)
    return {
      ...base,
      status: spec.source === "unavailable" ? "unavailable" : "missing-capture",
      perLang: null,
      degradation: null,
      perCase: [],
    };
  return {
    ...base,
    status: "measured",
    perLang: { en: slim(report.perLang.en), bg: slim(report.perLang.bg) },
    degradation: report.degradation,
    perCase: perCase(report),
  };
};

const main = async () => {
  const models = [];
  for (const spec of SPECS) {
    if (spec.source === "cloud-live") {
      console.error(`measuring ${spec.id} (live)…`);
      const report = await runCloudModel(spec.id, K, { delayMs: spec.delayMs });
      models.push(entry(spec, report));
    } else if (spec.source === "capture") {
      const f = join(CAPTURES, spec.captureFile ?? "");
      if (existsSync(f)) {
        console.error(`reading capture ${spec.captureFile}`);
        models.push(
          entry(spec, JSON.parse(readFileSync(f, "utf8")) as FcReport),
        );
      } else {
        console.error(`no capture for ${spec.id} (${f})`);
        models.push(entry(spec));
      }
    } else {
      console.error(`skipping ${spec.id} (${spec.reason})`);
      models.push(entry(spec));
    }
  }

  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    harness: "ai/llm/fcEval.ts",
    method: {
      candidateSetK: K,
      caseCount: FC_CASES.length,
      toolCount: FC_TOOLS.length,
      promptStrategy: {
        cloud:
          "JSON-mode + a tool-listing system prompt (mirrors the production router)",
        webllm: "FunctionGemma native function-declaration tokens",
      },
      scoring:
        "exact tool name (normalized); lenient cross-script argument containment; irrelevance = no call emitted",
      candidateSetNote:
        "Each case is asked with the correct tool + (k-1) deterministic distractors, simulating two-stage tool retrieval (small models collapse if all tools are in-context at once).",
    },
    tools: FC_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      params: Object.keys(t.parameters.properties),
    })),
    cases: FC_CASES.map((c) => ({
      id: c.id,
      en: c.en,
      bg: c.bg,
      expectedTool: c.tool,
    })),
    models,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n");
  const measured = models.filter((m) => m.status === "measured").length;
  console.error(
    `\nwrote ${OUT}\n  ${measured}/${models.length} models measured`,
  );
};

main();
