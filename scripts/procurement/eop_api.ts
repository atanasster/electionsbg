// Anonymous client for the ЦАИС ЕОП WCF JSON service behind app.eop.bg.
//
// The service is `https://service.eop.bg/NX1Service.svc/<Method>` — POST, JSON body
// with NAMED parameters (the signatures are self-describing at /NX1Service.svc/js).
// Everything here was verified to answer with no session, cookie or token; see
// docs/plans/tender-dossier-ingest-v1.md §1.
//
// ⚠️ THE ANONYMOUS SURFACE IS EXACTLY THE `GetPublic*` / `GetPublished*` PREFIX,
// plus RetrieveTenderAnnouncementDocuments. 16 other per-tender methods were probed
// and every one is denied (401 ErrorCode 1, or 403 ErrorCode 2) — including
// GetEvaluatedOffersByTenderId, so per-bidder scores are NOT available as structured
// data anywhere. Do not add a method here without probing it first.
//
// ⚠️ THE INVARIANT, inherited verbatim from the CR Deeds crawl (which exists because
// fetch_company_founded silently corrupted its own table by persisting `null` for
// every failure mode): an ANSWER and a FAILURE are different things and must never
// share a representation. Hence the discriminated result below — there is no way to
// hand a caller a "successful empty" that was actually a timeout. A confirmed empty
// body IS an answer (the register said "nothing here") and is returned as ok with
// `body: null`; a transport error is `ok: false` and must be retried, never stored.
//
// Measured behaviour (300-call burst, concurrency 6, 2026-08-03): 8.97 req/s,
// p50 567ms / p90 794ms / p99 2222ms, NO throttling (mean latency improved across the
// run), and 1.3% transient `fetch failed`. Retries are therefore mandatory, and the
// default concurrency is set at the measured-safe 6 rather than guessed higher.
//
// ⚠️ "No throttling" is evidence about a 300-call burst, NOT about a 26-hour crawl.
// Reading only this far is what left the first revision with no 429 handling at all —
// see the global throttle brake below, which exists for exactly that gap.

const SERVICE = "https://service.eop.bg/NX1Service.svc";
const ORIGIN = "https://app.eop.bg";

/** Politeness + identification. The register's robots.txt is `Allow: /`. */
const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Origin: ORIGIN,
  Referer: `${ORIGIN}/`,
  "User-Agent": "electionsbg.com data pipeline (procurement/eop-dossier)",
};

export const EOP_API_VERSION = "service.eop.bg/NX1Service.svc/v1";
export const IANA_TZ = "Europe/Sofia";

/** Why a call did not produce an answer. Every one of these is retryable EXCEPT
 *  `denied`, which means the method is not on the anonymous surface at all. */
export type EopFailReason =
  | "transport" // fetch threw — DNS, reset, timeout
  | "http" // non-200 that is not an auth denial
  | "denied" // 401/403 — not anonymous; retrying cannot help
  | "throttled" // 429/503 — the register asked us to slow down
  | "malformed"; // 200 with a body that is not JSON

export type EopResult<T> =
  | { ok: true; body: T | null; status: number }
  | { ok: false; reason: EopFailReason; status?: number; detail?: string };

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// ---- global throttle brake ---------------------------------------------------
//
// ⚠️ WHY A PROCESS-WIDE BRAKE AND NOT JUST A PER-CALL RETRY (plan §13.3).
// The first version folded 429 into the generic `http` branch: three tries at a
// fixed 400/800 ms backoff, then a recorded failure. Under real throttling, N
// concurrent workers would each independently hammer and then write failure rows —
// i.e. the crawl answers "slow down" by speeding up, and a 26-hour run could
// manufacture ~830k failures. No 429 was ever observed in ~1,700 requests, which is
// exactly why this was easy to get wrong: §2.1's "no throttling" is evidence about a
// 300-call burst, not about the full crawl.
//
// So a 429/503 sets a shared deadline that EVERY worker waits behind, honouring
// `Retry-After` when the register sends one. Cheap when it never fires.

const THROTTLE_STATUSES = new Set([429, 503]);
/** Cap so a hostile or malformed Retry-After cannot park the crawl for hours. */
const MAX_BACKOFF_MS = 120_000;
const DEFAULT_THROTTLE_MS = 5_000;
/** Ceiling on throttle-only retries, separate from `tries`.
 *
 *  Five, not more: with the escalation below (5s·2^n) the worst case is
 *  5+10+20+40+80 ≈ 155 s of waiting on ONE subject before it is finally recorded.
 *  Eight would be ~8.5 minutes, which is long enough that a throttled crawl looks
 *  hung rather than slow. */
