import { selectHeuristicRoute } from "./heuristicRoute";
// The provider abstraction the chat talks to. Today the only implementation is
// the deterministic HeuristicProvider (router + tools + template narrator). In
// M3 a WebLLMProvider implements the same interface: it emits {tool,args} under
// a JSON grammar, runs the same tools, and narrates the same facts — so the chat
// UI doesn't change when the model lands.

import type { TurnMemory } from "../orchestrator/memory";
import { narrate } from "../orchestrator/narrate";
import { pinElectionContext } from "../orchestrator/router";
import { typoMatches } from "../orchestrator/typoMatch";
import { clarifyEnvelope } from "../tools/clarify";
import { TOOLS_BY_NAME, runTool } from "../tools/registry";
import type {
  ClarifyOption,
  Envelope,
  ToolArgs,
  ToolContext,
} from "../tools/types";
import { clarify } from "./lang";

// A question the keyword router DECLINED, but which contains a surface variant of
// a word the tool vocabulary uses, must not dead-end into `clarify()`'s single
// static sentence. This builds the near-miss chooser instead (plan C6).
//
// THE FILTER IS `params.length === 0`, not "declares no required param", and that
// distinction is the whole safety property. `required` does not mean "this tool's
// meaning is fixed without arguments": `macroIndicator.indicator` and
// `priceRanking.metric` are optional and still choose WHICH metric is answered. A
// chooser that admitted them passed `args: {}`, so picking the option offered for
// "Колко е безработноста?" ran `macroIndicator({})` — which falls back to GDP
// growth — and answered a different question than the sublabel promised. Offering
// nothing is strictly better than offering that.
//
// Two consequences, both accepted deliberately:
//  - The chooser only appears for tools whose whole answer is fixed, so today it is
//    narrow (two tools). Widening it needs a per-tool arg map — the same entity
//    extraction phase 2 adds — not a looser filter.
//  - `null` means "keep the plain sentence", so an unhelpful question degrades to
//    exactly the behaviour it had before this feature.
export const nearMissEnvelope = (
  question: string,
  ctx: ToolContext,
): Envelope | null => {
  const options: ClarifyOption[] = [];
  for (const hit of typoMatches(question, 3)) {
    const tool = TOOLS_BY_NAME[hit.tool];
    if (!tool || tool.params.length) continue;
    // Show WHAT was corrected, so the suggestion is explainable rather than a
    // silent guess: "инфлацята → инфлация".
    const fixed = [
      ...new Set(hit.corrections.map((c) => `${c.from} → ${c.to}`)),
    ];
    options.push({
      label: tool.description[ctx.lang],
      sublabel: fixed.join(", "),
      tool: hit.tool,
      args: {},
    });
  }
  if (!options.length) return null;
  const bg = ctx.lang === "bg";
  return clarifyEnvelope(
    bg
      ? "Не съм сигурен какво питате. Имахте предвид някое от тези?"
      : "I'm not sure what you're asking. Did you mean one of these?",
    options,
    // EMPTY, deliberately. Every other clarifyEnvelope caller passes a data file,
    // and `AnswerView` renders a non-empty provenance in the "Източник на данните"
    // slot — which would claim a data source for a chooser that shows no data. The
    // suggestions come from the tool catalogue, not a corpus.
    [],
    TOOLS_BY_NAME[options[0].tool]?.domain,
  );
};

// The ONE decision both lanes make when routing produced nothing: offer the
// near-miss chooser, else fall back to the static sentence. Shared so the rules
// lane and the cloud lane cannot drift — an earlier form repeated the pair in
// `openrouter.ts`, where only one of the two branches was covered by a test.
export const declinedAnswer = (
  question: string,
  ctx: ToolContext,
): { text: string; env: Envelope | null } => {
  const near = nearMissEnvelope(question, ctx);
  return near
    ? { text: narrate(near, ctx.lang), env: near }
    : { text: clarify(ctx.lang), env: null };
};

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

// Why a model narration was discarded in favour of the template — surfaced for
// telemetry so we can SEE how often (and why) the model's prose is rejected
// rather than guessing whether the grounded-number gate ever fires. Absent when
// the model's prose was accepted, or when no model narration was attempted (the
// rules engine, or a chooser env). "grounding" is the grounded-number gate.
export type NarrationReject = "language" | "grounding" | "empty" | "error";

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
  narrationReject?: NarrationReject; // set only on a model-narration → template fallback
  // WHO PICKED THE TOOL — distinct from `narratedBy` (who wrote the prose) and
  // from `model` (the lane's label). A Jev-routed turn still narrates from
  // templates, so without this the answer panel could not tell a reader that a
  // hosted model chose the tool. Absent means the lane's own routing ran.
  routedBy?: "rules" | "jev";
  routerConfidence?: number; // Jev's calibrated confidence in the chosen tool
  // True ONLY when Jev was asked and could not answer — timeout, breaker,
  // upstream error, no session. NOT set when Jev answered fine and the lane
  // declined to use its pick (e.g. a param-bearing tool it cannot fill): saying
  // "Jev did not answer in time" about a call that answered on time is exactly
  // the false claim this meta exists to prevent.
  routerDegraded?: boolean;
  // Jev answered that NO tool fits. Its decision stands (the lane declines
  // rather than re-routing through keywords), but no tool ran — so the band
  // must not say a tool "was chosen by Jev".
  routerDeclined?: boolean;
  routerLatencyMs?: number; // the routing call alone, not the whole turn
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
// Run a resolved {tool, args} and narrate the result from the template, or
// render the failure as a message. The ONE place this tail lives: every lane
// runs, narrates and reports errors identically — only the meta differs — so a
// change to the error copy or to error classification happens once.
export const runAndNarrate = async (
  r: { tool: string; args: ToolArgs },
  ctx: ToolContext,
  meta: () => ResponseMeta,
): Promise<ChatResponse> => {
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
};

export const runToolChoice = async (
  label: { bg: string; en: string },
  tool: string,
  args: ToolArgs,
  ctx: ToolContext,
): Promise<ChatResponse> => {
  args = pinElectionContext({ tool, args }, ctx)!.args;
  const t0 = performance.now();
  const meta = (): ResponseMeta => ({
    model: label,
    durationMs: performance.now() - t0,
    narratedBy: "rules",
  });
  return runAndNarrate({ tool, args }, ctx, meta);
};

export class HeuristicProvider implements LLMProvider {
  id = "rules";
  label = { bg: "Без AI", en: "No AI" };

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
    const { notice, route: r } = selectHeuristicRoute(question, ctx, opts);
    if (notice) return { text: notice, env: null, meta: meta() };
    if (!r) {
      // The shared decline: near-miss chooser, else the static sentence. Both
      // lanes go through `declinedAnswer` so they cannot drift — an earlier
      // form repeated the pair here and in openrouter.ts.
      const declined = declinedAnswer(question, ctx);
      return { text: declined.text, env: declined.env, meta: meta() };
    }
    return runAndNarrate(r, ctx, meta);
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
