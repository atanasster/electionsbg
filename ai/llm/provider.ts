// The provider abstraction the chat talks to. Today the only implementation is
// the deterministic HeuristicProvider (router + tools + template narrator). In
// M3 a WebLLMProvider implements the same interface: it emits {tool,args} under
// a JSON grammar, runs the same tools, and narrates the same facts — so the chat
// UI doesn't change when the model lands.

import { narrate } from "../orchestrator/narrate";
import { route } from "../orchestrator/router";
import { runTool } from "../tools/registry";
import type { Envelope, Lang, ToolContext } from "../tools/types";

export type ChatResponse = {
  text: string;
  env: Envelope | null;
  tool?: string;
};

export type ProviderStatus = "ready" | "loading" | "unsupported" | "error";

export interface LLMProvider {
  id: string;
  label: { bg: string; en: string };
  status(): ProviderStatus;
  // load weights / warm up (no-op for the deterministic provider)
  init?(onProgress?: (pct: number, note: string) => void): Promise<void>;
  respond(question: string, ctx: ToolContext): Promise<ChatResponse>;
}

const clarify = (lang: Lang): string =>
  lang === "bg"
    ? "Мога да отговарям за резултати по партия и избор, машинно гласуване, активност, сравнения между избори и тенденции през годините. Опитайте напр.: „машинно гласуване в последните 7 избора“."
    : "I can answer about party/election results, machine voting, turnout, election comparisons, and trends over time. Try e.g.: “machine voting in the last 7 elections”.";

export class HeuristicProvider implements LLMProvider {
  id = "rules";
  label = { bg: "Правила (офлайн)", en: "Rules (offline)" };

  status(): ProviderStatus {
    return "ready";
  }

  async respond(question: string, ctx: ToolContext): Promise<ChatResponse> {
    const r = route(question, ctx);
    if (!r) return { text: clarify(ctx.lang), env: null };
    try {
      const env = await runTool(r.tool, r.args, ctx);
      return { text: narrate(env, ctx.lang), env, tool: r.tool };
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
