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
import {
  extractCompanyName,
  extractPersonName,
  pinElectionContext,
  route,
  type Route,
} from "../orchestrator/router";
import { dbEntitySearch, resolveEntity, type EntitySearch } from "./jevEntity";
import { TOOLS, TOOLS_BY_NAME } from "../tools/registry";
import type { ToolArgs, ToolContext } from "../tools/types";

export { NO_TOOL };

/** Below this, treat the pick as no answer and let the lane's own router try.
 *  Calibration (n=458, relevant cases): ≥0.9 → 100% correct, 0.7–0.9 → 94%,
 *  0.5–0.7 → 83%, <0.5 → 59%. 0.7 keeps the accepted routes at ~94%+ while
 *  handing the genuinely uncertain ones back to a router that is deterministic
 *  and free. */
export const JEV_CONFIDENCE_GATE = 0.7;

/** The lane's name in the model picker, and the label for a turn Jev ACTUALLY
 *  routed. Routing through Jev is a hosted model call, so a turn it routed must
 *  not claim to be AI-free. */
export const JEV_LABEL = { bg: "Без LLM · Jev", en: "No LLM · Jev" };

/** The label for a turn in this lane that Jev did NOT route — it timed out, was
 *  never asked, or its pick was refused, and the deterministic router answered.
 *  Showing the Jev name there would credit a model that did no work. */
export const JEV_FALLBACK_LABEL = { bg: "Без LLM", en: "No LLM" };

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

// ---- closed-vocabulary arguments (tier 2) ---------------------------------
//
// Jev can pick a parameter's value ONLY when that value comes from a list we
// enumerate — it has no primitive that generates a free-text value
// (docs/plans/jev-typesafe-eval-v1.md §3). The registry already marks exactly
// those parameters: `ToolParam.values`. 52 params across the catalogue declare
// one, and that is the whole addressable set — no new metadata, and an
// open-vocabulary param (a person's name, a free-text query) is simply never
// asked about.
//
// Measured: 100% on 122 closed-vocabulary cases, EN and BG alike.

/** The sentinel for "the question names no value for this parameter". Without
 *  it a Choice must pick SOME value, which would invent an argument the user
 *  never gave — worse than leaving the param unset. */
export const ARG_UNSPECIFIED = "__unspecified__";

export const enumerableParams = (tool: string) =>
  (TOOLS_BY_NAME[tool]?.params ?? []).filter((p) => p.values?.length);

/** One Choice per enumerable parameter of the picked tool. Batched into a
 *  single request: questions run in parallel upstream, so N params cost about
 *  what one does. */
/** The proxy accepts at most this many questions per request
 *  (`functions/jev_payload.js` LIMITS.questions). Exceeding it is a 400 for the
 *  WHOLE call, not a truncation — `procurementQuery` declares 22 enumerable
 *  params and `fundingQuery` 20, so an unbounded fan-out would fail outright on
 *  exactly the tools tier 2 exists to serve. Required params come first, since
 *  those are what decide whether the tool can run at all. */
export const MAX_ARG_QUESTIONS = 8;

export const argQuestions = (
  tool: string,
  skip: ReadonlySet<string> = new Set(),
): Record<string, JevQuestion> => {
  const questions: Record<string, JevQuestion> = {};
  const ordered = [...enumerableParams(tool)].sort(
    (a, b) => Number(!!b.required) - Number(!!a.required),
  );
  for (const p of ordered) {
    if (skip.has(p.name)) continue;
    if (Object.keys(questions).length >= MAX_ARG_QUESTIONS) break;
    const criteria: Record<string, string | null> = {};
    for (const v of p.values!) criteria[String(v)] = null;
    criteria[ARG_UNSPECIFIED] = "The question does not name a value for this.";
    questions[p.name] = {
      type: "choice",
      instructions: `Which value does the question give for "${p.name}" (${p.description.en})? Choose ${ARG_UNSPECIFIED} if it names none.`,
      criteria,
    };
  }
  return questions;
};

/** Read the filled arguments out of an answer set. A below-gate or absent
 *  answer leaves the parameter UNSET rather than guessing: an unset optional
 *  param falls back to the tool's own default, while a wrong one silently
 *  answers a different question. */
export const fillArgs = (
  tool: string,
  result: JevResult | null,
): { args: ToolArgs; filled: string[] } => {
  const args: ToolArgs = {};
  const filled: string[] = [];
  for (const p of enumerableParams(tool)) {
    const pick = choiceOf(result, p.name);
    if (!pick || pick.choice === ARG_UNSPECIFIED) continue;
    if (!(pick.confidence >= JEV_CONFIDENCE_GATE)) continue;
    // The registry's `values` may be numbers; the answer is always a string.
    const declared = TOOLS_BY_NAME[tool]?.params.find((x) => x.name === p.name);
    const match = declared?.values?.find((v) => String(v) === pick.choice);
    if (match === undefined) continue;
    args[p.name] = match;
    filled.push(p.name);
  }
  return { args, filled };
};

