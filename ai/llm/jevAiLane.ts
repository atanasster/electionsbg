// The AI lane's Jev pre-step: one batched call that answers three things about
// a turn before Gemini is asked anything.
//
// Questions run in parallel upstream at near-zero added latency, so asking all
// three costs about what asking one does — which is the whole reason the
// smart-home pattern batches upfront instead of chaining
// (docs.typesafe.ai/demos/smart-home).
//
//   tool         — which tool handles this (or no_tool)
//   is_compound  — does the request contain more than one distinct ask?
//   kind         — a data question, a conversational one, or off-topic?
//
// ⚠️ LANE-PRESERVING. Everything here is an ACCELERATOR for the AI lane. When
// Jev cannot answer, the caller runs the FULL Gemini prompt — Gemini's own tool
// selection with its own arguments, i.e. exactly today's behaviour. It must
// never fall back to keyword routing: that would silently downgrade a user who
// asked for the model to a weaker answer than they would have got without Jev
// in the path at all (docs/plans/jev-chat-integration-v1.md §6).

import {
  askJev,
  choiceOf,
  noulOf,
  type JevCredentials,
  type JevQuestion,
  type JevResult,
} from "./jevClient";
import { JEV_CONFIDENCE_GATE, toolCriteria } from "./jev";
import { NO_TOOL, TOOL_INSTRUCTIONS } from "./jevPrompt";
import { TOOLS_BY_NAME } from "../tools/registry";

/** Above this, the turn is treated as asking for more than one thing. Noul
 *  returns a probability, not a boolean, so the threshold is ours to set; 0.7
 *  matches the Choice gate rather than inventing a second number. */
export const COMPOUND_THRESHOLD = 0.7;

export const TURN_KINDS = {
  data: "A question about the data this assistant holds — elections, budgets, procurement, people, prices.",
  conversational:
    "General conversation, a greeting, a question about the assistant itself, or a general-knowledge question the data cannot answer.",
  off_topic: "Unrelated to this assistant's subject matter entirely.",
} as const;

export type TurnKind = keyof typeof TURN_KINDS;

/** The batched question set for one AI-lane turn. */
export const aiTurnQuestions = (): Record<string, JevQuestion> => ({
  tool: {
    type: "choice",
    instructions: TOOL_INSTRUCTIONS,
    criteria: toolCriteria(),
  },
  is_compound: {
    type: "noul",
    instructions:
      "Does this message ask for more than one distinct thing — two separate questions, or one question about two different subjects that would need separate answers?",
    criteria: {
      true: "Two or more separate asks, e.g. 'What was the turnout, and who won in Varna?'",
      false:
        "One ask, however long. Naming several items inside ONE comparison is still one ask.",
    },
  },
  kind: {
    type: "choice",
    instructions: "What kind of message is this?",
    criteria: { ...TURN_KINDS },
  },
});

export type AiTurnPlan = {
  /** The tool Jev picked, if it was confident enough and a tool applies. */
  tool: string | null;
  toolConfidence?: number;
  /** True when Jev confidently said NO tool fits — a real answer, not a gap. */
  noTool: boolean;
  compound: boolean;
  kind: TurnKind | null;
  /** True when Jev could not answer at all: the caller must run the FULL
   *  Gemini prompt, never a weaker router. */
  degraded: boolean;
};

const DEGRADED: AiTurnPlan = {
  tool: null,
  noTool: false,
  compound: false,
  kind: null,
  degraded: true,
};

/**
 * Interpret one batched answer set.
 *
 * Every field degrades independently and CONSERVATIVELY: an unreadable
 * `is_compound` means "not compound" (answer the single question rather than
 * inventing a split), and an unreadable `kind` means "no opinion" (let the
 * existing path decide). Only an entirely missing result is `degraded`.
 */
export const readAiTurnPlan = (result: JevResult | null): AiTurnPlan => {
  if (!result) return DEGRADED;
  const pick = choiceOf(result, "tool");
  const confident = pick && pick.confidence >= JEV_CONFIDENCE_GATE;
  const compoundP = noulOf(result, "is_compound");
  const kindPick = choiceOf(result, "kind");
  const kind =
    kindPick &&
    kindPick.confidence >= JEV_CONFIDENCE_GATE &&
    kindPick.choice in TURN_KINDS
      ? (kindPick.choice as TurnKind)
      : null;
  return {
    tool: confident && pick.choice !== NO_TOOL ? pick.choice : null,
    toolConfidence: pick?.confidence,
    noTool: !!confident && pick.choice === NO_TOOL,
    // NULL IS NOT FALSE, but for this flag the safe reading of "unknown" IS
    // "not compound": splitting a single question produces two half-answers,
    // while not splitting a compound one answers the primary ask — the same
    // thing the lane does today.
    compound: compoundP != null && compoundP >= COMPOUND_THRESHOLD,
    kind,
    degraded: !pick,
  };
};

