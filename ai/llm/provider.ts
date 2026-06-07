// The provider abstraction the chat talks to. Today the only implementation is
// the deterministic HeuristicProvider (router + tools + template narrator). In
// M3 a WebLLMProvider implements the same interface: it emits {tool,args} under
// a JSON grammar, runs the same tools, and narrates the same facts — so the chat
// UI doesn't change when the model lands.

import type { TurnMemory } from "../orchestrator/memory";
import { narrate } from "../orchestrator/narrate";
import { resolveFollowOn, route } from "../orchestrator/router";
import { runTool } from "../tools/registry";
import type { Envelope, ToolArgs, ToolContext } from "../tools/types";
import { clarify } from "./lang";

// Per-request options shared by every provider.
// - prev: the previous answer's tool + args, so a bare follow-on like "а ДПС?"
//   resolves the ellipsis against the last question (the cheap, exact path).
// - history: the full list of prior exchanges (newest last), distilled to
//   structured TurnMemory. The model providers window + compact this into a
//   context block so they can resolve references the keyword follow-on can't
//   ("show the same for Plovdiv", "compare that to 2024"). The rules engine
//   ignores it (keyword routing has no use for prose context) — it relies on
//   `prev` alone, so offline behaviour is unchanged.
export type RespondOpts = {
  prev?: { tool: string; args: ToolArgs };
  history?: TurnMemory[];
};

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
  // the resolved tool args — kept so the next turn can use this answer as the
  // `prev` context for follow-on questions (conversational memory).
  args?: ToolArgs;
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
    opts?: RespondOpts,
  ): Promise<ChatResponse>;
  // Run an already-resolved {tool, args} directly — used when the user picks an
  // option from a disambiguation chooser. There's nothing to route (the entity
  // is pinned), so this skips routing and just runs + narrates the tool, the
  // same way respond() would for that env. Optional; the chat falls back to
  // `runToolChoice` (template narration) when a provider doesn't implement it.
  runChoice?(
    tool: string,
    args: ToolArgs,
    ctx: ToolContext,
    onDelta?: (partial: string) => void,
  ): Promise<ChatResponse>;
}

// Deterministic run + template narration of a resolved {tool, args}. Shared by
// HeuristicProvider.runChoice and used by the chat as the fallback for any
// provider that doesn't implement runChoice. A chosen option resolves to one
// entity, so this never re-clarifies; but if it somehow does, the env still
// carries `clarify` and the chooser simply re-opens.
export const runToolChoice = async (
  label: { bg: string; en: string },
  tool: string,
  args: ToolArgs,
  ctx: ToolContext,
): Promise<ChatResponse> => {
  const t0 = performance.now();
  const meta = (): ResponseMeta => ({
    model: label,
    durationMs: performance.now() - t0,
    narratedBy: "rules",
  });
  try {
    const env = await runTool(tool, args, ctx);
    return { text: narrate(env, ctx.lang), env, tool, args, meta: meta() };
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
};

export class HeuristicProvider implements LLMProvider {
  id = "rules";
  label = { bg: "Без AI (офлайн)", en: "Basic (offline)" };

  status(): ProviderStatus {
    return "ready";
  }

  async respond(
    question: string,
    ctx: ToolContext,
    _onDelta?: (partial: string) => void,
    opts?: RespondOpts,
  ): Promise<ChatResponse> {
    const t0 = performance.now();
    const meta = (): ResponseMeta => ({
      model: this.label,
      durationMs: performance.now() - t0,
      narratedBy: "rules",
    });
    // A bare follow-on ("а ДПС?") reuses the previous tool with the new entity;
    // otherwise route the question on its own.
    const r = resolveFollowOn(question, opts?.prev) ?? route(question, ctx);
    if (!r) return { text: clarify(ctx.lang), env: null, meta: meta() };
    try {
      const env = await runTool(r.tool, r.args, ctx);
      return {
        text: narrate(env, ctx.lang),
        env,
        tool: r.tool,
        args: r.args,
        meta: meta(),
      };
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

  // A disambiguation pick: run the pinned tool + args (no routing) and narrate
  // from the template.
  async runChoice(
    tool: string,
    args: ToolArgs,
    ctx: ToolContext,
  ): Promise<ChatResponse> {
    return runToolChoice(this.label, tool, args, ctx);
  }
}
