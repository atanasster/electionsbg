// The Jev-routed No-LLM lane.
//
// Same tools, same `narrate()` templates and the same answer shapes as
// HeuristicProvider — ONLY the routing step differs: a keyword/regex router is
// replaced by one Choice question over the tool catalogue. No model writes
// prose in this lane, before or after, so `narratedBy` stays "rules" and the
// answer panel's "figures are computed, not generated" line stays literally
// true.
//
// ⚠️ LANE-PRESERVING FALLBACK. When Jev cannot answer — no session, timeout,
// open breaker, upstream error, or a confidence below the gate — this lane
// falls back to its OWN deterministic router, never to an LLM. That is the
// whole point of the lane, and it is the rule in
// docs/plans/jev-chat-integration-v1.md §6. (The AI lane's fallback is the
// opposite: the full Gemini prompt, never keyword routing. Each lane degrades
// within itself.)
//
// Measured basis for the design (docs/plans/jev-typesafe-eval-v1.md):
// 96% EN / 95% BG tool selection over the full 235-tool registry at ~492ms,
// with calibrated confidence — 100% accuracy above 0.9, 94% in 0.7–0.9, 83% in
// 0.5–0.7, 59% below 0.5.

import {
  askJev,
  choiceOf,
  resetJevBreaker,
  type JevCredentials,
  type JevQuestion,
  type JevResult,
} from "./jevClient";
import {
  NO_TOOL,
  TOOL_INSTRUCTIONS,
  toolOptionText,
  withNoTool,
} from "./jevPrompt";
import { deterministicPreamble } from "./heuristicRoute";
import {
  declinedAnswer,
  runAndNarrate,
  runToolChoice,
  type ChatResponse,
  type LLMProvider,
  type ProviderStatus,
  type RespondOpts,
  type ResponseMeta,
} from "./provider";
import { pinElectionContext, route, type Route } from "../orchestrator/router";
import { TOOLS, TOOLS_BY_NAME } from "../tools/registry";
import type { ToolArgs, ToolContext } from "../tools/types";

export { NO_TOOL };

/** Below this, treat the pick as no answer and let the lane's own router try.
 *  Calibration (n=458, relevant cases): ≥0.9 → 100% correct, 0.7–0.9 → 94%,
 *  0.5–0.7 → 83%, <0.5 → 59%. 0.7 keeps the accepted routes at ~94%+ while
 *  handing the genuinely uncertain ones back to a router that is deterministic
 *  and free. */
export const JEV_CONFIDENCE_GATE = 0.7;

/** The tool catalogue as Choice options. Built once: the registry is static for
 *  the life of the bundle, and this is a 236-entry object on every turn. The
 *  option FORMAT lives in jevPrompt.ts, shared with the eval harness that
 *  measured the accuracy this lane claims. */
let criteriaCache: Record<string, string> | null = null;
export const toolCriteria = (): Record<string, string> => {
  if (!criteriaCache) {
    const criteria: Record<string, string> = {};
    for (const t of TOOLS)
      criteria[t.name] = toolOptionText(
        t.description.en,
        t.params.map((p) => p.name),
      );
    criteriaCache = withNoTool(criteria);
  }
  return criteriaCache;
};

/** The batched question set for one turn. Questions run in parallel upstream at
 *  near-zero added latency, so everything the turn needs goes in ONE call. */
export const turnQuestions = (): Record<string, JevQuestion> => ({
  tool: {
    type: "choice",
    instructions: TOOL_INSTRUCTIONS,
    criteria: toolCriteria(),
  },
});

export type JevRouting = {
  route: Route;
  confidence?: number;
  latencyMs?: number;
  degraded: boolean;
};

/** Ask Jev for a tool. Returns `degraded: true` whenever the lane must fall
 *  back to its own router — including a below-gate answer, which is Jev
 *  declining rather than failing, but reaches the same place. */
export const jevRoute = async (
  question: string,
  credentials: JevCredentials | undefined,
  ask: typeof askJev = askJev,
): Promise<JevRouting> => {
  const result: JevResult | null = await ask(
    question,
    turnQuestions(),
    credentials,
  );
  if (!result) return { route: null, degraded: true };
  const pick = choiceOf(result, "tool");
  if (!pick)
    return { route: null, degraded: true, latencyMs: result.latencyMs };
  // Below the gate the pick is discarded rather than run: an uncertain route is
  // worse than a deterministic one, and the lane has a free deterministic one.
  //
  // ⚠️ Written `!(x >= gate)`, NOT `x < gate`. The two differ on exactly the
  // values that matter: `undefined < 0.7` and `NaN < 0.7` are both FALSE, so
  // the naive form reads an unparseable confidence as "confident" and routes on
  // it. `choiceOf` also rejects a non-finite confidence, so this is the second
  // of two guards on the same untrusted field.
  if (!(pick.confidence >= JEV_CONFIDENCE_GATE))
    return {
      route: null,
      degraded: true,
      confidence: pick.confidence,
      latencyMs: result.latencyMs,
    };
  // A confident `no_tool` is a real ANSWER, not a failure — the lane should
  // decline rather than re-route through keywords and manufacture a match.
  if (pick.choice === NO_TOOL)
    return {
      route: null,
      degraded: false,
      confidence: pick.confidence,
      latencyMs: result.latencyMs,
    };
  // The ARGS are not decided here — `respond` resolves them against the
  // deterministic router, because a tool run with `args: {}` answers a
  // different question than the one asked (see `acceptJevPick`).
  return {
    route: { tool: pick.choice, args: {} },
    confidence: pick.confidence,
    latencyMs: result.latencyMs,
    degraded: false,
  };
};

