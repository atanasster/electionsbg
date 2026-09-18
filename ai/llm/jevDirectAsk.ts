// The operator harness's transport to Jev: straight to the TypeSafe API with
// the operator's own key. Shared by the lane runner and the gate sweep, so the
// two measure through the same calls.
import { callSystemOne, MODEL } from "./fcEval.jev";
import type { askJev } from "./jevClient";

/** An `askJev`-shaped function that calls the TypeSafe API directly, for the
 *  node harness. Shares `callSystemOne` (retries, backoff) with fcEval.jev.ts.
 *
 *  ⚠️ THIS IS NOT THE PRODUCTION TRANSPORT, AND EVERY DIFFERENCE FLATTERS THE
 *  LANE. Read the published number as "how well Jev routes", never as "how
 *  often the chat will route through Jev":
 *
 *    production                     this harness
 *    1.2s client budget             no timeout
 *    2s server abort                —
 *    no retries in the turn         6 retries, 2–14s backoff
 *    circuit breaker after 3 fails  none
 *    model pinned (jev-1.13.0)      jev-latest
 *    payload validated by our proxy sent straight to the API
 *
 *  The last row is the one that bit: two registry tools produced option text
 *  over the proxy's limit, so production 400'd on every routing call while
 *  this harness scored perfectly. `jevPrompt.payload.test.ts` now gates it. */
export const failures = new Map<string, number>();
export const directAsk =
  (apiKey: string, maxRetries?: number): typeof askJev =>
  async (state, questions) => {
    const { res, latencyMs, error } = await callSystemOne(
      apiKey,
      { state, model: MODEL, questions },
      { maxRetries },
    );
    if (error || !res?.answers) {
      // Counted by cause, so a run can say whether its fallbacks were rate
      // limits (an artifact of the harness) or real rejections (a defect).
      const cause = (error ?? "no answers").slice(0, 60);
      failures.set(cause, (failures.get(cause) ?? 0) + 1);
      return null;
    }
    return {
      answers: res.answers as never,
      model: res.model,
      usage: res.usage,
      latencyMs,
    };
  };