/** Can this tool run with the arguments we have? True when every REQUIRED
 *  parameter is present. A tool whose required param is open-vocabulary can
 *  never pass, which is the point — it is refused rather than run empty.
 *
 *  ⚠️ A tool with NO required params passes VACUOUSLY — `every` over an empty
 *  list is true — so this predicate is necessary and NOT sufficient. Three
 *  registry tools declare enumerable params and no required one, and for them
 *  an all-`__unspecified__` second call would otherwise "succeed" with
 *  `args: {}` and discard a correct deterministic answer. `fillEnumerableArgs`
 *  therefore ALSO requires that at least one value was actually filled — the
 *  same reasoning as `acceptJevPick`'s `params.length === 0` rule. */
export const argsSufficient = (tool: string, args: ToolArgs): boolean =>
  (TOOLS_BY_NAME[tool]?.params ?? [])
    .filter((p) => p.required)
    .every((p) => args[p.name] !== undefined);

/** Could a second call ever rescue this tool? Only when every required param is
 *  enumerable — otherwise the registry already predetermines the refusal, and
 *  asking would burn one of the three reserved calls per question to learn
 *  something we can read locally. */
export const fillableTool = (tool: string): boolean => {
  const params = TOOLS_BY_NAME[tool]?.params ?? [];
  if (!params.some((p) => p.values?.length)) return false;
  return params.every((p) => !p.required || p.values?.length);
};

// ---- name-shaped arguments (tier 3) ---------------------------------------
//
// A `person`/`company` param is open-vocabulary, so Jev cannot produce its
// value. What it CAN do is pick among candidates the trigram search already
// found — see ai/llm/jevEntity.ts for the division of labour and the measured
// ceiling. This lane only attempts it for a tool whose ONLY unfilled required
// param is name-shaped; anything else stays with the deterministic router.

export const ENTITY_PARAM_TYPES = new Set(["person", "company"]);

/**
 * Which `tool.param` pairs may be resolved against the PERSON and COMPANY
 * registries — an explicit allowlist, NOT the param's declared type.
 *
 * ⚠️ `type: "person"` IS NOT A RELIABLE SIGNAL. The registry reuses it as a
 * generic "free-text name" type: `schoolMatura.school` is declared `person`
 * and is a SCHOOL. Resolving it here would run a person-search for a school
 * and hand Jev a list of real human beings to pick from — a route to naming a
 * real individual in an answer about a building, which is the one failure this
 * path exists to prevent. Declared types are a convenience for the keyword
 * router; this list is a claim about identity.
 *
 * `jev.test.ts` sweeps the registry and fails when a person/company-typed
 * required param appears in NEITHER this map nor NOT_AN_ENTITY, so a new tool
 * cannot quietly inherit entity resolution.
 */
export const ENTITY_PARAMS: Record<string, "person" | "company"> = {
  "candidateResult.name": "person",
  "personProfile.name": "person",
  "personConnections.name": "person",
  "personWealth.name": "person",
  "mpVotingProfile.name": "person",
  "mpSimilarity.name": "person",
  "contractSearch.company": "company",
  "companyProfile.company": "company",
  "companyConnections.company": "company",
};

/** Params that LOOK name-shaped by declared type and are not identities.
 *  Listed explicitly so the sweep in jev.test.ts stays exhaustive. */
export const NOT_AN_ENTITY: Record<string, string> = {
  "schoolMatura.school":
    "a school, not a person — the registry reuses type:person for free-text names",
};

/** The single name-shaped required param of a tool, when that is the only
 *  thing standing between the pick and a runnable call. Null otherwise — a
 *  tool needing two different names, or a name plus an unfillable param, is
 *  refused rather than half-resolved. */
export const soleEntityParam = (tool: string) => {
  const params = TOOLS_BY_NAME[tool]?.params ?? [];
  const required = params.filter((p) => p.required);
  const entity = required.filter((p) => ENTITY_PARAMS[`${tool}.${p.name}`]);
  if (entity.length !== 1) return null;
  // Every OTHER required param must be enumerable, or we still cannot run.
  const rest = required.filter((p) => p !== entity[0]);
  return rest.every((p) => p.values?.length) ? entity[0] : null;
};

/** The registry's declared type is not trusted for the search itself either —
 *  the allowlist decides which index is queried. */
export const entityKindFor = (
  tool: string,
  param: string,
): "person" | "company" | null => ENTITY_PARAMS[`${tool}.${param}`] ?? null;

export class JevProvider implements LLMProvider {
  id = "jev";
  // ⚠️ NOT "Без AI". Routing through Jev is a hosted model call — cheap,
  // constrained and non-generative, but a model call — so a turn it routed must
  // not claim otherwise. The prose is still template-written, which is what
  // "Без LLM" says.
  label = JEV_LABEL;

