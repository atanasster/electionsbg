// How far the per-município `sinceDate` watermark may advance after a run.
//
// The naive rule — "advance to the newest resolution we parsed" — loses
// protocols permanently, and silently. Parsers filter candidates on
// `date > sinceDate`, so if a run downloads two protocols dated 07-01 and
// 07-15, the 07-01 PDF times out and the 07-15 one parses, the watermark
// moves to 07-15 and 07-01 is never a candidate again. The run reports it
// once, as one line among the "N fetch error(s)", and then it is gone.
//
// The rule here: the watermark may only reach a date such that EVERY
// protocol at or below it was ingested. Per `MuniScrapeError.kind` —
//
//   * a DISCOVERY failure (a `fetch` with no `date`) freezes it entirely.
//     An un-enumerated year means we cannot know what we did not see, so
//     there is no date we can honestly claim to be complete through.
//   * a per-protocol `fetch` failure caps it strictly below that
//     protocol's date, so the next run rediscovers and retries it.
//   * a `content` failure (a scanned PDF, an unsupported variant) does
//     NOT cap it. Retrying identically will never help, and freezing on
//     one un-OCRable protocol would re-download everything after it on
//     every run for ever. It goes on the deferred ledger instead.
//   * an `enrich` failure does neither. The protocol was ingested; only
//     an optional extra (a per-councillor protokol, an OCR unlock, the
//     roster join) failed, so nothing is missing to come back for.
//
// The deferred ledger, in state/ingest/council_<key>.json, is the durable
// record of what we know we are missing. It carries exactly the entries
// the watermark can no longer bring back:
//
//   * `content` skips, and `fetch` failures that have exhausted their
//     attempts, persist until the URL is finally ingested. Not re-reporting
//     one proves nothing, because nothing will re-attempt it.
//   * a still-blocking `fetch` failure persists only while it keeps being
//     reported. The watermark is already holding the line for it, and a
//     run that stops reporting it has fetched it.
//
// `attempts` is the escape valve. A protocol that fails for ever — the
// município renamed or deleted the file — would otherwise hold the
// watermark for ever, and every daily run would re-walk the whole window
// to retry one dead URL. After MAX_BLOCKING_ATTEMPTS it stops blocking and
// stays on the ledger, with its count, until it succeeds or an operator
// forces it with --since-date.
//
// The watermark never moves BACKWARDS: rewinding to retry one protocol
// would re-walk everything since, and the parser surfaces nothing new for
// it anyway. A blocking failure older than the current watermark is
// recorded on the ledger and left for that operator.

import type { CouncilResolution, MuniScrapeError } from "./types";

/**
 * How many consecutive runs one protocol may hold the watermark before we
 * accept it is not coming back. Five daily runs ≈ a working week — long
 * enough to ride out an outage, short enough that a single dead URL does
 * not wedge a município's ingest indefinitely.
 */
export const MAX_BLOCKING_ATTEMPTS = 5;

export type DeferredProtocol = {
  url: string;
  date?: string;
  message: string;
  /** ISO timestamp of the run that first deferred it — how long it's been stuck. */
  firstSeen: string;
  /** Consecutive runs that have failed on it, this one included. */
  attempts: number;
  /** True once it has stopped holding the watermark back. */
  givenUp?: boolean;
};

export type WatermarkInput = {
  /** The watermark this run started from ("" / undefined on a first run). */
  previous?: string;
  /** Everything successfully parsed this run. */
  resolutions: Pick<CouncilResolution, "date" | "sourceUrl">[];
  errors: MuniScrapeError[];
  /** Carried over from the state file. */
  previousDeferred?: DeferredProtocol[];
  /** ISO timestamp stamped onto newly deferred entries. */
  now: string;
};

