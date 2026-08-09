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
//   * a `discovery` failure — a year index, a CDX query — freezes it
//     entirely. An un-enumerated year means we cannot know what we did not
//     see, so no date in that window can be claimed complete.
//   * a per-protocol `fetch` failure caps it strictly below that
//     protocol's date, so the next run rediscovers and retries it. An
//     UNDATED one (three parsers learn the sitting date from inside the
//     document, so a download failure precedes it) has to freeze instead
//     of capping — correct, but coarse, which is why parsers hoist the
//     date wherever it is in scope.
//   * a `content` failure (a scanned PDF, an unsupported variant) does
//     NOT cap it. Retrying identically will never help, and freezing on
//     one un-OCRable protocol would re-download everything after it on
//     every run for ever. It goes on the deferred ledger instead.
//   * an `enrich` failure does neither. The protocol was ingested; only
//     an optional extra (a per-councillor protokol, an OCR unlock, the
//     roster join) failed, so nothing is missing to come back for.
//
// A TRUNCATED candidate list freezes it too, and that one is the trap the
// rest of this file would otherwise miss entirely. `--max N` makes every
// parser sort newest-first and drop the rest; a dropped candidate raises
// no error at all, so without `candidatesDropped` the run looks clean and
// the watermark jumps to the newest of the N it did read. Everything older
// in that window is then filtered out by `date > sinceDate` for ever —
// the same permanent loss a failed download causes, with not even the one
// line of output. `SKILL.md` documented `--max 5` without `--dry`.
//
// The deferred ledger, in state/ingest/council_<key>.json, is the durable
// record of what we know we are missing. It carries exactly the entries
// the watermark can no longer bring back:
//
//   * `content` skips, and `fetch` failures that have exhausted their
//     attempts, persist until the URL is finally ingested. The watermark
//     has moved past them, so nothing will re-attempt them and silence
//     proves nothing.
//   * everything still being retried — a blocking `fetch`, and ANY
//     `discovery` step, given up on or not — persists only while it keeps
//     being reported. A discovery step runs on every pass regardless of
//     the watermark, so a run that stops reporting it has read it.
//
// `attempts` is the escape valve, and it covers every kind. A URL that
// fails for ever — the município renamed the file, or restructured the
// site out from under a year index — would otherwise hold the watermark
// for ever, with every daily run re-walking the whole window to retry it.
// After MAX_BLOCKING_ATTEMPTS it stops blocking and stays on the ledger,
// with its count, until it succeeds or an operator forces it with
// --since-date. The undated case needs this MORE than the dated one, not
// less: a dead year index is not masked by UNVERIFIED, because a parser
// walking several indexes with one dead still touches protocols, so the
// run is stamped green while the watermark silently never moves again.
//
// The watermark never moves BACKWARDS: rewinding to retry one protocol
// would re-walk everything since, and the parser surfaces nothing new for
// it anyway. A blocking failure older than the current watermark is
// recorded on the ledger and left for that operator.
//
// The ledger is CAPPED. Several parsers defer a page URL while the
// resolutions carry a document URL, so those entries can never match
// `ingestedUrls` and are immortal by construction; without a cap the state
// file grows for the lifetime of the município. Over the cap the OLDEST
// are dropped and the drop is reported, because a ledger that silently
// forgets is the thing this module exists to prevent.

import type { CouncilResolution, MuniScrapeError } from "./types";

/**
 * How many consecutive runs one protocol may hold the watermark before we
 * accept it is not coming back. Five daily runs ≈ a working week — long
 * enough to ride out an outage, short enough that a single dead URL does
 * not wedge a município's ingest indefinitely.
 */
export const MAX_BLOCKING_ATTEMPTS = 5;

/**
 * Ceiling on stored ledger entries per município. Far above any healthy
 * value — a município with 100 known-missing protocols has a source
 * problem, not a bookkeeping problem — so hitting it is itself a signal.
 */
export const MAX_DEFERRED_ENTRIES = 100;

