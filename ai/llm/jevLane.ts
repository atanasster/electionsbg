// Score the JEV lane over the SAME 841-case bank the other two lanes use.
//
// ⚠️ ONE BANK, ONE SCORER, THREE LANES. The comparison is only meaningful if
// every lane is judged by the same rules on the same cases — this repo has
// already been burned by scoring "the same question two ways by language"
// (see `normalizeRoute`'s comment in ai/tests/nonAiEval.ts). So the case list,
// the input shaping, the route normalisation and the tool/args/call scoring
// are all IMPORTED from the deterministic lane's harness rather than restated,
// and only the ROUTING step differs:
//
//   lane A (non-AI)  selectHeuristicRoute — keyword/regex
//   lane B (Gemini)  the model's own JSON routing call
//   lane C (Jev)     one Choice over the tool catalogue, then the same
//                    argument rules the provider uses
//
// Jev is scored THROUGH THE PROVIDER'S OWN DECISION FUNCTIONS (`jevRoute`,
// `acceptJevPick`, `fillArgs`), not a reimplementation — otherwise the eval
// would measure a router that does not ship.

import {
  NON_AI_CASES,
  nonAiInput,
  normalizeRouteForScoring,
} from "../tests/nonAiEval";
import { expectedArgs, type EvalCase } from "./currentEval";
import {
  acceptJevPick,
  argQuestions,
  argsSufficient,
  fillArgs,
  fillableTool,
  jevRoute,
} from "./jev";
import { askJev, type JevCredentials } from "./jevClient";
import { deterministicPreamble } from "./heuristicRoute";
import { pinElectionContext, route } from "../orchestrator/router";
import { validateToolArgs } from "../orchestrator/toolSchema";
import type { Lang, ToolArgs, ToolContext } from "../tools/types";

const norm = (v: unknown) => String(v).normalize("NFC").trim().toLowerCase();

const sameValue = (
  actual: unknown,
  expected: string | number | (string | number)[],
): boolean =>
  Array.isArray(expected)
    ? Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((v, i) => norm(actual[i]) === norm(v))
    : norm(actual) === norm(expected);

export type JevLaneRow = {
  id: string;
  lang: Lang;
  group: string;
  question: string;
  expectedTool: string | null;
  selected: { tool: string; args: ToolArgs } | null;
  toolOk: boolean;
  callOk: boolean;
  argsOk: boolean | null;
  argScored: boolean;
  /** Did JEV determine the tool, or did the lane fall back to its own router?
   *  Reported as a first-class metric: a lane that abstains often and is right
   *  when it answers is a different product from one that always answers. */
  routedByJev: boolean;
  jevConfidence?: number;
  /** Jev unavailable (no answer) — the harness's problem, not the router's. */
  degraded: boolean;
  /** Jev answered below the confidence gate — the router's own abstention. */
  unsure: boolean;
  inputTokens: number;
  latencyMs: number;
};

/** The lane's routing decision for one case, using the provider's own rules. */
export const jevLaneRoute = async (
  question: string,
  ctx: ToolContext,
  opts: Parameters<typeof deterministicPreamble>[2],
  credentials: JevCredentials | undefined,
  ask: typeof askJev = askJev,
  gate?: number,
): Promise<{
  selected: { tool: string; args: ToolArgs } | null;
  routedByJev: boolean;
  confidence?: number;
  degraded: boolean;
  unsure: boolean;
  latencyMs: number;
  inputTokens: number;
}> => {
  // Same preamble as both other lanes — a scope notice or a follow-on is
  // answered before any model is consulted, and scoring it differently here
  // would make the comparison about the preamble rather than about routing.
  const { notice, followOn } = deterministicPreamble(question, ctx, opts);
  if (notice)
    return {
      selected: null,
      routedByJev: false,
      degraded: false,
      unsure: false,
      latencyMs: 0,
      inputTokens: 0,
    };
  if (followOn)
    return {
      selected: pinElectionContext(followOn, ctx),
      routedByJev: false,
      degraded: false,
      unsure: false,
      latencyMs: 0,
      inputTokens: 0,
    };

  const routing = await jevRoute(question, credentials, ask, gate);
  let latencyMs = routing.latencyMs ?? 0;
  let inputTokens = 0;
  // A confident `no_tool` is an ANSWER (decline), not a gap.
  if (!routing.route && !routing.degraded && !routing.unsure)
    return {
      selected: null,
      routedByJev: true,
      confidence: routing.confidence,
      degraded: false,
      unsure: false,
      latencyMs,
      inputTokens,
    };

  const deterministic = route(question, ctx);
  let accepted = acceptJevPick(routing.route, deterministic);
  let argCallFailed = false;
  // Tier 2: a refused pick whose params are enumerable gets a second call.
  if (routing.route && !accepted.usedJev && fillableTool(routing.route.tool)) {
    const result = await ask(
      question,
      argQuestions(routing.route.tool),
      credentials,
    );
    // A failed SECOND call is Jev being unavailable too. Without this the row
    // was scored as an ordinary refused pick, which counts an outage (a rate
    // limit, most often) against the router as if it had decided.
    if (!result) argCallFailed = true;
    latencyMs += result?.latencyMs ?? 0;
    inputTokens += result?.usage?.input_tokens ?? 0;
    const { args, filled } = fillArgs(routing.route.tool, result);
    if (filled.length && argsSufficient(routing.route.tool, args))
      accepted = { route: { tool: routing.route.tool, args }, usedJev: true };
  }
  return {
    selected: pinElectionContext(accepted.route, ctx),
    routedByJev: accepted.usedJev,
    confidence: routing.confidence,
    degraded: routing.degraded || argCallFailed,
    unsure: !!routing.unsure,
    latencyMs,
    inputTokens,
  };
};

export const evaluateJev = async (
  c: EvalCase,
  lang: Lang,
  credentials: JevCredentials | undefined,
  ask: typeof askJev = askJev,
  gate?: number,
): Promise<JevLaneRow> => {
  const { question, opts } = nonAiInput(c, lang);
  const ctx: ToolContext = { lang, election: "2026_04_19" };
  const r = await jevLaneRoute(question, ctx, opts, credentials, ask, gate);
  const selected = normalizeRouteForScoring(r.selected, c.tool);
  const toolOk = c.tool === null ? !selected : selected?.tool === c.tool;
  const expected = expectedArgs(c, lang);
  const args = selected ? validateToolArgs(selected.tool, selected.args) : null;
  // `null`, never `true`, when the case carries no expectation — identical to
  // the other lanes, so an unannotated case cannot be reported as a pass.
  const argsOk: boolean | null =
    expected === undefined
      ? null
      : toolOk &&
        !!args &&
        Object.entries(expected).every(([k, values]) =>
          values.some((v) => sameValue(args[k], v)),
        );
  const callOk =
    c.tool === null ? !selected : toolOk && !!args && argsOk !== false;
  return {
    id: c.id,
    lang,
    group: c.group,
    question,
    expectedTool: c.tool,
    selected,
    toolOk,
    callOk,
    argsOk,
    argScored: expected !== undefined,
    routedByJev: r.routedByJev,
    jevConfidence: r.confidence,
    degraded: r.degraded,
    unsure: r.unsure,
    inputTokens: r.inputTokens,
    latencyMs: r.latencyMs,
  };
};

export const JEV_LANE_CASES = NON_AI_CASES;