const MAX_THROTTLE_RETRIES = 5;

let brakeUntil = 0;
let throttleHits = 0;

/** Seconds or an HTTP-date, per RFC 9110. Returns null when absent/unparseable.
 *  Exported for eop_api.test.ts — a wrong parse here either ignores the register's
 *  instruction or parks the crawl. */
export const parseRetryAfter = (v: string | null): number | null => {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  // Numeric-looking values are delay-seconds and are handled ONLY here. Falling
  // through to Date.parse for a malformed number is a trap: Date.parse("-1")
  // returns 2001-01-01, whose delta clamps to 0 — so a garbage Retry-After would
  // mean "no backoff at all" precisely when the register is asking us to stop.
  // A bad number returns null so the caller applies its own default instead.
  if (/^[+-]?\d+(\.\d+)?$/.test(t)) {
    const secs = Number(t);
    return Number.isFinite(secs) && secs >= 0
      ? Math.min(secs * 1000, MAX_BACKOFF_MS)
      : null;
  }
  const at = Date.parse(t);
  if (Number.isFinite(at))
    return Math.min(Math.max(0, at - Date.now()), MAX_BACKOFF_MS);
  return null;
};

const applyBrake = (ms: number): void => {
  throttleHits++;
  brakeUntil = Math.max(brakeUntil, Date.now() + ms);
};

/** Every worker waits behind the shared deadline before issuing a request. */
const awaitBrake = async (): Promise<void> => {
  for (;;) {
    const wait = brakeUntil - Date.now();
    if (wait <= 0) return;
    // Jitter, so N workers do not all observe the deadline crossing the same
    // millisecond and re-burst the register with `concurrency` simultaneous requests
    // — which is the first thing it sees after telling us to slow down.
    await sleep(Math.min(wait, MAX_BACKOFF_MS) + Math.random() * 250);
  }
};

/** How many times the register asked us to slow down — surfaced by the crawlers so
 *  a throttled run is visible in its summary rather than only in the failure rows. */
export const throttleCount = (): number => throttleHits;

/** One line for a crawler's run summary, or null when the register never throttled.
 *  Lives beside the state it describes so both crawlers report a throttle in the
 *  same words — the operator reading them is the same person. */
export const throttleSummary = (): string | null =>
  throttleHits
    ? `  ⚠ the register throttled us ${throttleHits} time(s) — the run backed off and ` +
      `continued, but re-check the concurrency before the next full pass.`
    : null;

/** Test-only. The brake is process-wide by design, which makes it sticky across
 *  tests sharing a module registry; without this a test that trips it silently
 *  delays every later test in the file. */
export const __resetThrottleForTests = (): void => {
  brakeUntil = 0;
  throttleHits = 0;
};

/**
 * One anonymous call, with bounded retries on the transient reasons only.
 *
 * `tries` counts TOTAL attempts. A `denied` result short-circuits: the method is
 * not public, and hammering it neither helps us nor is polite.
 */
