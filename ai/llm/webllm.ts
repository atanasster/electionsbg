// M3 — the WebLLM provider: a small open model runs in the browser (WebGPU) and
// drives tool selection + narration. It implements the same LLMProvider
// interface as the heuristic provider, so the chat UI is unchanged. Every model
// step is wrapped so any failure (parse error, model error) falls back to the
// deterministic router / template narrator — the chat never breaks.

import type {
  ChatCompletionMessageParam,
  InitProgressReport,
  MLCEngineInterface,
} from "@mlc-ai/web-llm";
import {
  buildContext,
  renderNarrationContext,
  renderRoutingContext,
  WEBLLM_BUDGET,
} from "../orchestrator/memory";
import { narrate } from "../orchestrator/narrate";
import {
  buildNarrationPrompt,
  buildToolSystemPrompt,
} from "../orchestrator/prompts";
import { resolveFollowOn, route, type Route } from "../orchestrator/router";
import { parseToolCall, toolSelectionSchema } from "../orchestrator/toolSchema";
import { runTool } from "../tools/registry";
import type { Lang, ToolArgs, ToolContext } from "../tools/types";
import { retrieveTools } from "./retrieve";
import { retrieveToolsSemantic } from "./semanticRetrieve";
import { buildAppConfig } from "./cache";
import { clarify, matchesLang, stripControl } from "./lang";
import type {
  ChatResponse,
  LLMProvider,
  ProviderStatus,
  RespondOpts,
  ResponseMeta,
} from "./provider";
import type { ModelOption } from "./models";

// Running token tally across a single response's model calls (routing +
// narration). The rules path contributes nothing.
type Usage = { input: number; output: number; tokPerSec?: number };

// Web-LLM returns usage on the completion (non-stream) and on the final stream
// chunk when stream_options.include_usage is set. `extra.decode_tokens_per_s`
// is present on recent builds; read everything defensively.
const addUsage = (
  usage: Usage,
  res:
    | {
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          extra?: { decode_tokens_per_s?: number };
        };
      }
    | undefined,
): void => {
  const u = res?.usage;
  if (!u) return;
  usage.input += u.prompt_tokens ?? 0;
  usage.output += u.completion_tokens ?? 0;
  const tps = u.extra?.decode_tokens_per_s;
  if (typeof tps === "number") usage.tokPerSec = Math.round(tps);
};

export const webgpuSupported = (): boolean =>
  typeof navigator !== "undefined" &&
  "gpu" in navigator &&
  (navigator as unknown as { gpu?: unknown }).gpu != null;

export class WebLLMProvider implements LLMProvider {
  id: string;
  label: { bg: string; en: string };
  private model: ModelOption;
  private engine: MLCEngineInterface | null = null;
  private worker: Worker | null = null;
  private state: ProviderStatus = "loading";

  constructor(model: ModelOption) {
    this.model = model;
    this.id = `webllm:${model.id}`;
    this.label = model.label;
    if (!webgpuSupported()) this.state = "unsupported";
  }

  status(): ProviderStatus {
    return this.state;
  }

