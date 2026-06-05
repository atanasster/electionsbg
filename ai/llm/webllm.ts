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
import type { ChatResponse, LLMProvider, ProviderStatus } from "./provider";
import type { ModelOption } from "./models";

export const webgpuSupported = (): boolean =>
  typeof navigator !== "undefined" &&
  "gpu" in navigator &&
  (navigator as unknown as { gpu?: unknown }).gpu != null;

// Does the text use mostly the script the requested language expects? (bg ->
// Cyrillic, en -> Latin). Used to reject wrong-language model narration.
const matchesLang = (text: string, lang: Lang): boolean => {
  const cyr = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  const lat = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cyr + lat === 0) return true; // numbers/punctuation only — accept
  return lang === "bg" ? cyr >= lat : lat >= cyr;
};

const clarify = (lang: Lang): string =>
  lang === "bg"
    ? "Не съм сигурен какво питате. Опитайте напр.: „машинно гласуване в последните 7 избора“ или „кметът на Пловдив“."
    : 'I\'m not sure what you\'re asking. Try e.g.: "machine voting in the last 7 elections" or "the mayor of Plovdiv".';

export class WebLLMProvider implements LLMProvider {
  id: string;
  label: { bg: string; en: string };
  private model: ModelOption;
  private engine: MLCEngineInterface | null = null;
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
      // Cache weights in IndexedDB, not the Cache API. HF now serves large model
      // shards through the Xet CDN (cas-bridge.xethub.hf.co) via a cross-origin
      // redirect, which Cache.add() cannot store — it throws ("cache.add" error /
      // net::ERR_FAILED) and aborts the load. IndexedDB caching uses a plain
      // fetch + put that follows the redirect. Applies to prebuilt (Qwen) and
      // custom HF-hosted (BgGPT/EuroLLM) models alike.
      const baseConfig = this.model.appConfig ?? webllm.prebuiltAppConfig;
      const appConfig = { ...baseConfig, useIndexedDBCache: true };
      this.engine = await webllm.CreateMLCEngine(this.model.id, {
        appConfig,
        initProgressCallback: (r: InitProgressReport) =>
          onProgress?.(Math.round((r.progress ?? 0) * 100), r.text ?? ""),
      });
      this.state = "ready";
    } catch (e) {
      this.state = "error";
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  private async selectRoute(question: string, ctx: ToolContext) {
    // Deterministic router FIRST. It's regression-tested and reliable, whereas a
    // small on-device model mis-routes (e.g. it picked a 12-election turnout
    // SERIES for "turnout in 2023", which has a precise year). So a confident
    // rule wins; the model is only consulted to fill gaps the rules decline.
    // (Revisit this order once a stronger model like BgGPT is validated.)
    const ruleRoute = route(question, ctx);
    if (ruleRoute || !this.engine) return ruleRoute;
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
      const content = res.choices?.[0]?.message?.content ?? "";
      return parseToolCall(content) ?? ruleRoute;
    } catch {
      return ruleRoute;
    }
  }

  private async narrateEnv(
    env: Parameters<typeof narrate>[0],
    lang: Lang,
  ): Promise<string> {
    const template = narrate(env, lang);
    if (!this.engine) return template;
    try {
      const { system, user } = buildNarrationPrompt(env, lang);
      const res = await this.engine.chat.completions.create({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
        max_tokens: 160,
      });
      const text = res.choices?.[0]?.message?.content?.trim();
      // Language guard: small models often answer in English even when asked in
      // Bulgarian. The template narration is always in the right language, so if
      // the model's output isn't predominantly in the requested script, use it.
      if (text && text.length > 0 && matchesLang(text, lang)) return text;
      return template;
    } catch {
      return template;
    }
  }

  async respond(question: string, ctx: ToolContext): Promise<ChatResponse> {
    const r = await this.selectRoute(question, ctx);
    if (!r) return { text: clarify(ctx.lang), env: null };
    try {
      const env = await runTool(r.tool, r.args, ctx);
      const text = await this.narrateEnv(env, ctx.lang);
      return { text, env, tool: r.tool };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        text:
          ctx.lang === "bg"
            ? `Възникна грешка при изпълнението: ${msg}`
            : `Something went wrong running that: ${msg}`,
        env: null,
      };
    }
  }
}
