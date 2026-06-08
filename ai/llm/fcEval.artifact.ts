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
  modeNote?: string; // appended to the toolMode column (e.g. "grammar", "compact decl")
  captureFile?: string; // basename under CAPTURES (capture source only)
  note?: string;
  reason?: string;
  delayMs?: number; // pacing for rate-limited APIs
  concurrency?: number; // parallel in-flight calls (high for the rate-limit-free proxy)
  maxOutputTokens?: number; // gemini-api output budget (raise to avoid CoT truncation)
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
    label: "Gemma 4 31B (640-tok budget)",
    runtime: "cloud",
    params: "31B",
    source: "gemini-api",
    via: "Gemini API (generateContent)",
    delayMs: 1500,
    concurrency: 1,
    maxOutputTokens: 640,
    modeNote: "640-tok output",
    note: "Open model (BgGPT base family). Gemma on the Gemini API has no system role / function-calling tools, so the ~107-tool list goes in one user turn and the JSON reply is parsed. CAVEAT (verified from raw output): no API failures (0/208 empty), but the ~49% that emit no valid JSON are NOT wrong-tool picks — they are verbose chain-of-thought TRUNCATED at the 640-token cap (88% of failures sit at the ceiling; 100% name the correct tool in their reasoning). So this row understates the model; see the 1536-tok row for the recovery.",
  },
  {
    id: "google/gemma-4-31b-it-1536",
    apiModel: "gemma-4-31b-it",
    label: "Gemma 4 31B (1536-tok budget)",
    runtime: "cloud",
    params: "31B",
    source: "gemini-api",
    via: "Gemini API (generateContent)",
    delayMs: 1500,
    concurrency: 1,
    maxOutputTokens: 1536,
    modeNote: "1536-tok output",
    note: "Same model + prompt as the 640-tok row, only the output budget raised to 1536 so the chain-of-thought can finish and emit the closing JSON. Result: routing jumps to EN 81% / BG 83% (from 54% / 50% at 640) — a ~28pt recovery, still 0 empty responses — confirming the 640 failures were CoT TRUNCATION, not wrong-tool picks. The BG<EN gap also REVERSES (BG was worse at 640 only because its longer CoT truncated more), so there is no real Bulgarian tool-selection penalty once the budget fits.",
  },
  // ---- FunctionGemma-270M in-browser, an ablation LADDER (untuned community
  // build) showing how far the SAME model can be pushed with infra alone — no
  // fine-tune. Each row is a separate in-browser run captured 2026-06-08
  // (web-llm 0.2.84 / WebGPU, raw output preserved; harness ai/llm/fcEval.browser.ts).
  // The progression is the point: baseline 0% → fit the prompt → constrain
  // decoding → 37% at k=3 (vs ~33% chance), 18% at k=8 (vs ~12.5% chance).
  {
    id: "functiongemma-270m-it-q4f32_1-MLC",
    label: "FunctionGemma 270M — baseline (k=8, free)",
    runtime: "webllm",
    params: "270M",
    source: "capture",
    via: "in-browser (web-llm / WebGPU)",
    retrievedK: 8,
    modeNote: "full decl · free decode",
    captureFile: "functiongemma-270m-it-q4f32_1-MLC.json",
    note: "Baseline: the published config — k=8 full JSON tool declarations, native FunctionGemma tokens, free (unconstrained) decoding.",
    reason:
      "0/214 in both languages — but raw output (see the capture's failureBreakdown) shows WHY: ~68% (146/214) trap with a wasm 'RuntimeError: unreachable' BEFORE emitting a token — the k=8 tool-declaration prompt (~2–3k chars, ~700–900 tokens) overflows this build's 512-token sliding-window KV cache at prefill ('KV cache is full'). The other ~32% run but emit degenerate output (empty {}, repeated tokens, hallucinated names); none is a coherent tool selection. So the 0/N is a context-window/runtime limit (can't process the prompt), NOT wrong-tool routing.",
  },
  {
    id: "functiongemma-270m-it-q4f32_1-MLC.k3-free",
    label: "FunctionGemma 270M — fit prompt (k=3, free)",
    runtime: "webllm",
    params: "270M",
    source: "capture",
    via: "in-browser (web-llm / WebGPU)",
    retrievedK: 3,
    modeNote: "full decl · free decode",
    captureFile: "functiongemma-270m-it-q4f32_1-MLC.k3-free.json",
    note: "Lever 1 — shrink the candidate set to k=3 so the prompt (~700–1200 chars) fits the 512-token window.",
    reason:
      "Fitting the prompt ELIMINATES the traps (0 engine-errors, vs 68% at k=8) — the model now runs on every case. But free decoding still yields ~1% correct: it hallucinates plausible-but-fake tool names (machine_comparison, election_results) and malformed JSON. Fitting the window is necessary but not sufficient.",
  },
  {
    id: "functiongemma-270m-it-q4f32_1-MLC.k3-grammar",
    label: "FunctionGemma 270M — fit + grammar (k=3)",
    runtime: "webllm",
    params: "270M",
    source: "capture",
    via: "in-browser (web-llm / WebGPU)",
    retrievedK: 3,
    modeNote: "grammar (name∈candidates)",
    captureFile: "functiongemma-270m-it-q4f32_1-MLC.k3-grammar.json",
    note: 'Lever 2 — constrain decoding (XGrammar / response_format) so the output MUST be {"name": <one of the k candidates>}.',
    reason:
      "Grammar is the decisive lever: forcing a real candidate name lifts routing to 37% (80/214) — well above the ~33% chance for k=3 — with 100% valid JSON and 0 garbage. Errors are semantically adjacent (nationalResults→machineVoteSeries). NOTE: hard-constraining to the candidate enum means the model can no longer abstain, so off-topic ('call nothing') detection drops to 0 — production would add a 'no_tool' sentinel to the enum.",
  },
  {
    id: "functiongemma-270m-it-q4f32_1-MLC.k8-compact-grammar",
    label: "FunctionGemma 270M — route-among-8 (k=8 compact + grammar)",
    runtime: "webllm",
    params: "270M",
    source: "capture",
    via: "in-browser (web-llm / WebGPU)",
    retrievedK: 8,
    modeNote: "compact decl · grammar",
    captureFile: "functiongemma-270m-it-q4f32_1-MLC.k8-compact-grammar.json",
    note: "Lever 3 — compact {name, description} declarations let k=8 fit the window (~1.2k chars), with grammar. The realistic 'route among many' test.",
    reason:
      "At k=8 (chance ~12.5%) the model still beats chance at 18% (39/214) with no traps — but a real EN>BG gap opens (EN ~23% vs BG ~13%), the bilingual degradation this eval was built to surface. Untuned, routing-among-many is above chance but far from usable; this is the gap a domain fine-tune must close.",
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
    const toolMode =
      modeLabel(spec.retrievedK) + (spec.modeNote ? ` · ${spec.modeNote}` : "");
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
              maxOutputTokens: spec.maxOutputTokens,
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
        webllm:
          "FunctionGemma native declaration tokens. The 270M rows are an ablation LADDER on the SAME untuned model: candidate set k=8 vs k=3, full vs compact declarations, and free vs grammar-constrained (XGrammar, name∈candidates) decoding — isolating how much infra alone (no fine-tune) recovers.",
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
