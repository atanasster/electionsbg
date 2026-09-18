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
  choiceOf,
  noulOf,
  type JevQuestion,
  type JevResult,
} from "./jevClient";
import { JEV_CONFIDENCE_GATE, toolCriteria } from "./jev";
import { NO_TOOL, TOOL_INSTRUCTIONS } from "./jevPrompt";

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
