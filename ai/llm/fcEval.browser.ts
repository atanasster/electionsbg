// In-browser FunctionGemma eval WITH raw-output capture + failure classification.
//
// WHY THIS EXISTS: the published capture (fcEval.captures/*.json) only stored
// aggregate scores — `scores: []` — so a 0/104 result could NOT be told apart
// from "the wasm trapped / produced nothing" vs "the model emitted a (wrong)
// tool call". This module re-runs the SAME suite the artifact uses (registry
// cases, retrieved candidate set, FunctionGemma native declaration tokens) but
// records, per case: the EXACT raw model text, whether the engine call THREW or
// TIMED OUT, the parsed tool call, and a failure CLASS:
//
//   correct        — parsed a tool call whose name == expected
//   wrong-tool     — parsed a tool call, wrong/hallucinated name  (REAL tool-call error)
//   no-json        — non-empty output, but no parseable tool call (model ran, bad output)
//   empty          — engine returned empty/whitespace               (did not really process)
//   engine-error   — the create() call threw (e.g. KV-cache-full → wasm "unreachable")
//   timeout        — the call hung past the budget (engine wedged)  (did not process)
//   irrelevance-ok — off-topic probe, correctly called nothing
//   irrelevance-bad— off-topic probe, wrongly emitted a call
//
// Only `wrong-tool` (and `no-json`, weakly) is genuine model tool-call
// behaviour; `empty`/`engine-error`/`timeout` are "unable to process the
// prompt". That distinction is the whole question.
//
// ROBUSTNESS: the engine runs in a Web Worker so a long/looping generation can't
// freeze the page (and preview_eval stays responsive). Each call is raced
// against a timeout; on a throw OR timeout the worker engine is torn down and
// recreated (cheap — weights are already in IndexedDB) so one bad prompt can't
// cascade. Results are mirrored to localStorage after every case so a renderer
// crash / reload never loses the run.
//
// Drive it from the dev page (preview_eval): import this module by its Vite URL,
// call run(), and poll window.__fgState (the run is fire-and-forget).

import * as webllm from "@mlc-ai/web-llm";
import { buildAppConfig } from "./cache";
import {
  buildFunctionGemmaUser,
  candidateTools,
  parseToolCall,
  scoreCase,
  type FcCase,
  type FcTool,
} from "./fcEval";
import { registrySuite } from "./fcEval.registry";
import { modelById } from "./models";

const MODEL_ID = "functiongemma-270m-it-q4f32_1-MLC";
const LS_KEY = "__fgEvalResults";

export type FailClass =
  | "correct"
  | "wrong-tool"
  | "no-json"
  | "empty"
  | "engine-error"
  | "timeout"
  | "irrelevance-ok"
  | "irrelevance-bad";

export type RawCaseResult = {
  id: string;
  domain?: string;
  lang: "en" | "bg";
  expectedTool: string | null;
  query: string;
  promptChars: number;
  raw: string;
  rawLen: number;
  threw: boolean;
  timedOut: boolean;
  errorMsg?: string;
  gotTool: string | null;
  jsonValid: boolean;
  toolOk: boolean;
  klass: FailClass;
  recreated: boolean; // engine was rebuilt after this case (trap/timeout recovery)
  ms: number;
};

type StateShape = {
  phase: "loading" | "running" | "done" | "error";
  loadPct: number;
  loadNote: string;
  done: number;
  total: number;
  recreations: number;
  k: number;
  maxTokens: number;
  grammar: boolean;
  compact: boolean;
  results: RawCaseResult[];
  summary?: ReturnType<typeof summarize>;
  error?: string;
  startedAt: number;
};

// Compact declarations: native FunctionGemma tokens but only {name, short
// description} — no params schema. ~80–120 chars/tool vs ~250–425 for the full
// JSON, so k=8 fits the 512-token sliding-window KV cache (full declarations
// overflow it and trap). Lets us test routing-among-many without recompiling.
const buildCompactUser = (tools: FcTool[], query: string): string => {
  const decls = tools
    .map((t) => {
      const desc = (t.description ?? "").slice(0, 60);
      return `<start_function_declaration>${JSON.stringify({ name: t.name, description: desc })}<end_function_declaration>`;
    })
    .join("\n");
  return `${decls}\n${query}`;
};

const classify = (
  expected: string | null,
  threw: boolean,
  timedOut: boolean,
  raw: string,
  parsed: { name: string } | null,
  toolOk: boolean,
): FailClass => {
  if (expected === null)
    return parsed === null ? "irrelevance-ok" : "irrelevance-bad";
  if (timedOut) return "timeout";
  if (threw) return "engine-error";
  if (!raw.trim()) return "empty";
  if (parsed === null) return "no-json";
  return toolOk ? "correct" : "wrong-tool";
};

