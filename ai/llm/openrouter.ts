// Cloud provider — a hosted model (via the Firebase Function proxy → OpenRouter)
// drives tool selection AND narration. It implements the same LLMProvider
// interface as the rules + WebGPU providers, so it's just another option in the
// model dropdown; the rules engine stays the default. Every model step falls
// back to the deterministic router / template narrator, so a network or API
// failure never breaks the chat. The model only ever picks {tool, args} and
// writes prose from the tool's facts — the numbers are always computed.

import { narrate } from "../orchestrator/narrate";
import {
  buildNarrationPrompt,
  buildToolSystemPrompt,
} from "../orchestrator/prompts";
import { route } from "../orchestrator/router";
import { parseToolCall } from "../orchestrator/toolSchema";
import { runTool } from "../tools/registry";
import type { Lang, ToolContext } from "../tools/types";
import { clarify, matchesLang, stripControl } from "./lang";
import type { ModelOption } from "./models";
import type {
  ChatResponse,
  LLMProvider,
  ProviderStatus,
  ResponseMeta,
} from "./provider";

// Same-origin proxy by default (hosting rewrite → the `llm` function). Override
// in dev with VITE_LLM_PROXY_URL pointing at the deployed function / emulator.
const PROXY_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_LLM_PROXY_URL || "/api/llm";

type ChatMessage = { role: "system" | "user"; content: string };
type Completion = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
};

type Usage = { input: number; output: number };

export class OpenRouterProvider implements LLMProvider {
  id: string;
  label: { bg: string; en: string };
  private model: ModelOption;
  private state: ProviderStatus = "ready";

  constructor(model: ModelOption) {
    this.model = model;
    this.id = `cloud:${model.id}`;
    this.label = model.label;
  }

  status(): ProviderStatus {
    return this.state;
  }

  // Cloud models need no weights; init is a no-op so selecting one is instant.
  async init(): Promise<void> {
    this.state = "ready";
  }

  private async call(
    messages: ChatMessage[],
    opts: { json?: boolean; maxTokens: number; temperature: number },
    usage: Usage,
  ): Promise<string> {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model.id,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`proxy ${res.status}`);
    const data = (await res.json()) as Completion;
    if (data.error)
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : (data.error.message ?? "model error"),
      );
    usage.input += data.usage?.prompt_tokens ?? 0;
    usage.output += data.usage?.completion_tokens ?? 0;
    return data.choices?.[0]?.message?.content ?? "";
  }

  // Model-first routing (a strong hosted model handles paraphrase + arg
  // extraction far better than keywords). The deterministic router is the
  // fallback when the model errors or returns something unusable.
  private async selectRoute(question: string, ctx: ToolContext, usage: Usage) {
    const ruleRoute = () => route(question, ctx);
    try {
      const content = await this.call(
        [
          { role: "system", content: buildToolSystemPrompt(ctx.lang) },
          { role: "user", content: question },
        ],
        { json: true, maxTokens: 120, temperature: 0 },
        usage,
      );
      return parseToolCall(content) ?? ruleRoute();
    } catch {
      return ruleRoute();
    }
  }

  private async narrateEnv(
    env: Parameters<typeof narrate>[0],
    lang: Lang,
    usage: Usage,
  ): Promise<{ text: string; fromModel: boolean }> {
    const template = narrate(env, lang);
    try {
      const { system, user } = buildNarrationPrompt(env, lang);
      const raw = await this.call(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { json: false, maxTokens: 200, temperature: 0.2 },
        usage,
      );
      const text = stripControl(raw);
      // language guard — never surface wrong-script model prose
      if (text.length > 0 && matchesLang(text, lang))
        return { text, fromModel: true };
      return { text: template, fromModel: false };
    } catch {
      return { text: template, fromModel: false };
    }
  }

  async respond(question: string, ctx: ToolContext): Promise<ChatResponse> {
    const t0 = performance.now();
    const usage: Usage = { input: 0, output: 0 };
    const r = await this.selectRoute(question, ctx, usage);
    const baseMeta = (
      narratedBy: ResponseMeta["narratedBy"],
    ): ResponseMeta => ({
      model: this.label,
      durationMs: performance.now() - t0,
      inputTokens: usage.input || undefined,
      outputTokens: usage.output || undefined,
      narratedBy,
    });
    if (!r)
      return { text: clarify(ctx.lang), env: null, meta: baseMeta("rules") };
    try {
      const env = await runTool(r.tool, r.args, ctx);
      const { text, fromModel } = await this.narrateEnv(env, ctx.lang, usage);
      return {
        text,
        env,
        tool: r.tool,
        meta: baseMeta(fromModel ? "model" : "rules"),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        text:
          ctx.lang === "bg"
            ? `Възникна грешка при изпълнението: ${msg}`
            : `Something went wrong running that: ${msg}`,
        env: null,
        meta: baseMeta("rules"),
      };
    }
  }
}
