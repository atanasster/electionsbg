// Build the published eval artifact: data/ai/evals/fc_eval.json
//
//   npx tsx ai/llm/fcEval.artifact.ts
//
// The suite is DERIVED FROM THE REAL REGISTRY (fcEval.registry.ts): every tool,
// with its bilingual example as the paired EN/BG case. The goal is to verify
// routing among ALL registered tools, so cloud models are evaluated with the
// FULL tool set in context. Small in-browser models can't hold the full set, so
// FunctionGemma is evaluated with a retrieved candidate set (read from a browser
// capture). Cloud models are measured live (cheap, reproducible); rate-limited /
// unavailable models are recorded with a status + reason.
//
// Output → data/ai/evals/ which `npm run bucket:sync` ships to the GCS data
// bucket; the /evals page fetches it via fetchData("/ai/evals/fc_eval.json").

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  candidateTools,
  runFcEval,
  type FcCase,
  type FcReport,
  type FcTool,
  type LangReport,
} from "./fcEval";
import { makeCloudComplete, makeGeminiComplete } from "./fcEval.cloud";
import { registrySuite } from "./fcEval.registry";

const ROOT = process.cwd();
const OUT = join(ROOT, "data/ai/evals/fc_eval.json");
const CAPTURES = join(ROOT, "ai/llm/fcEval.captures");

// Load GEMINI_API_KEY from .env.local (overrides any stale shell value).
const loadGeminiEnv = (): void => {
  const f = join(ROOT, ".env.local");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
};

type ModelSpec = {
  id: string; // display id
  apiModel?: string; // model id for the API call (gemini-api only)
  label: string;
  runtime: "cloud" | "webllm";
  params: string;
  source: "cloud-live" | "gemini-api" | "capture" | "unavailable";
  via?: string; // measurement channel, shown on the page
  retrievedK?: number; // if set, model sees a retrieved candidate set, not the full registry
  captureFile?: string; // basename under CAPTURES (capture source only)
  note?: string;
  reason?: string;
  delayMs?: number; // pacing for rate-limited APIs
  concurrency?: number; // parallel in-flight calls (high for the rate-limit-free proxy)
};

// Per-model result cache (keyed by id) so re-runs never redo a finished model —
// the full-registry passes are slow. Gitignored (ai/llm/_fc_cache/). Set
// FC_EVAL_FORCE=1 to ignore the cache and re-measure everything.
const CACHE_DIR = join(ROOT, "ai/llm/_fc_cache");
const FORCE = process.env.FC_EVAL_FORCE === "1";
const cacheFileFor = (id: string) =>
  join(CACHE_DIR, id.replace(/[^a-z0-9]+/gi, "_") + ".json");
const readCachedReport = (id: string): FcReport | null => {
  const f = cacheFileFor(id);
  return !FORCE && existsSync(f)
    ? (JSON.parse(readFileSync(f, "utf8")) as FcReport)
    : null;
};
const writeCachedReport = (id: string, r: FcReport): void => {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cacheFileFor(id), JSON.stringify(r));
};

// Keep cloud ids in sync with functions/index.js + ai/llm/models.ts.
const SPECS: ModelSpec[] = [
  {
    id: "google/gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    runtime: "cloud",
    params: "—",
    source: "cloud-live",
    via: "OpenRouter proxy (production router)",
    concurrency: 6,
    note: "Production cloud router for the Наясно chat.",
  },
  {
    id: "google/gemma-4-31b-it",
    apiModel: "gemma-4-31b-it",
    label: "Gemma 4 31B",
    runtime: "cloud",
    params: "31B",
    source: "gemini-api",
    via: "Gemini API (generateContent)",
    delayMs: 1500,
    concurrency: 1,
    note: "Open model (the BgGPT base family). Gemma on the Gemini API has no system role / function-calling tools, so the ~104-tool list goes in one user turn and the JSON reply is parsed; measured sequentially with a per-call timeout to ride out the API's throughput limit on big prompts.",
  },
  {
    id: "functiongemma-270m-it-q4f32_1-MLC",
    label: "FunctionGemma 270M (in-browser, untuned)",
    runtime: "webllm",
    params: "270M",
    source: "capture",
    via: "in-browser (web-llm / WebGPU)",
    retrievedK: 8,
    captureFile: "functiongemma-270m-it-q4f32_1-MLC.json",
    reason:
      "Off-domain community build (no fine-tune on our tools, no grammar). Can't hold the full registry, so it's tested with a small retrieved candidate set (k=8). Even so it got 0/104 tools right in both languages (the ~2% is the irrelevance cases), barely emits valid JSON, and the wasm intermittently traps — an untuned 270M needs fine-tuning + constrained decoding before it can route at all.",
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
      domain?: string;
      expectedTool: string | null;
      en?: { toolOk: boolean; got: string | null };
      bg?: { toolOk: boolean; got: string | null };
    }
  >();
  for (const s of report.scores) {
    const e = byId.get(s.id) ?? {
      id: s.id,
      domain: s.domain,
      expectedTool: s.expectedTool,
    };
    e[s.lang] = { toolOk: s.toolOk, got: s.gotTool };
    byId.set(s.id, e);
  }
  return [...byId.values()];
};

