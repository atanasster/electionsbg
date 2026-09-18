// The ONE definition of how a tool catalogue is presented to Jev.
//
// This exists because the production router (ai/llm/jev.ts) and the eval
// harness (ai/llm/fcEval.jev.ts) MUST ask the question the same way — the
// harness is what produced the 96% EN / 95% BG figure the provider's header
// cites, and that claim is only true while the two prompts agree. Kept
// dependency-free (no registry, no client) so either side can import it.
//
// ⚠️ Changing anything here invalidates the measured accuracy. Re-run
// ai/llm/jevRegression.run.ts and the fc_eval artifact before trusting the old
// numbers again.

/** The option Jev picks when no tool fits. A Choice MUST return one of its
 *  listed options — it cannot abstain on its own — so "call nothing" only
 *  exists as an answer because we offer it. */
export const NO_TOOL = "no_tool";

export const NO_TOOL_DESCRIPTION =
  "None of the other options apply to the request.";

export const TOOL_INSTRUCTIONS =
  "Which tool should handle this user request? Choose no_tool if none of the other options apply.";

/** Hard ceiling on one option's text.
 *
 * ⚠️ THIS IS A PROXY CONSTRAINT, NOT A STYLE CHOICE. `functions/jev_payload.js`
 * rejects any option longer than its own `LIMITS.optionChars` with a 400, and
 * the rejection is per-REQUEST: one over-long tool breaks the whole routing
 * call, so the lane degrades on every turn and the breaker opens. Two registry
 * tools already exceeded 600 characters (`procurementQuery` at 692,
 * `fundingQuery` at 656), which made Jev route NOTHING in production while the
 * direct-API eval harness — which never passes through the proxy — scored
 * perfectly. Capping here means a future long description can never reach that
 * state. `jevPrompt.payload.test.ts` validates the real built payload against
 * the real validator. */
export const MAX_OPTION_CHARS = 560;

/** One option's description.
 *
 * ⚠️ ENGLISH, on purpose, even for Bulgarian questions: that is the
 * configuration the measurement used, and BG queries scored within a point of
 * EN with it. Localising the descriptions is an UNMEASURED change. */
export const toolOptionText = (
  descriptionEn: string,
  paramNames: readonly string[],
): string => {
  const full = paramNames.length
    ? `${descriptionEn} (params: ${paramNames.join(", ")})`
    : descriptionEn;
  // Truncate rather than drop: a shortened description still routes, while an
  // absent option cannot be chosen at all.
  return full.length <= MAX_OPTION_CHARS
    ? full
    : `${full.slice(0, MAX_OPTION_CHARS - 1)}…`;
};

/** Append the abstain option to a built criteria map. */
export const withNoTool = (
  criteria: Record<string, string>,
): Record<string, string> => ({
  ...criteria,
  [NO_TOOL]: NO_TOOL_DESCRIPTION,
});

/** What the eval artifacts record as "the model", so a published number always
 *  says which version produced it. The proxy pins the versioned id; the
 *  operator-run harnesses call the API directly with `jev-latest`. */
export const JEV_MODEL_NOTE = "jev (TypeSafe System One)";
