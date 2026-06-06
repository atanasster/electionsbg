// The provider abstraction the chat talks to. Today the only implementation is
// the deterministic HeuristicProvider (router + tools + template narrator). In
// M3 a WebLLMProvider implements the same interface: it emits {tool,args} under
// a JSON grammar, runs the same tools, and narrates the same facts — so the chat
// UI doesn't change when the model lands.

import { narrate } from "../orchestrator/narrate";
import { route } from "../orchestrator/router";
import { runTool } from "../tools/registry";
import type { Envelope, ToolContext } from "../tools/types";
import { clarify } from "./lang";

// How a response was produced — surfaced in the answer panel's header band.
// For the rules engine only `model`/`durationMs`/`narratedBy:"rules"` apply
// (no LLM, so no token counts). A WebLLM model additionally reports tokens and,
// when the engine exposes it, the decode rate.
export type ResponseMeta = {
  model: { bg: string; en: string }; // provider label, resolved at render time
  durationMs: number; // wall-clock route + runTool + narrate
  inputTokens?: number; // LLM only
  outputTokens?: number; // LLM only
  tokPerSec?: number; // LLM only — engine decode rate, when available
  narratedBy: "rules" | "model"; // who wrote the prose (numbers are always computed)
};

export type ChatResponse = {
  text: string;
  env: Envelope | null;
  tool?: string;
  meta?: ResponseMeta;
};

export type ProviderStatus = "ready" | "loading" | "unsupported" | "error";

export interface LLMProvider {
  id: string;
  label: { bg: string; en: string };
  status(): ProviderStatus;
  // load weights / warm up (no-op for the deterministic provider)
  init?(onProgress?: (pct: number, note: string) => void): Promise<void>;
  // onDelta (optional) streams the narration as it's produced (model providers);
  // the deterministic provider ignores it and returns the final text.
  respond(
    question: string,
    ctx: ToolContext,
    onDelta?: (partial: string) => void,
  ): Promise<ChatResponse>;
}

export class HeuristicProvider implements LLMProvider {
  id = "rules";
  label = { bg: "Правила (офлайн)", en: "Rules (offline)" };

  status(): ProviderStatus {
    return "ready";
  }

  async respond(question: string, ctx: ToolContext): Promise<ChatResponse> {
    const t0 = performance.now();
    const meta = (): ResponseMeta => ({
      model: this.label,
      durationMs: performance.now() - t0,
      narratedBy: "rules",
    });
    const r = route(question, ctx);
    if (!r) return { text: clarify(ctx.lang), env: null, meta: meta() };
    try {
      const env = await runTool(r.tool, r.args, ctx);
      return { text: narrate(env, ctx.lang), env, tool: r.tool, meta: meta() };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        text:
          ctx.lang === "bg"
            ? `Възникна грешка при изпълнението: ${msg}`
            : `Something went wrong running that: ${msg}`,
        env: null,
        meta: meta(),
      };
    }
  }
}
