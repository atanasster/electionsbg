// The per-município terminal status, and the one rule that decides it.
//
// Extracted from the CLI handler because the single most consequential
// line in the whole ingest — "reached, touched nothing, and a lookup
// failed ⇒ UNVERIFIED, do not merge, do not stamp" — lived inside a
// ~300-line function that mixes argument parsing, I/O, the dispatcher
// race and the report, and so could not be tested without running the
// binary against live council websites.
//
// `not-reached` is deliberately the ZERO value: every target starts there
// and nothing ever assigns it, so a município the loop never got to still
// says so. That is what stops a truncated run reading as a quiet one.

export type RunStatus =
  | "not-reached"
  | "ok"
  | "no-new"
  | "unverified"
  | "dry"
  | "failed"
  | "timed-out"
  | "abandoned"
  | "skipped";

export const STATUS_LABEL: Record<RunStatus, string> = {
  "not-reached": "NOT REACHED",
  ok: "ok",
  "no-new": "no new",
  // Reached, touched zero protocols, and at least one LOOKUP failed —
  // absence of evidence, not evidence of absence, so it is neither merged
  // nor stamped. Казанлък on 2026-08-09 is the case: the Wayback index
  // 429'd and the council host refused every connection, so "0 new
  // protocols" would have been a claim we had no basis for.
  unverified: "UNVERIFIED",
  dry: "dry",
  failed: "FAILED",
  "timed-out": "TIMED OUT",
  abandoned: "ABANDONED",
  skipped: "skipped",
};

export type RunOutcome = {
  /** The dispatcher threw. */
  threw?: boolean;
  /** …because the hard stop fired while it was still running. */
  abandoned?: boolean;
  /** …or because the wall-clock budget ran out. */
  budgetExpired?: boolean;
  /** Sittings whose documents were actually read. */
  protocolsTouched: number;
  /** Requests that failed to yield the resource (transport, 5xx, 429). */
  lookupFailures: number;
  /** --dry: parsed and reported, nothing written. */
  dry?: boolean;
};

/**
 * The rule. Order matters: abandonment outranks a budget expiry, because
 * an abandoned dispatcher is a budget expiry PLUS a stall the fetch layer
 * could not abort, and naming the milder of the two would send the
 * operator looking at HTTP timeouts for a wedged pdftotext.
 */
export const classify = (o: RunOutcome): RunStatus => {
  if (o.threw) {
    if (o.abandoned) return "abandoned";
    return o.budgetExpired ? "timed-out" : "failed";
  }
  if (o.dry) return "dry";
  if (o.protocolsTouched > 0) return "ok";
  // Nothing touched. The discriminator is whether we managed to LOOK:
  // a clean run that finds nothing is a fact about the council, a run
  // whose lookups failed is a fact about the network.
  return o.lookupFailures > 0 ? "unverified" : "no-new";
};