export type WatermarkDecision = {
  /** What to store as `sinceDate`. */
  next: string;
  /** Set when the watermark was held below the newest date ingested. */
  heldBy?: MuniScrapeError;
  /** The "known missing" ledger to store. */
  deferred: DeferredProtocol[];
  /** Entries this run cleared because the protocol finally landed. */
  resolved: DeferredProtocol[];
  /** Entries that crossed MAX_BLOCKING_ATTEMPTS on this run. */
  gaveUp: DeferredProtocol[];
};

const maxDate = (dates: string[]): string | undefined =>
  dates.length === 0 ? undefined : dates.reduce((a, b) => (a > b ? a : b));

export const computeWatermark = (input: WatermarkInput): WatermarkDecision => {
  const previous = input.previous ?? "";
  const ingestedUrls = new Set(input.resolutions.map((r) => r.sourceUrl));
  const ingestedDates = input.resolutions.map((r) => r.date).filter(Boolean);
  const newest = maxDate(ingestedDates) ?? previous;
  const prior = new Map(
    (input.previousDeferred ?? []).map((d) => [d.url, d] as const),
  );

  // An `enrich` failure costs us nothing we could come back for, so it is
  // out of both the ledger and the watermark decision.
  const missing = input.errors.filter((e) => e.kind !== "enrich");

  // ---- the ledger ---------------------------------------------------------
  const resolved = (input.previousDeferred ?? []).filter((d) =>
    ingestedUrls.has(d.url),
  );
  const ledger = new Map<string, DeferredProtocol>();
  for (const d of input.previousDeferred ?? []) {
    // Only entries nothing will re-attempt are carried on their own. A
    // still-blocking one has to earn its place by being re-reported below.
    if (!ingestedUrls.has(d.url) && d.givenUp) ledger.set(d.url, d);
  }

  const gaveUp: DeferredProtocol[] = [];
  for (const e of missing) {
    // A discovery step is not an artefact — its URL is a year index, so
    // nothing would ever clear it. It freezes the watermark instead, which
    // is both sufficient and self-clearing.
    if (!e.date && e.kind !== "content") continue;
    if (ingestedUrls.has(e.url)) continue; // another variant of it did land
    const before = prior.get(e.url);
    const attempts = (before?.attempts ?? 0) + 1;
    const givenUp = e.kind === "content" || attempts >= MAX_BLOCKING_ATTEMPTS;
    const entry: DeferredProtocol = {
      url: e.url,
      date: e.date ?? before?.date,
      message: e.message,
      // Keep the ORIGINAL sighting — that is what says "stuck for three
      // weeks" rather than "since today".
      firstSeen: before?.firstSeen ?? input.now,
      attempts,
      givenUp,
    };
    if (givenUp && !before?.givenUp && e.kind !== "content") gaveUp.push(entry);
    ledger.set(e.url, entry);
  }
  const deferred = [...ledger.values()].sort(
    (a, b) =>
      (a.date ?? "").localeCompare(b.date ?? "") || a.url.localeCompare(b.url),
  );

  // ---- how far the watermark may go ---------------------------------------
  const blocking = missing.filter(
    (e) => e.kind !== "content" && !ledger.get(e.url)?.givenUp,
  );
  const undated = blocking.find((e) => !e.date);
  const earliest = blocking
    .filter((e) => e.date)
    .reduce<
      MuniScrapeError | undefined
    >((a, b) => (a && a.date! <= b.date! ? a : b), undefined);

  let next: string;
  if (undated) {
    next = previous;
  } else if (earliest) {
    // Advance only to the newest protocol strictly OLDER than the earliest
    // failure — the parser's filter is `date > sinceDate`, so this leaves
    // the failed protocol a candidate next run.
    next = maxDate(ingestedDates.filter((d) => d < earliest.date!)) ?? previous;
  } else {
    next = newest;
  }
  if (previous && next < previous) next = previous;

  return {
    next,
    heldBy: next < newest ? (undated ?? earliest) : undefined,
    deferred,
    resolved,
    gaveUp,
  };
};
