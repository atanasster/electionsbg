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
import type { Lang, ToolArgs, ToolContext, ToolParam } from "../tools/types";
import {
  extractEntities,
  fillMissingArgs,
} from "../orchestrator/entityExtraction";
import { validateArguments } from "../orchestrator/validateArguments";
import { validateToolArgs } from "../orchestrator/toolSchema";
import { typedArgs } from "./jevParamExtract";

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
  /** Jev was UNAVAILABLE — no answer, or one we could not read. */
  degraded: boolean;
  /** Jev ANSWERED, below the confidence gate. The lane still falls back to its
   *  own router, but this is Jev abstaining, not Jev failing.
   *
   *  ⚠️ These were one flag, and the conflation was expensive: the answer band
   *  told the reader "Jev did not answer in time" on every low-confidence turn
   *  — 19% of the eval bank — about a call that had returned promptly; and the
   *  eval's "degraded" share read as an outage rate, which sent a re-run after
   *  "rate-limited" rows of which there were zero. */
  unsure?: boolean;
};

/** Ask Jev for a tool. The lane falls back to its own router on `degraded`
 *  (Jev unavailable) AND on `unsure` (a below-gate answer, which is Jev
 *  declining rather than failing, but reaches the same place. */
export const jevRoute = async (
  question: string,
  credentials: JevCredentials | undefined,
  ask: typeof askJev = askJev,
  /** Overridable ONLY so the eval can sweep it; production always uses the
   *  constant. */
  gate: number = JEV_CONFIDENCE_GATE,
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
  if (!(pick.confidence >= gate))
    return {
      route: null,
      degraded: false,
      unsure: true,
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

/**
 * JEV PICKS THE TOOL; ITS PARAMETERS COME FROM WHATEVER CAN SUPPLY THEM
 * WITHOUT A GENERATIVE MODEL — and when nothing can, the lane ASKS instead of
 * answering a different question.
 *
 * Used when Jev confidently picked a tool that takes parameters and the rules
 * chose something else (or nothing). That is exactly when Jev is correcting
 * the rules, and before this the lane threw the pick away and answered with the
 * rules' tool — measured on questions with typos, rewording and Latin script,
 * 541 confident, correct picks were discarded that way.
 *
 * Three modes, so the steps can be measured apart:
 *   narrow  the fillers that already existed: Jev fills a tool whose required
 *           parameters are all from a fixed list, or picks among searched
 *           names when a name is the only required value. Otherwise ASK.
 *   full    also (1) values the rules parsed for THEIR tool, carried over where
 *           Jev's tool has a parameter of the same name, (2) years, indicators
 *           and store chains from the tool-independent entity extractor, and
 *           (3) Jev for ANY fixed-list or name parameter still unset.
 *           Otherwise ASK.
 *   extract full, plus (4) years, elections, counts, parties, places and
 *           oblasts read from the question by parameter TYPE
 *           (`jevParamExtract.ts`), and defaults for a tool whose unset
 *           parameters are all of types something here reads.
 *
 * ⚠️ A value that does not validate for Jev's tool is DROPPED, not trusted —
 * a carried value was parsed for a different tool. And a tool runs only when
 * every REQUIRED parameter is set; optional selectors (`macroIndicator.
 * indicator` and the like) are fixed-list parameters, which step (3) asks Jev
 * about, so an omitted one means the question named none.
 */
/** Parameter types whose extracted value beats one the rules parsed for their
 *  own tool: the rules' place is whatever words were left over once their own
 *  vocabulary was removed („i need decisions adopted by ruse municipal"), the
 *  extractor's is a gazetteer entry. */
const EXTRACTOR_WINS = new Set<ToolParam["type"]>(["place", "oblast"]);

export type JevCompletion =
  | { kind: "run"; route: NonNullable<Route>; filled: string[] }
  | { kind: "clarify"; tool: string; missing: ToolParam[] };

type Ask = typeof askJev;

/** Keep what validates for `tool`; drop what does not. */
const settleArgs = (tool: string, args: ToolArgs): ToolArgs => {
  let a = { ...args };
  for (let i = 0; i < 4; i++) {
    const { errors } = validateArguments(tool, a, { ignoreUnknown: true });
    const bad = Object.entries(errors)
      .filter(([k, e]) => e !== "required" && k in a)
      .map(([k]) => k);
    if (!bad.length) break;
    a = Object.fromEntries(Object.entries(a).filter(([k]) => !bad.includes(k)));
  }
  return a;
};

const declared = (tool: string) =>
  new Set((TOOLS_BY_NAME[tool]?.params ?? []).map((p) => p.name));

/** Values the rules parsed for their own tool, where Jev's tool has a
 *  parameter of the same name. */
export const carriedArgs = (tool: string, deterministic: Route): ToolArgs => {
  if (!deterministic) return {};
  const names = declared(tool);
  return Object.fromEntries(
    Object.entries(deterministic.args).filter(
      ([k, v]) => names.has(k) && v !== undefined && v !== "",
    ),
  );
};

/** Years / indicators / chains from the tool-independent extractor. */
export const extractedArgs = (tool: string, question: string): ToolArgs => {
  const names = declared(tool);
  return Object.fromEntries(
    Object.entries(fillMissingArgs({}, extractEntities(question))).filter(
      ([k]) => names.has(k),
    ),
  );
};

export const completeJevPick = async (
  question: string,
  tool: string,
  deterministic: Route,
  deps: {
    ask: Ask;
    credentials: JevCredentials | undefined;
    search?: EntitySearch;
  },
  mode: "narrow" | "full" | "extract" = "full",
): Promise<JevCompletion> => {
  const wide = mode !== "narrow";
  const def = TOOLS_BY_NAME[tool];
  const clarify = (args: ToolArgs): JevCompletion => ({
    kind: "clarify",
    tool,
    missing: (def?.params ?? []).filter(
      (p) => p.required && args[p.name] === undefined,
    ),
  });
  if (!def) return { kind: "clarify", tool, missing: [] };
  const filled: string[] = [];
  let args: ToolArgs = wide
    ? settleArgs(tool, {
        ...extractedArgs(tool, question),
        ...carriedArgs(tool, deterministic),
      })
    : {};
  filled.push(...Object.keys(args));

  // Stage 3: values read from the question by parameter TYPE. Settled on their
  // own, so a typed value that fails validation cannot take a carried one down.
  let readAbsent = new Set<string>();
  if (mode === "extract") {
    const found = await typedArgs(tool, question);
    readAbsent = found.read;
    const typed = settleArgs(tool, found.args);
    for (const p of def.params) {
      const v = typed[p.name];
      if (v === undefined) continue;
      if (args[p.name] !== undefined && !EXTRACTOR_WINS.has(p.type)) continue;
      args[p.name] = v;
      if (!filled.includes(p.name)) filled.push(p.name);
    }
  }

  // Fixed-list values: one Jev call. `narrow` keeps the old gate (only when
  // every required parameter is fixed-list); `full` asks whenever one is unset.
  const unsetEnum = enumerableParams(tool).filter(
    (p) => args[p.name] === undefined,
  );
  // True only when Jev POSITIVELY said the question names none of the tool's
  // fixed-list values — the one case where the tool's defaults are what was
  // asked. NOT the same as Jev returning nothing: an unanswered call must never
  // license running on defaults (the `macroIndicator({})` trap).
  let namedNone = false;
  if (unsetEnum.length && (wide || fillableTool(tool))) {
    const result = await deps.ask(
      question,
      argQuestions(tool),
      deps.credentials,
    );
    const { args: fromJev } = fillArgs(tool, result);
    for (const p of unsetEnum)
      if (fromJev[p.name] !== undefined) {
        args[p.name] = fromJev[p.name];
        filled.push(p.name);
      }
    namedNone =
      !!result &&
      enumerableParams(tool).every((p) => {
        const pick = choiceOf(result, p.name);
        return (
          args[p.name] !== undefined ||
          (!!pick &&
            pick.choice === ARG_UNSPECIFIED &&
            pick.confidence >= JEV_CONFIDENCE_GATE)
        );
      });
  }

  // Names: search, then Jev picks among real candidates. `narrow` only when a
  // name is the ONE required value; `full` for any required name still unset.
  const nameParams = wide
    ? def.params.filter(
        (p) =>
          p.required &&
          args[p.name] === undefined &&
          entityKindFor(tool, p.name),
      )
    : [soleEntityParam(tool)].filter(
        (p): p is ToolParam => !!p && args[p.name] === undefined,
      );
  for (const p of nameParams) {
    const kind = entityKindFor(tool, p.name);
    if (!kind) continue;
    const term =
      kind === "company"
        ? extractCompanyName(question)
        : extractPersonName(question);
    const { entity } = await resolveEntity(
      question,
      kind,
      term,
      deps.search ?? dbEntitySearch,
      deps.ask,
      deps.credentials,
    );
    if (entity) {
      args[p.name] = entity.value;
      filled.push(p.name);
    }
  }

  args = settleArgs(tool, args);
  const valid = validateToolArgs(tool, args);
  // Never run with NOTHING supplied — the `args: {}` trap the argument rule
  // exists for — unless the question demonstrably names no value, in which
  // case the defaults are the answer asked for. „Demonstrably" is:
  //   full     Jev positively said so for the tool's fixed-list parameters;
  //   extract  that, AND every other unset parameter is one an extractor
  //            looked for unambiguously (`TypedArgs.read`) — so finding
  //            nothing means nothing was named. A tool with an unset text /
  //            name parameter still asks: nothing here could have seen a
  //            hospital or a molecule in the question.
  const enumSettled = unsetEnum.length === 0 || namedNone;
  const restNamedNone = def.params.every(
    (p) =>
      (valid ?? args)[p.name] !== undefined ||
      p.values?.length ||
      readAbsent.has(p.name),
  );
  const defaultsAsked =
    (mode === "full" && namedNone) ||
    (mode === "extract" && enumSettled && restNamedNone);
  if (
    valid &&
    argsSufficient(tool, valid) &&
    (filled.length > 0 || defaultsAsked)
  )
    return { kind: "run", route: { tool, args: valid }, filled };
  return clarify(valid ?? args);
};

/** The question the lane asks instead of answering with a tool it believes is
 *  wrong. Template-written, like every answer in this lane. */
export const jevClarifyText = (
  c: Extract<JevCompletion, { kind: "clarify" }>,
  lang: Lang,
): string => {
  const def = TOOLS_BY_NAME[c.tool];
  const topic = def ? def.description[lang] : c.tool;
  const need = c.missing.map((p) => p.description[lang]).filter(Boolean);
  if (lang === "bg")
    return need.length
      ? `Изглежда питате за: ${topic} За да отговоря, уточнете: ${need.join("; ")}.`
      : `Изглежда питате за: ${topic} Можете ли да зададете въпроса по-конкретно?`;
  return need.length
    ? `It looks like you are asking about: ${topic} To answer, please specify: ${need.join("; ")}.`
    : `It looks like you are asking about: ${topic} Could you ask a little more specifically?`;
};

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
      routerUnsure: asked && routing.unsure ? true : undefined,
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
      // `unsure` is excluded explicitly: a below-gate answer carries no route
      // and no failure, and reading that pair as a decline would refuse to
      // answer exactly the turns the fallback exists for.
      const declinedByJev =
        !routing.route && !routing.degraded && !routing.unsure;
      if (declinedByJev) {
        usedJev = true;
        declined = true;
      } else {
        const deterministic = route(question, ctx);
        let accepted = acceptJevPick(routing.route, deterministic);
        // A pick the argument rule refused — Jev chose a tool that takes
        // parameters, and the rules chose another — is where Jev is CORRECTING
        // the rules. Complete it (see `completeJevPick`); if its parameters
        // cannot be supplied without a generative model, ASK rather than answer
        // with the rules' tool, which is wrong in exactly these cases.
        if (routing.route && !accepted.usedJev) {
          const done = await completeJevPick(
            question,
            routing.route.tool,
            deterministic,
            {
              ask: this.ask,
              credentials: this.credentials?.(),
              search: this.search,
            },
            // Stage 3: measured best of the three on every question variant
            // (ai/evals-internal/jev_noai_stages.json).
            "extract",
          );
          if (done.kind === "clarify") {
            usedJev = true;
            asked = true;
            return {
              text: jevClarifyText(done, ctx.lang),
              env: null,
              meta: { ...meta(), routerAskedUser: true },
            };
          }
          accepted = { route: done.route, usedJev: true };
          // Never a bare `true`: the band claims values were supplied, so the
          // flag must be derived from values actually filled.
          argsFilled = done.filled.length > 0;
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
