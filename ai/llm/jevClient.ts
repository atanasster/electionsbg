// Browser-safe client for the Jev (TypeSafe System One) routing call.
//
// Talks to the `systemone` action on our own /api/llm proxy — never to
// api.typesafe.ai directly, because the API key lives server-side (see
// functions/jev_payload.js). The proxy claims and settles the call against the
// same per-question reservation the Gemini path uses.
//
// THE CONTRACT THIS MODULE OWES ITS CALLERS: `ask()` NEVER THROWS and never
// hangs. Every failure — no session, timeout, 429, 5xx, malformed answer, an
// open circuit breaker — comes back as `null`, because Jev is a routing
// accelerator inside a lane and must never be able to take a lane down. The
// caller degrades within the user's OWN lane (deterministic router in the
// No-LLM lane, full Gemini prompt in the AI lane), which is the lane-preserving
// rule from docs/plans/jev-chat-integration-v1.md §6.

import { PROXY_URL, hasAiSession } from "./session";

/** Hard client budget. Measured p95 at the full 235-tool registry is ~656 ms
 *  (docs/plans/jev-typesafe-eval-v1.md), so this is ~2x headroom rather than a
 *  guess.
 *
 *  ⚠️ COUPLED to the server's own abort — the `AbortSignal.timeout(...)` inside
 *  the `body.action === "systemone"` branch of `functions/llm_http.js`. That one
 *  must stay LARGER than this one: the server releases the question's
 *  reservation when its handler finishes, and while the reservation is inflight
 *  our lane's fallback (a `complete` on the same questionId) is rejected with
 *  `429 call_limit`. If the server held the socket past this budget, the
 *  slow-Jev case would become a hard failure in exactly the degraded scenario
 *  the ladder exists to absorb.
 *
 *  The two values live in different packages (browser ESM vs CommonJS Cloud
 *  Function), so there is no shared constant — jevClient.test.ts reads the
 *  server's literal out of that file instead, so changing one fails on the
 *  other. */
export const JEV_TIMEOUT_MS = 1200;

/** Circuit breaker: after this many consecutive failures, stop calling Jev for
 *  `BREAKER_COOLDOWN_MS` so an outage costs ONE timeout rather than one per
 *  turn. Without it every turn during an incident pays the full budget before
 *  falling back. */
export const BREAKER_THRESHOLD = 3;
export const BREAKER_COOLDOWN_MS = 60_000;

export type JevChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type JevNoulAnswer = { type: "noul"; noul: number };
// Score is deliberately absent: nothing in the chat asks a Score question, and
// the proxy validates the full primitive set anyway. Add it here when a caller
// actually needs one rather than carrying an unused shape.
export type JevAnswer = JevChoiceAnswer | JevNoulAnswer;

export type JevQuestion =
  | {
      type: "choice";
      instructions: unknown;
      criteria: Record<string, string | null>;
    }
  | {
      type: "noul";
      instructions: unknown;
      criteria?: { true?: unknown; false?: unknown };
    };

export type JevResult = {
  answers: Record<string, JevAnswer>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  /** Wall-clock for the call, reported in the chat's "how produced" band.
   *  Measured HERE — the server never sends it. */
  latencyMs: number;
};

export type JevCredentials = { sessionToken: string; questionId: string };

/** Exactly what `functions/llm_http.js` projects for `action: "systemone"` —
 *  the upstream response is NOT forwarded verbatim. `latencyMs` is ours and is
 *  measured client-side, so it is deliberately absent here. */
type JevWireResponse = Pick<JevResult, "answers" | "model" | "usage">;

// ---- circuit breaker (module state: one chat session, one breaker) ---------
let consecutiveFailures = 0;
let openUntil = 0;

export const jevBreakerOpen = (now = Date.now()): boolean => now < openUntil;

/** Clears ALL module state — the breaker counters and the last skip reason.
 *  A test seam today; the routing caller should also call it when the user
 *  starts a new chat, so a new conversation does not inherit the previous
 *  one's diagnostic. */
export const resetJevBreaker = (): void => {
  consecutiveFailures = 0;
  openUntil = 0;
  lastSkip = null;
};

const recordFailure = (now: number): void => {
  consecutiveFailures++;
  if (consecutiveFailures >= BREAKER_THRESHOLD) {
    openUntil = now + BREAKER_COOLDOWN_MS;
    // Half-open: the next call after the cooldown is allowed through, and a
    // success resets the count. Keeping the counter AT the threshold (rather
    // than zeroing it) means a still-broken upstream re-opens on one failure
    // instead of needing three again.
    consecutiveFailures = BREAKER_THRESHOLD;
  }
};