const summarize = (results: RawCaseResult[]) => {
  const byClass: Record<string, number> = {};
  for (const r of results) byClass[r.klass] = (byClass[r.klass] ?? 0) + 1;
  const perLang = (lang: "en" | "bg") => {
    const s = results.filter((r) => r.lang === lang);
    const relevant = s.filter((r) => r.expectedTool !== null);
    const irr = s.filter((r) => r.expectedTool === null);
    const cnt = (kls: FailClass) =>
      relevant.filter((r) => r.klass === kls).length;
    return {
      n: s.length,
      relevant: relevant.length,
      toolAcc: s.length ? s.filter((r) => r.toolOk).length / s.length : 0,
      jsonValidRate: relevant.length
        ? relevant.filter((r) => r.jsonValid).length / relevant.length
        : 0,
      irrelevanceAcc: irr.length
        ? irr.filter((r) => r.toolOk).length / irr.length
        : null,
      // the breakdown that answers the question, over RELEVANT cases:
      didNotProcess: cnt("engine-error") + cnt("empty") + cnt("timeout"),
      engineError: cnt("engine-error"),
      timeout: cnt("timeout"),
      empty: cnt("empty"),
      noJson: cnt("no-json"), // ran, malformed output
      wrongTool: cnt("wrong-tool"), // ran, parseable WRONG tool (real tool-call error)
      correct: cnt("correct"),
    };
  };
  return { byClass, en: perLang("en"), bg: perLang("bg") };
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`__timeout_${ms}ms__`)), ms),
    ),
  ]);

export const run = async (opts?: {
  k?: number;
  limit?: number;
  maxTokens?: number;
  callTimeoutMs?: number;
  // grammar: constrain output to {"name": <one of the k candidate tools>} via a
  // JSON-schema response_format (XGrammar). Forces a real candidate pick instead
  // of a hallucinated name / malformed JSON — isolates pure routing ability.
  grammar?: boolean;
  // compact: use short {name, description} declarations so a larger k fits the
  // 512-token window (full JSON declarations overflow it and trap).
  compact?: boolean;
}): Promise<void> => {
  const k = opts?.k ?? 8;
  const maxTokens = opts?.maxTokens ?? 128;
  const callTimeoutMs = opts?.callTimeoutMs ?? 25000;
  const grammar = opts?.grammar ?? false;
  const compact = opts?.compact ?? false;
  const w = window as unknown as { __fgState: StateShape };
  const state: StateShape = {
    phase: "loading",
    loadPct: 0,
    loadNote: "",
    done: 0,
    total: 0,
    recreations: 0,
    k,
    maxTokens,
    grammar,
    compact,
    results: [],
    startedAt: performance.now(),
  };
  w.__fgState = state;

  const model = modelById(MODEL_ID);
  if (!model) {
    state.phase = "error";
    state.error = `model ${MODEL_ID} not in registry`;
    return;
  }
  const appConfig = await buildAppConfig(model);

  let worker: Worker | null = null;
  let engine: webllm.MLCEngineInterface | null = null;
  // Returns a fresh worker + engine; the caller assigns them in run()'s body so
  // control-flow typing tracks worker/engine (not narrowed away by the closure).
  const newEngine = async (): Promise<[Worker, webllm.MLCEngineInterface]> => {
    const wk = new Worker(new URL("./webllm.worker.ts", import.meta.url), {
      type: "module",
    });
    const eng = await webllm.CreateWebWorkerMLCEngine(wk, MODEL_ID, {
      appConfig,
      initProgressCallback: (r) => {
        state.loadPct = Math.round((r.progress ?? 0) * 100);
        state.loadNote = r.text ?? "";
      },
    });
    return [wk, eng];
  };

  try {
    [worker, engine] = await newEngine();

    const { tools, cases } = registrySuite();
    const all: FcTool[] = tools;
    let testCases: FcCase[] = cases;
    if (opts?.limit) testCases = testCases.slice(0, opts.limit);

    const tasks: { c: FcCase; lang: "en" | "bg" }[] = [];
    for (const c of testCases)
      for (const lang of ["en", "bg"] as const) tasks.push({ c, lang });
    state.total = tasks.length;
    state.phase = "running";

    for (const { c, lang } of tasks) {
      const picked = candidateTools(c, all, k);
      const query = c[lang];
      const user = compact
        ? buildCompactUser(picked, query)
        : buildFunctionGemmaUser(picked, query);
      // grammar mode: mask logits to EXACTLY {"name": <one of these k tools>}.
      // name-only (no free `arguments` object) — a free args object lets the tiny
      // model spiral into repeated-key garbage and hit max_tokens before closing
      // the JSON, which then fails to parse even though the routing decision (the
      // name) was correct. Routing is the metric here, so constrain to just it.
      const responseFormat = grammar
        ? {
            type: "json_object" as const,
            schema: JSON.stringify({
              type: "object",
              properties: {
                name: { type: "string", enum: picked.map((t) => t.name) },
              },
              required: ["name"],
              additionalProperties: false,
            }),
          }
        : undefined;
      const t0 = performance.now();
      let raw = "";
      let threw = false;
      let timedOut = false;
      let errorMsg: string | undefined;
      let recreated = false;
      try {
        const res = await withTimeout(
          engine!.chat.completions.create({
            messages: [{ role: "user", content: user }],
            temperature: 0,
            max_tokens: maxTokens,
            ...(responseFormat ? { response_format: responseFormat } : {}),
          }),
          callTimeoutMs,
        );
        raw = res.choices?.[0]?.message?.content ?? "";
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errorMsg = msg.slice(0, 300);
        if (msg.startsWith("__timeout_")) timedOut = true;
        else threw = true;
        // The wasm may be left in a bad state after a fatal trap / a wedge;
        // rebuild the worker engine so the next case starts clean.
        recreated = true;
        state.recreations += 1;
        try {
          worker?.terminate();
        } catch {
          /* already gone */
        }
        try {
          [worker, engine] = await newEngine();
        } catch (re) {
          state.phase = "error";
          state.error = `engine rebuild failed: ${re instanceof Error ? re.message : String(re)}`;
          return;
        }
      }
      const ms = Math.round(performance.now() - t0);
      const score = scoreCase(c, lang, raw);
      const parsed = parseToolCall(raw);
      const klass = classify(
        c.tool,
        threw,
        timedOut,
        raw,
        parsed,
        score.toolOk,
      );
      state.results.push({
        id: c.id,
        domain: c.domain,
        lang,
        expectedTool: c.tool,
        query,
        promptChars: user.length,
        raw,
        rawLen: raw.length,
        threw,
        timedOut,
        errorMsg,
        gotTool: score.gotTool,
        jsonValid: score.jsonValid,
        toolOk: score.toolOk,
        klass,
        recreated,
        ms,
      });
      state.done += 1;
      try {
        localStorage.setItem(
          LS_KEY,
          JSON.stringify({
            done: state.done,
            total: state.total,
            k,
            maxTokens,
            results: state.results,
          }),
        );
      } catch {
        /* quota — keep going, in-memory state is the source of truth */
      }
    }

    state.summary = summarize(state.results);
    state.phase = "done";
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          done: state.done,
          total: state.total,
          k,
          maxTokens,
          summary: state.summary,
          results: state.results,
        }),
      );
    } catch {
      /* ignore */
    }
  } catch (e) {
    state.phase = "error";
    state.error =
      e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  } finally {
    try {
      worker?.terminate();
    } catch {
      /* ignore */
    }
  }
};

