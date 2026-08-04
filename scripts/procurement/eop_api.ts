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
  | "malformed"; // 200 with a body that is not JSON

export type EopResult<T> =
  | { ok: true; body: T | null; status: number }
  | { ok: false; reason: EopFailReason; status?: number; detail?: string };

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

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
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) await sleep(base * attempt);
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
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () =>
      worker(),
    ),
  );
  return out;
};
