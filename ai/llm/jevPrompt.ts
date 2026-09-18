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

/** One option's description.
 *
 * ⚠️ ENGLISH, on purpose, even for Bulgarian questions: that is the
 * configuration the measurement used, and BG queries scored within a point of
 * EN with it. Localising the descriptions is an UNMEASURED change. */
export const toolOptionText = (
  descriptionEn: string,
  paramNames: readonly string[],
): string =>
  paramNames.length
    ? `${descriptionEn} (params: ${paramNames.join(", ")})`
    : descriptionEn;

/** Append the abstain option to a built criteria map. */
export const withNoTool = (
  criteria: Record<string, string>,
): Record<string, string> => ({
  ...criteria,
  [NO_TOOL]: NO_TOOL_DESCRIPTION,
});