  async init(onProgress?: (pct: number, note: string) => void): Promise<void> {
    if (!webgpuSupported()) {
      this.state = "unsupported";
      throw new Error("WebGPU not available in this browser");
    }
    this.state = "loading";
    try {
      const webllm = await import("@mlc-ai/web-llm");
      // The model runs in a Web Worker (webllm.worker.ts) rather than on the main
      // thread. Two reasons: (1) the multi-GB weight download + parse no longer
      // freezes the UI, and (2) cancelling an in-flight download means
      // worker.terminate() — CreateMLCEngine takes no AbortSignal in v0.2.84, so
      // the worker is the only way to actually stop the fetch. dispose() owns the
      // teardown. The chat.completions interface is identical, so respond() is
      // unchanged.
      //
      // Weights cache in IndexedDB, not the Cache API: HF serves large shards
      // through the Xet CDN (cas-bridge.xethub.hf.co) via a cross-origin
      // redirect that Cache.add() can't store (it throws + aborts the load).
      // buildAppConfig() centralizes this so the cache utils agree on the store.
      const appConfig = await buildAppConfig(this.model);
      this.worker = new Worker(new URL("./webllm.worker.ts", import.meta.url), {
        type: "module",
      });
      this.engine = await webllm.CreateWebWorkerMLCEngine(
        this.worker,
        this.model.id,
        {
          appConfig,
          initProgressCallback: (r: InitProgressReport) =>
            onProgress?.(Math.round((r.progress ?? 0) * 100), r.text ?? ""),
        },
      );
      this.state = "ready";
    } catch (e) {
      this.state = "error";
      this.dispose();
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  // Hard-stop and release the engine + worker. Terminating the worker aborts an
  // in-flight weight download (the only way to cancel one) and frees the WebGPU
  // buffers of a loaded model. Safe to call any time; the provider is discarded
  // after — the chat reverts to the rules engine.
  dispose(): void {
    try {
      this.worker?.terminate();
    } catch {
      /* worker already gone */
    }
    this.worker = null;
    this.engine = null;
  }

  private async selectRoute(
    question: string,
    ctx: ToolContext,
    usage: Usage,
    routingCtx: string,
  ) {
    // Deterministic router FIRST. It's regression-tested and reliable, whereas a
    // small on-device model mis-routes (e.g. it picked a turnout SERIES for
    // "turnout in 2023", or machine-voting for "compare the elections"). So a
    // confident rule always wins. Only a model explicitly trusted to route
    // (model.routes — a Bulgarian-capable model like BgGPT) is consulted, and
    // only to fill gaps the rules decline. Models with routes:false narrate only.
    const ruleRoute = route(question, ctx);
    if (ruleRoute || !this.engine) return ruleRoute;
    // EXPERIMENTAL constrained small-model router (off unless the model declares
    // constrainedRouter AND the runtime flag is set). Retrieve a few candidates,
    // hand the model a window-fitting compact prompt, and grammar-constrain the
    // pick. See the fc-eval ladder on /evals for why this is gated.
    if (this.constrainedRouterOn()) {
      const r = await this.constrainedRoute(question, ctx, usage);
      return r ?? ruleRoute;
    }
    if (!this.model.routes) return ruleRoute;
    const userContent = routingCtx
      ? `${routingCtx}\n\n${ctx.lang === "bg" ? "Текущ въпрос" : "Current question"}: ${question}`
      : question;
    try {
      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: buildToolSystemPrompt(ctx.lang) },
        { role: "user", content: userContent },
      ];
      const res = await this.engine.chat.completions.create({
        messages,
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object", schema: toolSelectionSchema() },
      });
      addUsage(usage, res);
      const content = res.choices?.[0]?.message?.content ?? "";
      return parseToolCall(content) ?? ruleRoute;
    } catch {
      return ruleRoute;
    }
  }

  // Is the experimental constrained router active? Capability on the model AND an
  // explicit runtime opt-in (untuned accuracy isn't production-grade — /evals).
  private constrainedRouterOn(): boolean {
    if (!this.model.constrainedRouter) return false;
    try {
      return (
        typeof localStorage !== "undefined" &&
        localStorage.getItem("naiasno:fg-router") === "1"
      );
    } catch {
      return false;
    }
  }