/** The prompt that asks the model to split a compound request. Returns atomic
 *  questions, one per line — deliberately a plain list rather than JSON, since
 *  the caller validates and a malformed line is simply dropped. */
export const splitPrompt = (lang: "bg" | "en"): string =>
  lang === "bg"
    ? "Раздели съобщението на отделни, самостоятелни въпроса — по един на ред, без номерация и без обяснения. Всеки въпрос трябва да е разбираем сам по себе си."
    : "Split the message into separate, self-contained questions — one per line, no numbering and no commentary. Each question must stand on its own.";

/** Parse the split reply. Caps the number of parts: a model that misreads the
 *  instruction and returns a paragraph per line would otherwise fan out into
 *  one tool call per line, and every one of them is billed. */
export const MAX_SPLIT_PARTS = 3;

export const parseSplit = (raw: string, original: string): string[] => {
  const parts = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length > 2);
  // Fewer than two usable parts means the split produced nothing to act on —
  // answer the original rather than a reworded version of it.
  if (parts.length < 2) return [original];
  return parts.slice(0, MAX_SPLIT_PARTS);
};

/**
 * What the AI lane does with Jev's pick: JEV PICKS THE TOOL, THE MODEL FILLS
 * ITS PARAMETERS.
 *
 *   run   Jev is confident and the tool takes no parameters — run it; no
 *         model routing call at all.
 *   fill  Jev is confident and the tool takes parameters — ask the model to
 *         fill them for THAT ONE TOOL. The routing prompt then carries one tool
 *         description instead of the ~85 KB catalogue.
 *   full  Jev is unsure, unavailable, or named no tool — the full routing
 *         prompt, exactly as without Jev. Never keyword routing: a reader who
 *         chose the model must not get the rules because Jev was unsure.
 *
 * WHY: measured on questions the rules were never built from (typos,
 * rewording, Latin script — ai/llm/jevRobustness.ts), Jev's pick is right
 * 86–95% of the time and 94–97% when confident, but it cannot produce an
 * open parameter value; the model can. Before this, a Jev pick was used only
 * for parameter-free tools, so most of its correct picks were thrown away.
 *
 * Shared by the provider and the eval, so the eval measures the rule that
 * ships (`ai/llm/currentEval.run.ts jev_gemini`).
 *
 * ⚠️ The tool must EXIST in the registry: an unknown name has no parameter
 * list, and treating "no parameters found" as "takes no parameters" would send
 * an invented name straight to `runTool`.
 */
export type JevRoutingStep =
  | { kind: "run"; tool: string }
  | { kind: "fill"; tool: string }
  | { kind: "full" };

export const jevRoutingStep = (plan: AiTurnPlan | null): JevRoutingStep => {
  const def = plan?.tool ? TOOLS_BY_NAME[plan.tool] : undefined;
  if (!def) return { kind: "full" };
  return def.params.length === 0
    ? { kind: "run", tool: def.name }
    : { kind: "fill", tool: def.name };
};

/**
 * Upstream calls one question may make — MUST equal `POLICY.calls` in
 * `functions/llm_security.js`, which reserves them and answers the next one
 * with 429 `call_limit`. Duplicated rather than imported because the two live
 * in different packages; `jevAiLane.budget.test.ts` holds them equal.
 *
 * The Jev pre-step spends one. A turn is jev + route + narrate = 3, so any
 * extra call (a split, a summary, a second routing attempt) must be paid for
 * by dropping something — the lane words the answer from its template rather
 * than let the narration call be rejected.
 */
export const CALLS_PER_QUESTION = 3;

/** The AI lane's Jev hook: one batched call, read into a plan. */
export const jevAiTurnPlan =
  (ask: typeof askJev = askJev) =>
  async (
    question: string,
    credentials: JevCredentials | undefined,
  ): Promise<AiTurnPlan> =>
    readAiTurnPlan(await ask(question, aiTurnQuestions(), credentials));
