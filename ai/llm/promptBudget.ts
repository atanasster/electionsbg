// The routing request's byte budget, in ONE place (plan C1).
//
// The cloud proxy refuses any request whose `JSON.stringify(messages)` exceeds
// `POLICY.inputBytes` (`functions/llm_security.js`), and the failure is silent:
// `openrouter.ts` catches the 413, falls back to the keyword router, and still
// narrates with the model — so the answer keeps its "AI" label while the routing
// came from the 76–83%-accurate deterministic engine. This module exists so the
// client can measure the request it is about to send and never reach that path.
//
// The count is EXACT, not an estimate: the proxy re-serializes only `{role,
// content}` and measures the result, so mirroring that computation here reproduces
// it byte for byte. No token heuristic is involved.

// MUST equal `POLICY.inputBytes` in `functions/llm_security.js`. Duplicated rather
// than imported because that file is a CommonJS Node module and this one is
// bundled for the browser; `promptBudget.test.ts` asserts the two agree, so a
// policy change fails a test instead of shipping a stale ceiling.
export const INPUT_BYTE_CEILING = 96_000;

// Headroom under the ceiling. The count above is exact, so this is not an
// estimation error budget: it covers a future proxy framing change and keeps a
// hard gap. It was 8,000 in an earlier revision, which made narrowing fire
// thousands of bytes earlier than needed, and since the language that narrows
// first is Bulgarian that was paying an accuracy cost for nothing.
export const ROUTING_MARGIN = 4_000;

/**
 * The budget the CLIENT narrows against. Measured 2026-09-16 the truth is not
 * "nothing narrows yet": the BG catalogue alone serializes to 86,192 bytes, a
 * typical 6-turn window lands near 88,500, and a window saturated at the system's
 * own `CLOUD_BUDGET` of 1,200 tokens reaches ~92,500 — over this budget. So the
 * narrowing path is live today for the largest BG contexts, not only after the
 * registry grows. (An earlier revision of the plan claimed otherwise; the plan was
 * corrected to this measurement.)
 *
 * ENFORCEMENT lives in the caller: this module measures, `pruneToBudget` chooses,
 * and step 7 wires both into `OpenRouterProvider.selectRoute`. Nothing imports this
 * yet, so it cannot by itself guarantee anything.
 */
export const ROUTING_BYTE_BUDGET = INPUT_BYTE_CEILING - ROUTING_MARGIN;

// An attention bound, applied ON TOP of the byte bound and never instead of it:
// beyond roughly this many tools in one prompt the model's selection quality is
// expected to degrade (the "lost in the middle" effect). It is a hypothesis, not a
// measurement — the byte bound is what is measured — so it only ever prunes
// further, never licenses a larger prompt.
export const K_MAX = 24;

export type BudgetMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export const utf8Bytes = (s: string): number =>
  new TextEncoder().encode(s).length;

/**
 * The byte count the proxy will compute for this message list: it maps each
 * message to exactly `{role, content}` and stringifies that array, so anything
 * else on a message object is ignored here too.
 */
export const proxyMessageBytes = (messages: readonly BudgetMessage[]): number =>
  utf8Bytes(
    JSON.stringify(messages.map(({ role, content }) => ({ role, content }))),
  );

/**
 * Does this request fit the budget the client narrows against?
 *
 * Takes NO budget parameter on purpose: an optional override defaulting to the
 * budget is a footgun, because a caller passing the CEILING would be type-correct
 * and would silently delete the margin. Use `withinCeiling` for the ceiling.
 */
export const withinBudget = (messages: readonly BudgetMessage[]): boolean =>
  proxyMessageBytes(messages) <= ROUTING_BYTE_BUDGET;

/** Does this request fit the proxy's hard limit (the margin's upper edge)? */
export const withinCeiling = (messages: readonly BudgetMessage[]): boolean =>
  proxyMessageBytes(messages) <= INPUT_BYTE_CEILING;

/**
 * How many bytes of slack remain before the budget is exceeded. Negative means the
 * request would already have narrowed. Reported rather than inferred, because the
 * growth arithmetic (bytes ÷ the average tool entry) is what dates this work.
 */
export const budgetHeadroom = (messages: readonly BudgetMessage[]): number =>
  ROUTING_BYTE_BUDGET - proxyMessageBytes(messages);
