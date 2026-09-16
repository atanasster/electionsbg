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
 * "nothing narrows yet": the BG catalogue alone serializes to 85,121 bytes, a typical
 * 6-turn window lands at 88,901, and a window saturated at the system's own
 * `CLOUD_BUDGET` of 1,200 tokens reaches 92,249 — over this budget. So the narrowing
 * path is live today for the largest BG contexts, not only after the registry grows.
 * (An earlier revision of the plan claimed otherwise; the plan was corrected.)
 *
 * ENFORCEMENT lives in the caller: this module measures and `narrowCatalogueForBudget`
 * in `openrouter.ts` is what prunes, using `prunePrefixToBudget`.
 */
export const ROUTING_BYTE_BUDGET = INPUT_BYTE_CEILING - ROUTING_MARGIN;

// THERE IS DELIBERATELY NO TOOL-COUNT CAP HERE, and removing the one that existed is
// a measured decision. `K_MAX = 24` was intended as an attention bound on top of the
// byte bound; measured 2026-09-16 it was the ONLY binding constraint — the
// pre-selected set for a saturated BG thread (203 tools) already fits the budget at
// 83,343 B, so the byte bound pruned nothing and the count cap did all of it. The
// cost was the gold tool being unreachable for 9.9% of the eval corpus (35.5% of
// non-verbatim calls) against 0.5% with the byte bound alone, for a "lost in the
// middle" effect nobody has measured. The plan's own position is not to fund a design
// on that argument, so the BYTE bound is the sole pruner and the only cap is the
// request itself.

import { buildToolSystemPrompt } from "../orchestrator/prompts";
import { TOOLS_BY_NAME } from "../tools/registry";

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
 * The routing request for a candidate set (or the FULL catalogue when `candidates` is
 * undefined), as the proxy will see it. THE one place step 7's `fits` callback and
 * `selectRoute` compose the request, so the two cannot measure different things — an
 * earlier design had the caller assemble the label and the prompt itself, which would
 * have let the measurement drift from what was sent.
 */
export type RoutingMessage = { role: "system" | "user"; content: string };

export const routingMessages = (
  lang: "bg" | "en",
  candidates: readonly string[] | undefined,
  userContent: string,
): RoutingMessage[] => [
  {
    role: "system",
    content: buildToolSystemPrompt(
      lang,
      candidates?.map((n) => TOOLS_BY_NAME[n]).filter(Boolean),
    ),
  },
  { role: "user", content: userContent },
];

/** Plan C1's signature: the exact byte count of a routing request. */
export const routingRequestBytes = (
  lang: "bg" | "en",
  candidates: readonly string[] | undefined,
  userContent: string,
): number => proxyMessageBytes(routingMessages(lang, candidates, userContent));

/**
 * How many bytes of slack remain before the budget is exceeded. Negative means the
 * request would already have narrowed. Reported rather than inferred, because the
 * growth arithmetic (bytes ÷ the average tool entry) is what dates this work.
 */
export const budgetHeadroom = (messages: readonly BudgetMessage[]): number =>
  ROUTING_BYTE_BUDGET - proxyMessageBytes(messages);