// Build an FcReport-shaped capture from the finished run (perLang + degradation
// + per-case scores), LEAN (no raw text) so it returns inline and can be written
// straight to a fcEval.captures/*.json the artifact builder ingests. Carries the
// run config + the failure-class breakdown so each published variant row is
// self-documenting. Call after phase === "done".
export const captureReport = (): unknown => {
  const s = (window as unknown as { __fgState: StateShape }).__fgState;
  const langReport = (lang: "en" | "bg") => {
    const rows = s.results.filter((r) => r.lang === lang);
    const rel = rows.filter((r) => r.expectedTool !== null);
    const irr = rows.filter((r) => r.expectedTool === null);
    return {
      lang,
      n: rows.length,
      toolAcc: rows.length
        ? rows.filter((r) => r.toolOk).length / rows.length
        : 0,
      argAcc: null,
      jsonValidRate: rel.length
        ? rel.filter((r) => r.jsonValid).length / rel.length
        : 0,
      irrelevanceAcc: irr.length
        ? irr.filter((r) => r.toolOk).length / irr.length
        : null,
    };
  };
  const en = langReport("en");
  const bg = langReport("bg");
  const rel = s.results.filter((r) => r.expectedTool !== null);
  const cnt = (kls: FailClass) => rel.filter((r) => r.klass === kls).length;
  return {
    config: {
      k: s.k,
      maxTokens: s.maxTokens,
      grammar: s.grammar,
      compact: s.compact,
    },
    perLang: { en, bg },
    degradation: { toolAcc: en.toolAcc - bg.toolAcc, argAcc: null },
    failureBreakdown: {
      relevantCases: rel.length,
      engineErrorTrap: cnt("engine-error"),
      timeout: cnt("timeout"),
      empty: cnt("empty"),
      noJson: cnt("no-json"),
      wrongTool: cnt("wrong-tool"),
      correct: cnt("correct"),
    },
    scores: s.results.map((r) => ({
      id: r.id,
      lang: r.lang,
      domain: r.domain,
      expectedTool: r.expectedTool,
      gotTool: r.gotTool,
      jsonValid: r.jsonValid,
      toolOk: r.toolOk,
      argsOk: false,
      argScored: false,
      klass: r.klass,
    })),
  };
};

// Expose for preview_eval-driven runs.
(
  window as unknown as {
    __fgRun: typeof run;
    __fgCapture: typeof captureReport;
  }
).__fgRun = run;
(
  window as unknown as {
    __fgRun: typeof run;
    __fgCapture: typeof captureReport;
  }
).__fgCapture = captureReport;