/** Why a routing call did not produce an answer. Surfaced for telemetry and to
 *  distinguish "Jev said no route" (a real answer) from "Jev never ran".
 *
 *  ⚠️ `lastJevSkip()` is MODULE state, so the pairing
 *  `const r = await askJev(...); if (!r) report(lastJevSkip())` is only valid
 *  while calls do not overlap — which holds today (one routing call per turn).
 *  It is cleared at the start of every call AND on success, so a stale reason
 *  can never outlive the call it belongs to. */
export type JevSkipReason =
  | "no_session"
  | "breaker_open"
  | "timeout"
  | "http_error"
  | "malformed"
  | "network";

let lastSkip: JevSkipReason | null = null;
export const lastJevSkip = (): JevSkipReason | null => lastSkip;

const skip = (reason: JevSkipReason): null => {
  lastSkip = reason;
  return null;
};

/**
 * Ask Jev a batch of typed questions about one `state`.
 *
 * Questions are evaluated in parallel upstream at near-zero added latency, so
 * callers should batch everything they need for the turn into ONE call rather
 * than chaining.
 *
 * ⚠️ Single-flight: `lastJevSkip()` is module state, so a caller pairing a
 * `null` return with the reason must not have two calls in flight at once.
 *
 * @returns the typed answers, or `null` on ANY failure (see `lastJevSkip()`).
 *   Never throws.
 */
export const askJev = async (
  state: unknown,
  questions: Record<string, JevQuestion>,
  credentials: JevCredentials | undefined,
  opts: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    now?: () => number;
  } = {},
): Promise<JevResult | null> => {
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? fetch;
  lastSkip = null;

  // No reservation, no call. The No-LLM lane has no Turnstile session by
  // design, so this is the ordinary path there — not an error, and it must not
  // raise an AI notice, cost a clock read, or touch the breaker.
  if (!credentials || !hasAiSession()) return skip("no_session");
  // One reading, used for both the breaker check and the latency baseline, so
  // an injected clock in tests measures elapsed time rather than call ordering.
  const started = now();
  if (jevBreakerOpen(started)) return skip("breaker_open");

  try {
    const res = await fetchImpl(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Credentials FIRST: they come from a server response typed by assertion
      // rather than checked, so an unexpected `action` key on them must not be
      // able to shadow the action the proxy dispatches on.
      body: JSON.stringify({
        ...credentials,
        action: "systemone",
        state,
        questions,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? JEV_TIMEOUT_MS),
    });
    if (!res.ok) {
      recordFailure(now());
      // Deliberately NOT setAiNotice(): a routing failure is invisible to the
      // user because the lane still answers. Raising the AI banner here would
      // report an outage that did not happen.
      return skip("http_error");
    }
    // A 200 whose body will not parse is the SERVER's fault, not the network's
    // — a hosting interstitial or an edge error page arrives exactly this way
    // (this project has been burned by "200 with the SPA shell stamped
    // application/json" before). Its own guard keeps it out of the "network"
    // bucket, which would otherwise point telemetry at users' connections.
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      recordFailure(now());
      return skip("malformed");
    }
    // Narrow rather than assert: this is untrusted JSON, and `!data.answers`
    // would pass for "yes", 42 or []. The readers below narrow again at read
    // time, but the type must not claim a shape nothing checked.
    const answers =
      data && typeof data === "object" && "answers" in data
        ? (data as { answers: unknown }).answers
        : null;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      recordFailure(now());
      return skip("malformed");
    }
    const wire = data as JevWireResponse;
    consecutiveFailures = 0;
    openUntil = 0;
    lastSkip = null;
    return {
      answers: wire.answers,
      model: wire.model,
      usage: wire.usage,
      latencyMs: now() - started,
    };
  } catch (error) {
    recordFailure(now());
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return skip(timedOut ? "timeout" : "network");
  }
};

// ---- typed answer readers --------------------------------------------------
// Narrow at the boundary so callers never hand-check `type`, and a shape the
// upstream did not send reads as "no answer" rather than as a default value.

/** The Choice answer under `id`, or null if the question was not answered or
 *  came back as a different primitive. Never throws on a malformed payload. */
export const choiceOf = (
  result: JevResult | null,
  id: string,
): JevChoiceAnswer | null => {
  const a = result?.answers?.[id];
  return a && a.type === "choice" && typeof a.choice === "string" ? a : null;
};

/** The Noul probability (0–1) under `id`, or null when absent or mistyped.
 *  ⚠️ Null is NOT 0 — "the question was not answered" and "the answer is no"
 *  are different, and a caller that coalesces them asserts the latter. */
export const noulOf = (result: JevResult | null, id: string): number | null => {
  const a = result?.answers?.[id];
  return a && a.type === "noul" && typeof a.noul === "number" ? a.noul : null;
};