export type DeferredProtocol = {
  url: string;
  /**
   * Which class of failure put it here. Load-bearing for the carry rule
   * below, not decoration: a `discovery` step is re-attempted on EVERY
   * run whatever the watermark says, so silence means it recovered — but
   * a `fetch` or `content` entry the watermark has moved past is never
   * re-attempted, so silence there means nothing at all.
   */
  kind: MuniScrapeError["kind"];
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
  /**
   * In-window candidates the run deliberately never looked at (`--max`).
   * Non-zero freezes the watermark: "we did not look at everything" is the
   * same fact as an un-enumerated index, and it raises no error of its own.
   */
  candidatesDropped?: number;
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
  /** Set instead of `heldBy` when a truncated candidate list froze it. */
  heldByTruncation?: number;
  /** The "known missing" ledger to store. */
  deferred: DeferredProtocol[];
  /** Entries this run cleared because the protocol finally landed. */
  resolved: DeferredProtocol[];
  /** Entries that crossed MAX_BLOCKING_ATTEMPTS on this run. */
  gaveUp: DeferredProtocol[];
  /** Entries dropped because the ledger hit MAX_DEFERRED_ENTRIES. */
  evicted: DeferredProtocol[];
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
    if (ingestedUrls.has(d.url)) continue;
    // Carried on its own only when nothing will re-attempt it, so silence
    // could not have cleared it. Everything else — a still-blocking
    // failure, and any discovery step, given up on or not — has to earn
    // its place by being re-reported below.
    if (d.givenUp && d.kind !== "discovery") ledger.set(d.url, d);
  }

  const gaveUp: DeferredProtocol[] = [];
  for (const e of missing) {
    if (ingestedUrls.has(e.url)) continue; // another variant of it did land
    const before = prior.get(e.url);
    const attempts = (before?.attempts ?? 0) + 1;
    // `content` is given up on immediately — nothing will re-attempt it.
    // Everything else, INCLUDING an undated failure and a discovery step,
    // gets the same attempts valve: the module's argument for the valve
    // ("a protocol that fails for ever would otherwise hold the watermark
    // for ever") applies exactly as hard to a year index that 404s after a
    // site restructure, and that case is not even masked by UNVERIFIED —
    // a parser walking several year indexes with one permanently dead
    // still touches protocols, so the run is stamped green while the
    // watermark never moves again.
    const givenUp = e.kind === "content" || attempts >= MAX_BLOCKING_ATTEMPTS;
    const entry: DeferredProtocol = {
      url: e.url,
      kind: e.kind,
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
  const ordered = [...ledger.values()].sort(
    (a, b) =>
      (a.date ?? "").localeCompare(b.date ?? "") || a.url.localeCompare(b.url),
  );
  // Over the cap, drop the entries first seen longest ago — they are the
  // ones an operator has had the most chances to act on — and hand them
  // back so the run can say what it dropped.
  const evicted: DeferredProtocol[] = [];
  let deferred = ordered;
  if (ordered.length > MAX_DEFERRED_ENTRIES) {
    const byAge = [...ordered].sort((a, b) =>
      a.firstSeen.localeCompare(b.firstSeen),
    );
    const drop = new Set(
      byAge.slice(0, ordered.length - MAX_DEFERRED_ENTRIES).map((d) => d.url),
    );
    evicted.push(...ordered.filter((d) => drop.has(d.url)));
    deferred = ordered.filter((d) => !drop.has(d.url));
  }

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
  const dropped = input.candidatesDropped ?? 0;

  let next: string;
  if (dropped > 0 || undated) {
    // Either way the honest statement is the same: we did not look at
    // everything in this window, so no date in it can be claimed complete.
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

  const held = next < newest;
  return {
    next,
    heldBy: held && !(dropped > 0) ? (undated ?? earliest) : undefined,
    heldByTruncation: held && dropped > 0 ? dropped : undefined,
    deferred,
    resolved,
    gaveUp,
    evicted,
  };
};