  // Constrained small-model routing: retrieve top-k candidate tools, give the
  // model compact declarations that fit the 512-token window, and grammar-force
  // the output to {"name": <one of the k>}. Returns the selected tool (args left
  // empty — the rules path fills args for matched intents; a future fine-tune can
  // emit args too). Any failure → null so the caller falls back to the rules.
  //
  // Candidates come from the SEMANTIC retriever (e5-base; recall@8 87% vs the
  // lexical retriever's 49% on the model's real input — see semanticRetrieve.ts).
  // If the embedder/vectors fail to load we fall back to the lexical retriever so
  // a model-load failure never breaks routing. k=8 fits the 512-token window with
  // compact declarations (verified on the /evals ladder).
  private async constrainedRoute(
    question: string,
    ctx: ToolContext,
    usage: Usage,
  ): Promise<Route> {
    if (!this.engine) return null;
    const K = 8;
    let picked = await retrieveToolsSemantic(question, K).catch(() => null);
    if (!picked || !picked.length) picked = retrieveTools(question, K);
    if (!picked.length) return null;
    const names = picked.map((t) => t.name);
    const decls = picked
      .map(
        (t) =>
          `<start_function_declaration>${JSON.stringify({
            name: t.name,
            description: t.description[ctx.lang] ?? t.description.en,
          })}<end_function_declaration>`,
      )
      .join("\n");
    try {
      const res = await this.engine.chat.completions.create({
        messages: [{ role: "user", content: `${decls}\n${question}` }],
        temperature: 0,
        max_tokens: 64,
        response_format: {
          type: "json_object",
          schema: JSON.stringify({
            type: "object",
            properties: { name: { type: "string", enum: names } },
            required: ["name"],
            additionalProperties: false,
          }),
        },
      });
      addUsage(usage, res);
      const content = res.choices?.[0]?.message?.content ?? "";
      const m = content.match(/"name"\s*:\s*"([^"]+)"/);
      const name = m?.[1];
      return name && names.includes(name) ? { tool: name, args: {} } : null;
    } catch {
      return null;
    }
  }

  private async narrateEnv(
    env: Parameters<typeof narrate>[0],
    lang: Lang,
    usage: Usage,
    onDelta?: (partial: string) => void,
    narrationCtx = "",
  ): Promise<{ text: string; fromModel: boolean }> {
    const template = narrate(env, lang);
    if (!this.engine) return { text: template, fromModel: false };
    const maxTokens = 320;
    // Language guard: small models often answer in English even when asked in
    // Bulgarian. The template narration is always in the right language, so if
    // the model's output isn't predominantly the requested script, use it.
    try {
      const { system, user } = buildNarrationPrompt(
        env,
        lang,
        narrationCtx || undefined,
      );
      const messages = [
        { role: "system" as const, content: system },
        { role: "user" as const, content: user },
      ];
      if (onDelta) {
        const stream = await this.engine.chat.completions.create({
          messages,
          temperature: 0.2,
          max_tokens: maxTokens,
          stream: true,
          stream_options: { include_usage: true },
        });
        let acc = "";
        for await (const chunk of stream) {
          addUsage(usage, chunk); // final chunk carries usage, empty choices
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (!delta) continue;
          acc += delta;
          // only surface tokens once it's clearly the right language, so we
          // never stream wrong-language text the guard would later discard.
          // strip control tokens so ChatML/Gemma markers never reach the UI.
          if (matchesLang(acc, lang)) onDelta(stripControl(acc));
        }
        const text = stripControl(acc);
        return text.length > 0 && matchesLang(text, lang)
          ? { text, fromModel: true }
          : { text: template, fromModel: false };
      }
      const res = await this.engine.chat.completions.create({
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
      });
      addUsage(usage, res);
      const text = stripControl(res.choices?.[0]?.message?.content ?? "");
      if (text.length > 0 && matchesLang(text, lang))
        return { text, fromModel: true };
      return { text: template, fromModel: false };
    } catch {
      return { text: template, fromModel: false };
    }
  }

  async respond(
    question: string,
    ctx: ToolContext,
    onDelta?: (partial: string) => void,
    opts?: RespondOpts,
  ): Promise<ChatResponse> {
    const t0 = performance.now();
    const usage: Usage = { input: 0, output: 0 };
    const meta = (narratedBy: "rules" | "model"): ResponseMeta => ({
      model: this.label,
      durationMs: performance.now() - t0,
      inputTokens: usage.input || undefined,
      outputTokens: usage.output || undefined,
      tokPerSec: usage.tokPerSec,
      narratedBy,
    });
    // Window + compact the conversation (tighter budget than cloud — small
    // in-browser models have short context windows). Routing context is only
    // used when this model is trusted to route; narration context always helps.
    const mem = buildContext(opts?.history ?? [], WEBLLM_BUDGET);
    const routingCtx = renderRoutingContext(mem, ctx.lang);
    const narrationCtx = renderNarrationContext(mem, ctx.lang);
    // A bare follow-on ("а ДПС?") reuses the prior tool with the new entity.
    const r =
      resolveFollowOn(question, opts?.prev) ??
      (await this.selectRoute(question, ctx, usage, routingCtx));
    if (!r) return { text: clarify(ctx.lang), env: null, meta: meta("rules") };
    try {
      const env = await runTool(r.tool, r.args, ctx);
      // A chooser env needs no prose — show its prompt (template) and let the UI
      // pop the disambiguation modal; skip the wasted model narration call.
      if (env.clarify)
        return {
          text: narrate(env, ctx.lang),
          env,
          tool: r.tool,
          args: r.args,
          meta: meta("rules"),
        };
      const { text, fromModel } = await this.narrateEnv(
        env,
        ctx.lang,
        usage,
        onDelta,
        narrationCtx,
      );
      return {
        text,
        env,
        tool: r.tool,
        args: r.args,
        meta: meta(fromModel ? "model" : "rules"),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        text:
          ctx.lang === "bg"
            ? `Възникна грешка при изпълнението: ${msg}`
            : `Something went wrong running that: ${msg}`,
        env: null,
        meta: meta("rules"),
      };
    }
  }

  // A disambiguation pick: run the pinned tool (no routing) and let the model
  // narrate, falling back to the template on any failure.
  async runChoice(
    tool: string,
    args: ToolArgs,
    ctx: ToolContext,
    onDelta?: (partial: string) => void,
  ): Promise<ChatResponse> {
    const t0 = performance.now();
    const usage: Usage = { input: 0, output: 0 };
    const meta = (narratedBy: "rules" | "model"): ResponseMeta => ({
      model: this.label,
      durationMs: performance.now() - t0,
      inputTokens: usage.input || undefined,
      outputTokens: usage.output || undefined,
      tokPerSec: usage.tokPerSec,
      narratedBy,
    });
    try {
      const env = await runTool(tool, args, ctx);
      if (env.clarify)
        return {
          text: narrate(env, ctx.lang),
          env,
          tool,
          args,
          meta: meta("rules"),
        };
      const { text, fromModel } = await this.narrateEnv(
        env,
        ctx.lang,
        usage,
        onDelta,
      );
      return {
        text,
        env,
        tool,
        args,
        meta: meta(fromModel ? "model" : "rules"),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        text:
          ctx.lang === "bg"
            ? `Възникна грешка при изпълнението: ${msg}`
            : `Something went wrong running that: ${msg}`,
        env: null,
        meta: meta("rules"),
      };
    }
  }
}