export const eopCall = async <T = unknown>(
  method: string,
  params: Record<string, unknown>,
  opts: { tries?: number; baseDelayMs?: number } = {},
): Promise<EopResult<T>> => {
  const tries = opts.tries ?? 3;
  const base = opts.baseDelayMs ?? 400;
  let last: EopResult<T> = { ok: false, reason: "transport" };
  // A throttle gets its OWN budget and does not consume `tries`. Charging it against
  // the retry budget means the crawl abandons a subject purely because the register
  // was busy — turning a slow run into a failure-manufacturing one. The brake IS the
  // wait; the separate ceiling is what stops an indefinite hang.
  let throttleRetries = 0;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) await sleep(base * attempt);
    await awaitBrake();
    let res: Response;
    try {
      res = await fetch(`${SERVICE}/${method}`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(params),
      });
    } catch (e) {
      last = {
        ok: false,
        reason: "transport",
        detail: (e as Error).message.slice(0, 120),
      };
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      // Not on the anonymous surface. Deterministic — do not retry.
      return { ok: false, reason: "denied", status: res.status };
    }
    if (THROTTLE_STATUSES.has(res.status)) {
      // Engage the brake BEFORE consuming the body, so sibling workers start waiting
      // immediately rather than after this one finishes reading.
      const hinted = parseRetryAfter(res.headers.get("retry-after"));
      // Escalate when the register gives no hint — 5s, 10s, 20s … capped. A flat
      // backoff means ten consecutive throttles back off exactly as far as one.
      const ms =
        hinted ??
        Math.min(DEFAULT_THROTTLE_MS * 2 ** throttleRetries, MAX_BACKOFF_MS);
      applyBrake(ms);
      last = {
        ok: false,
        reason: "throttled",
        status: res.status,
        detail: `backing off ${ms}ms`,
      };
      if (++throttleRetries <= MAX_THROTTLE_RETRIES) attempt--;
      continue;
    }
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      last = {
        ok: false,
        reason: "transport",
        detail: (e as Error).message.slice(0, 120),
      };
      continue;
    }
    if (!res.ok) {
      last = {
        ok: false,
        reason: "http",
        status: res.status,
        detail: text.slice(0, 120),
      };
      continue;
    }
    // A 200 with an empty body is the service's "nothing here" — an ANSWER.
    // (GetPublishedTenderDetails returns it for unpublished/draft tenderIds, which
    // is how the id-space walk distinguishes them; see §9.3 of the plan.)
    if (text === "") return { ok: true, body: null, status: res.status };
    try {
      return { ok: true, body: JSON.parse(text) as T, status: res.status };
    } catch {
      // Malformed JSON on a 200 is not transient — the service does not do this
      // under load, so a retry would just re-fetch the same broken body.
      return {
        ok: false,
        reason: "malformed",
        status: res.status,
        detail: text.slice(0, 120),
      };
    }
  }
  return last;
};

// ---- the per-tender surface -------------------------------------------------
// Every one takes `ianaTimeZone` except where noted; the service uses it to render
// its `/Date(ms)/` values, so passing a consistent zone keeps the store stable.

const withTz = (tenderId: number) => ({ tenderId, ianaTimeZone: IANA_TZ });

export const getTenderDetails = <T = unknown>(tenderId: number) =>
  eopCall<T>("GetPublishedTenderDetails", withTz(tenderId));

export const getAnnouncements = <T = unknown>(tenderId: number) =>
  eopCall<T>("GetPublicTenderAnnouncementsByTenderId", withTz(tenderId));

export const getExports = <T = unknown>(tenderId: number) =>
  eopCall<T>("GetPublishedTenderExportsByTenderId", withTz(tenderId));

export const getContractItems = <T = unknown>(tenderId: number) =>
  eopCall<T>("GetPublishedContractListItems", withTz(tenderId));

export const getLots = <T = unknown>(tenderId: number) =>
  eopCall<T>("GetPublishedLots", withTz(tenderId));

/** Documents attached to ONE announcement (протокол / доклад / решение). Note this
 *  method is NOT `Get*Public*`-prefixed yet is anonymous — verified 2026-08-03. */
export const getAnnouncementDocuments = <T = unknown>(announcementId: number) =>
  eopCall<T>("RetrieveTenderAnnouncementDocuments", {
    tenderAnnouncementId: announcementId,
  });

/** Buyer profile — address / NUTS / EIK, keyed by the OrganizationId that every
 *  GetPublishedTenderDetails response already carries. */
export const getBuyerProfile = <T = unknown>(organizationId: number) =>
  eopCall<T>("GetPublicBuyerProfileBasicInformation", { organizationId });

/** Presigned blob URL for one document. **30-MINUTE EXPIRY** — never persist the
 *  result; store (documentId, container, cloudName) and re-mint on demand. */
export const getSignedUrl = <T = unknown>(documentId: number) =>
  eopCall<T>("GetSignedUrlByDocumentId", { documentId });

// ---- WCF date helper ---------------------------------------------------------

/**
 * The service serialises dates as `/Date(1788555599000)/` (epoch ms, sometimes with
 * a trailing timezone offset). Returns an ISO string, or null for null/unparseable —
 * null here means "the service had no date", which is an answer.
 */
export const wcfDate = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const m = v.match(/\/Date\((-?\d+)/);
  if (!m) return null;
  const ms = Number(m[1]);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
};

// ---- bounded-concurrency map -------------------------------------------------

/**
 * Run `fn` over `items` with at most `concurrency` in flight, preserving order.
 * Deliberately not Promise.all over the whole list: the crawl is 127k tenders and
 * the service is a shared public register.
 */
export const mapPool = async <T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrency, items.length)) },
      () => worker(),
    ),
  );
  return out;
};
