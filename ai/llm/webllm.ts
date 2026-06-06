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
import { narrate } from "../orchestrator/narrate";
import {
  buildNarrationPrompt,
  buildToolSystemPrompt,
} from "../orchestrator/prompts";
import { route } from "../orchestrator/router";
import { parseToolCall, toolSelectionSchema } from "../orchestrator/toolSchema";
import { runTool } from "../tools/registry";
import type { Lang, ToolContext } from "../tools/types";
import { buildAppConfig } from "./cache";
import { clarify, matchesLang, stripControl } from "./lang";
import type {
  ChatResponse,
  LLMProvider,
  ProviderStatus,
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

  private async selectRoute(question: string, ctx: ToolContext, usage: Usage) {
    // Deterministic router FIRST. It's regression-tested and reliable, whereas a
    // small on-device model mis-routes (e.g. it picked a turnout SERIES for
    // "turnout in 2023", or machine-voting for "compare the elections"). So a
    // confident rule always wins. Only a model explicitly trusted to route
    // (model.routes — a Bulgarian-capable model like BgGPT) is consulted, and
    // only to fill gaps the rules decline. The Qwen test models narrate only.
    const ruleRoute = route(question, ctx);
    if (ruleRoute || !this.engine || !this.model.routes) return ruleRoute;
    try {
      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: buildToolSystemPrompt(ctx.lang) },
        { role: "user", content: question },
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

  private async narrateEnv(
    env: Parameters<typeof narrate>[0],
    lang: Lang,
    usage: Usage,
    onDelta?: (partial: string) => void,
  ): Promise<{ text: string; fromModel: boolean }> {
    const template = narrate(env, lang);
    if (!this.engine) return { text: template, fromModel: false };
    // Language guard: small models often answer in English even when asked in
    // Bulgarian. The template narration is always in the right language, so if
    // the model's output isn't predominantly the requested script, use it.
    try {
      const { system, user } = buildNarrationPrompt(env, lang);
      const messages = [
        { role: "system" as const, content: system },
        { role: "user" as const, content: user },
      ];
      if (onDelta) {
        const stream = await this.engine.chat.completions.create({
          messages,
          temperature: 0.2,
          max_tokens: 160,
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
        max_tokens: 160,
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
    const r = await this.selectRoute(question, ctx, usage);
    if (!r) return { text: clarify(ctx.lang), env: null, meta: meta("rules") };
    try {
      const env = await runTool(r.tool, r.args, ctx);
      const { text, fromModel } = await this.narrateEnv(
        env,
        ctx.lang,
        usage,
        onDelta,
      );
      return {
        text,
        env,
        tool: r.tool,
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