  constructor(
    private credentials?: () => JevCredentials | undefined,
    private ask: typeof askJev = askJev,
    private search: EntitySearch = dbEntitySearch,
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
    let declined = false;
    let argsFilled = false;
    const meta = (): ResponseMeta => ({
      // The band names what produced THIS answer, not which lane is selected:
      // on a turn Jev did not route, the Jev name must not appear at all.
      model: usedJev ? JEV_LABEL : JEV_FALLBACK_LABEL,
      durationMs: performance.now() - t0,
      narratedBy: "rules",
      // Absent when Jev was never asked; otherwise what ACTUALLY routed.
      routedBy: asked ? (usedJev ? "jev" : "rules") : undefined,
      routerConfidence: asked ? routing.confidence : undefined,
      routerLatencyMs: asked ? routing.latencyMs : undefined,
      // ⚠️ Keyed on `routing.degraded` — whether JEV FAILED — not on whether we
      // used its pick. A confident pick at a param-bearing tool is refused by
      // `acceptJevPick` while Jev answered perfectly well; reporting that as
      // "did not answer in time" would be a false claim about a hosted call.
      routerDegraded: asked && routing.degraded ? true : undefined,
      routerDeclined: declined ? true : undefined,
      routerFilledArgs: argsFilled ? true : undefined,
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
        declined = true;
      } else {
        const deterministic = route(question, ctx);
        let accepted = acceptJevPick(routing.route, deterministic);
        // A pick the argument rule refused is worth a SECOND call when the
        // tool's parameters are enumerable — that is the case tier 2 exists
        // for, and the only one where a second round trip can change the
        // answer. A pick that was already accepted, or a tool with no
        // enumerable params, never pays for it.
        if (routing.route && !accepted.usedJev) {
          const filledRoute = fillableTool(routing.route.tool)
            ? await this.fillEnumerableArgs(question, routing.route.tool)
            : await this.resolveEntityArgs(question, routing.route.tool);
          if (filledRoute) {
            accepted = { route: filledRoute, usedJev: true };
            // Never a bare `true`: the band claims a hosted model chose these
            // values from an enumerated list, so the flag must be derived from
            // values actually chosen.
            argsFilled = Object.keys(filledRoute.args).length > 0;
          }
        }
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

  /** Second call: fill the picked tool's ENUMERABLE parameters. Returns a
   *  runnable route, or null when the tool still cannot be run — in which case
   *  the caller keeps the deterministic answer rather than running it empty. */
  private async fillEnumerableArgs(
    question: string,
    tool: string,
  ): Promise<Route> {
    const result = await this.ask(
      question,
      argQuestions(tool),
      this.credentials?.(),
    );
    if (!result) return null;
    const { args, filled } = fillArgs(tool, result);
    // ⚠️ BOTH guards. `argsSufficient` is vacuously true for a tool with no
    // required params, so on its own it would admit a second call that answered
    // `__unspecified__` to everything — running the tool with `args: {}` and
    // throwing away a correct deterministic answer, which is precisely the trap
    // `acceptJevPick` refuses. A rescue that rescued nothing is not a rescue.
    if (!filled.length) return null;
    return argsSufficient(tool, args) ? { tool, args } : null;
  }

  /** Tier 3: resolve a tool whose only unfilled required parameter is a person
   *  or company name. Returns null — keeping the deterministic answer — on a
   *  refusal, an empty search, or an unavailable Jev. Naming the WRONG real
   *  person is the failure this path must never produce, so every uncertain
   *  outcome resolves to "no route" rather than to a guess. */
  private async resolveEntityArgs(
    question: string,
    tool: string,
  ): Promise<Route> {
    const param = soleEntityParam(tool);
    if (!param) return null;
    // The ALLOWLIST decides which registry is searched, never the declared
    // type — see ENTITY_PARAMS for why that distinction is load-bearing.
    const kind = entityKindFor(tool, param.name);
    if (!kind) return null;
    const term =
      kind === "company"
        ? extractCompanyName(question)
        : extractPersonName(question);
    const { entity } = await resolveEntity(
      question,
      kind,
      term,
      this.search,
      this.ask,
      this.credentials?.(),
    );
    if (!entity) return null;
    // Any OTHER required params are enumerable by `soleEntityParam`'s own
    // check, so fill them the way tier 2 does — but ONLY if there are any.
    // Every sole-entity tool in the registry today has none, and an empty
    // question map is a 400 at the proxy, which would trip the circuit breaker
    // and leave a failure reason behind after a SUCCESSFUL turn.
    const remaining = argQuestions(tool, new Set([param.name]));
    const args = Object.keys(remaining).length
      ? fillArgs(
          tool,
          await this.ask(question, remaining, this.credentials?.()),
        ).args
      : {};
    const merged = { ...args, [param.name]: entity.value };
    return argsSufficient(tool, merged) ? { tool, args: merged } : null;
  }

  // A disambiguation pick resolves to one entity, so there is nothing to route:
  // run the pinned tool and narrate from the template, exactly as the
  // deterministic lane does.
  async runChoice(
    tool: string,
    args: ToolArgs,
    ctx: ToolContext,
  ): Promise<ChatResponse> {
    // JEV_FALLBACK_LABEL, not `this.label`: a chooser pick makes no Jev call at
    // all, so crediting Jev on it would name a model that did no work.
    return runToolChoice(JEV_FALLBACK_LABEL, tool, args, ctx);
  }
}