/**
 * Decide what actually runs, given Jev's pick and the deterministic route.
 *
 * ⚠️ THE ARGUMENT PROBLEM, which is why this function exists. Jev picks a TOOL;
 * it does not fill parameters in this tier. 160 of 235 registry tools declare
 * params and 74 declare a required one, so running a Jev pick with `args: {}`
 * would answer a different question than the one asked — confidently, at a 200,
 * badged "Jev". `provider.ts`'s `nearMissEnvelope` documents the same trap:
 * `macroIndicator({})` silently falls back to GDP growth, so „Колко е
 * безработицата?" would be answered with GDP.
 *
 * The rule, therefore:
 *  - same tool as the deterministic router  → take the router's extracted args;
 *  - Jev picked a PARAM-BEARING tool we cannot fill → keep the deterministic
 *    route (a complete answer to a possibly-worse-matched tool beats an
 *    argument-less answer to a well-matched one);
 *  - Jev picked a ZERO-PARAM tool → `args: {}` is the complete call.
 *
 * The `params.length === 0` filter is deliberately the same one
 * `nearMissEnvelope` uses, for the reason stated there: `required` does NOT
 * mean "this tool's meaning is fixed without arguments" — an optional param can
 * still choose WHICH metric is answered.
 */
export const acceptJevPick = (
  pick: Route,
  deterministic: Route,
): { route: Route; usedJev: boolean } => {
  if (!pick) return { route: deterministic, usedJev: false };
  if (deterministic && deterministic.tool === pick.tool)
    return { route: deterministic, usedJev: true };
  if (TOOLS_BY_NAME[pick.tool]?.params.length)
    return { route: deterministic, usedJev: false };
  return { route: pick, usedJev: true };
};

export class JevProvider implements LLMProvider {
  id = "jev";
  // ⚠️ NOT "Без AI". Routing through Jev is a hosted model call — cheap,
  // constrained and non-generative, but a model call — so a turn it routed must
  // not claim otherwise. The prose is still template-written, which is what
  // "Без LLM" says.
  label = { bg: "Без LLM · Jev", en: "No LLM · Jev" };

  constructor(
    private credentials?: () => JevCredentials | undefined,
    private ask: typeof askJev = askJev,
  ) {}

  status(): ProviderStatus {
    return "ready";
  }

  // A new chat must not inherit the previous one's breaker state or its stale
  // skip reason — otherwise a conversation started inside a 60s cooldown silently
  // never consults Jev, and reports the previous chat's failure as its own.
  async init(): Promise<void> {
    resetJevBreaker();
  }

  async respond(
    question: string,
    ctx: ToolContext,
    _onDelta?: (partial: string) => void,
    opts?: RespondOpts,
  ): Promise<ChatResponse> {
    const t0 = performance.now();
    // `asked` distinguishes "Jev failed" from "Jev was never consulted" (a
    // scope notice or a follow-on answered the turn). Reporting the latter as
    // degraded would badge a turn with a failure that never happened and
    // inflate the degrade rate the plan's T1 gate reads.
    let asked = false;
    let routing: JevRouting = { route: null, degraded: true };
    let usedJev = false;
    const meta = (): ResponseMeta => ({
      model: this.label,
      durationMs: performance.now() - t0,
      narratedBy: "rules",
      // Absent when Jev was never asked; otherwise what ACTUALLY routed.
      routedBy: asked ? (usedJev ? "jev" : "rules") : undefined,
      routerConfidence: asked ? routing.confidence : undefined,
      routerLatencyMs: asked ? routing.latencyMs : undefined,
      routerDegraded: asked && !usedJev ? true : undefined,
    });

    // Deterministic wins first — free, exact, and Jev has no better answer for
    // them. Shared with the No-AI lane so the two route in the same order.
    const { notice, followOn } = deterministicPreamble(question, ctx, opts);
    if (notice) return { text: notice, env: null, meta: meta() };

    let r: Route = followOn;
    if (!r) {
      asked = true;
      routing = await jevRoute(question, this.credentials?.(), this.ask);
      // The deterministic route is computed either way: it is free, and it is
      // the ARGUMENT SOURCE for a Jev pick as well as the fallback when Jev
      // cannot answer. Never an LLM — that would change the lane the user chose.
      //
      // A confident `no_tool` is the one case where Jev's answer is a decline
      // rather than a failure, so the lane declines instead of re-routing
      // through keywords and manufacturing a match.
      const declinedByJev = !routing.route && !routing.degraded;
      if (declinedByJev) {
        usedJev = true;
      } else {
        const accepted = acceptJevPick(routing.route, route(question, ctx));
        r = accepted.route;
        usedJev = accepted.usedJev;
      }
    }
    r = pinElectionContext(r, ctx);

    if (!r) {
      const declined = declinedAnswer(question, ctx);
      return { text: declined.text, env: declined.env, meta: meta() };
    }
    return runAndNarrate(r, ctx, meta);
  }

  // A disambiguation pick resolves to one entity, so there is nothing to route:
  // run the pinned tool and narrate from the template, exactly as the
  // deterministic lane does.
  async runChoice(
    tool: string,
    args: ToolArgs,
    ctx: ToolContext,
  ): Promise<ChatResponse> {
    return runToolChoice(this.label, tool, args, ctx);
  }
}