const entry = (spec: ModelSpec, toolMode: string, report?: FcReport) => {
  const base = {
    id: spec.id,
    label: spec.label,
    runtime: spec.runtime,
    params: spec.params,
    via: spec.via,
    toolMode,
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
  loadGeminiEnv();
  const { tools, cases } = registrySuite();
  const forCase = (k?: number) =>
    k ? (c: FcCase, all: FcTool[]) => candidateTools(c, all, k) : undefined;
  const modeLabel = (k?: number) =>
    k ? `retrieved (k=${k})` : `full registry (${tools.length} tools)`;

  const models = [];
  for (const spec of SPECS) {
    const toolMode = modeLabel(spec.retrievedK);
    if (spec.source === "cloud-live" || spec.source === "gemini-api") {
      const cached = readCachedReport(spec.id);
      if (cached) {
        console.error(`cached ${spec.id}`);
        models.push(entry(spec, toolMode, cached));
        continue;
      }
      let key: string | undefined;
      if (spec.source === "gemini-api") {
        key = process.env.GEMINI_API_KEY;
        if (!key) {
          console.error(`no GEMINI_API_KEY for ${spec.id} — skipping`);
          models.push(
            entry(
              {
                ...spec,
                source: "unavailable",
                reason: "GEMINI_API_KEY missing",
              },
              toolMode,
            ),
          );
          continue;
        }
      }
      console.error(
        `measuring ${spec.id} (full set, concurrency ${spec.concurrency ?? 1})…`,
      );
      const complete =
        spec.source === "gemini-api"
          ? makeGeminiComplete(spec.apiModel ?? spec.id, key!, {
              delayMs: spec.delayMs,
            })
          : makeCloudComplete(spec.id, { delayMs: spec.delayMs });
      const report = await runFcEval(complete, {
        tools,
        cases,
        toolsForCase: forCase(spec.retrievedK),
        concurrency: spec.concurrency,
      });
      writeCachedReport(spec.id, report);
      models.push(entry(spec, toolMode, report));
    } else if (spec.source === "capture") {
      const f = join(CAPTURES, spec.captureFile ?? "");
      if (existsSync(f)) {
        console.error(`reading capture ${spec.captureFile}`);
        models.push(
          entry(
            spec,
            toolMode,
            JSON.parse(readFileSync(f, "utf8")) as FcReport,
          ),
        );
      } else {
        console.error(`no capture for ${spec.id} (${f})`);
        models.push(entry(spec, toolMode));
      }
    } else {
      console.error(`skipping ${spec.id} (${spec.reason})`);
      models.push(entry(spec, toolMode));
    }
  }

  const relevant = cases.filter((c) => c.tool !== null).length;
  const artifact = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    harness: "ai/llm/fcEval.ts (suite derived from ai/tools/registry.ts)",
    method: {
      toolCount: tools.length,
      caseCount: cases.length,
      relevantCases: relevant,
      irrelevanceCases: cases.length - relevant,
      promptStrategy: {
        cloud:
          "JSON-mode + a tool-listing system prompt (mirrors the production router)",
        gemini:
          "Gemma on the Gemini API: tool list + query in one user turn (no system role / tools), JSON reply parsed",
        webllm: "FunctionGemma native function-declaration tokens",
      },
      scoring:
        "tool SELECTION accuracy — exact registry tool name (normalized); irrelevance = no call. Registry examples carry no annotated args, so argument accuracy is not scored (n/a).",
      coverageNote:
        "Cases are every registry tool's first bilingual example (EN+BG). Cloud models see the FULL tool set in context (route among all tools); small in-browser models see a retrieved candidate set (the realistic two-stage architecture).",
    },
    tools: tools.map((t) => ({
      name: t.name,
      domain: t.domain,
      description: t.description,
      params: Object.keys(t.parameters.properties),
    })),
    cases: cases.map((c) => ({
      id: c.id,
      domain: c.domain,
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
    `\nwrote ${OUT}\n  ${tools.length} tools · ${cases.length} cases · ${measured}/${models.length} models measured`,
  );
};

main();
