// HTTP helpers for council scraping. All sites we hit (município custom
// CMSes) reject the default Node fetch UA — we always send a real Safari
// UA. Keep a deliberate gap between requests to be polite to small-town
// municipal servers.
//
// Every request is bounded THREE ways, because the failure that actually
// bites is not a refused connection — it is a municipal server that
// completes the TCP handshake and then never speaks. A single overall
// deadline is a blunt instrument for that: too short and a genuinely
// large protokol PDF over a slow link gets cut off mid-download, too long
// and a dead host holds the run for minutes per URL.
//
//   headersMs — connect + first byte. Nothing came back at all.
//   idleMs    — the response started, then went quiet mid-body.
//   totalMs   — the ceiling, even for a body that keeps trickling.
//
// On top of those sit two RUN-level guards, both opened by the
// orchestrator around one município's dispatcher:
//
//   the município budget — a wall-clock deadline. Every request composes
//     its signal, so when it expires the in-flight fetch aborts and every
//     later one fails immediately instead of dialling. That is what turns
//     "one município wedged the whole run" into "one município is marked
//     TIMED OUT and the next one starts".
//
//   the host circuit breaker — after CONSECUTIVE_TIMEOUT_LIMIT transport
//     failures in a row against one host we stop dialling it for the rest
//     of that município. A dead host then costs (limit × headersMs)
//     instead of (every remaining URL × headersMs). Казанлък's
//     brute-force probe alone walks 1,440 URLs: at the 5 s per-probe
//     timeout that is two hours of nothing, which is exactly what
//     happened on 2026-08-09.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Agent } from "undici";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const POLITE_DELAY_MS = 250;

/** Connect + first byte. Generous — some council CMSes are genuinely slow. */
export const DEFAULT_HEADERS_MS = 30_000;

/** Gap between body chunks before we call the response stalled. */
export const DEFAULT_IDLE_MS = 30_000;
/** Overall ceilings, per kind of request. */
export const HTML_TOTAL_MS = 60_000;
export const FILE_TOTAL_MS = 180_000;
export const HEAD_TOTAL_MS = 15_000;

/**
 * undici enforces its OWN connect deadline, default 10 s, covering DNS +
 * TCP + the TLS handshake — so without this dispatcher `headersMs` is a
 * claim we cannot keep: a host that takes 12 s to hand-shake is reported
 * as "no response headers within 30000ms" after we actually waited 10.
 * Measured 2026-08-09, when four council hosts failed at exactly
 * `UND_ERR_CONNECT_TIMEOUT ... timeout: 10000ms` while this file said 30 s.
 *
 * Raising it does NOT rescue a blackholed host (same four hosts still
 * reset ~19.7 s in with the connect timeout at 30 s, on port 80 as well
 * as 443) — the point is that the number we print is now the number we
 * waited, which is what makes the diagnostic worth reading.
 */
const dispatcher = new Agent({ connect: { timeout: DEFAULT_HEADERS_MS } });

/**
 * Consecutive transport failures against one host before we stop dialling
 * it for the remainder of the município. Reset by any response at all —
 * a 404 counts as the host being alive, which is what makes this safe for
 * the brute-force probes that expect mostly 404s.
 */
export const CONSECUTIVE_TIMEOUT_LIMIT = 5;

/**
 * Extra attempts after the first, for one logical lookup. Municipal CMSes
 * drop the odd connection, and without this a single blip is terminal for
 * the whole município: the orchestrator's rule is
 * `protocolsTouched === 0 && lookupFailures > 0`, so one reset on the
 * index page is the difference between a stamped ingest and UNVERIFIED.
 *
 * Only the FINAL failure records a strike or a lookup failure — retrying
 * must not trip the circuit breaker N times faster, nor inflate the count
 * the orchestrator reads.
 */
export const DEFAULT_RETRIES = 2;

/** Backoff before attempt 2 and attempt 3. Short: the município budget is
 *  the real ceiling and these are sequential. */
const RETRY_BACKOFF_MS = [1_000, 3_000];

/**
 * How long a host that answered 429 is left alone, when it names no
 * `Retry-After`. This is PROCESS-wide and deliberately outlives the
 * município budget, because the host that actually does this to us is
 * shared by four parsers: DOB28, HKV34, GAB05 and SZR12 all read
 * web.archive.org's CDX index, one município after another.
 *
 * On 2026-08-09 that IP-level throttle was total — even
 * https://web.archive.org/ returned 429, while archive.org's availability
 * API was 200 — and the run kept dialling it once per município. Backing
 * off is both the honest reading of a 429 and the only way the throttle
 * ever lifts.
 */
export const THROTTLE_COOLDOWN_MS = 120_000;
/** Ceiling on a server-supplied Retry-After, so one bad header cannot
 *  silence a host for the rest of the run. */
const MAX_RETRY_AFTER_MS = 300_000;

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type TimeoutPhase = "headers" | "idle" | "total";

export class FetchTimeoutError extends Error {
  readonly url: string;
  readonly phase: TimeoutPhase;
  readonly ms: number;
  constructor(url: string, phase: TimeoutPhase, ms: number) {
    const what =
      phase === "headers"
        ? `no response headers within ${ms}ms`
        : phase === "idle"
          ? `response stalled — no data for ${ms}ms`
          : `exceeded the ${ms}ms ceiling`;
    super(`${url} → timeout (${what})`);
    this.name = "FetchTimeoutError";
    this.url = url;
    this.phase = phase;
    this.ms = ms;
  }
}

export class BudgetExhaustedError extends Error {
  readonly label: string;
  readonly ms: number;
  constructor(label: string, ms: number) {
    super(
      `${label}: wall-clock budget of ${Math.round(ms / 1000)}s exhausted — remaining requests abandoned`,
    );
    this.name = "BudgetExhaustedError";
    this.label = label;
    this.ms = ms;
  }
}

export class HostUnreachableError extends Error {
  readonly host: string;
  constructor(host: string, strikes: number) {
    super(
      `${host} unreachable — ${strikes} consecutive request(s) failed; skipping the rest of this host for this município`,
    );
    this.name = "HostUnreachableError";
    this.host = host;
  }
}

export class HostThrottledError extends Error {
  readonly host: string;
  readonly untilMs: number;
  constructor(host: string, untilMs: number) {
    super(
      `${host} rate-limited us (HTTP 429) — backing off for another ${Math.ceil((untilMs - Date.now()) / 1000)}s rather than dialling again`,
    );
    this.name = "HostThrottledError";
    this.host = host;
    this.untilMs = untilMs;
  }
}

/** True for the failures that mean "the far end is not answering", as
 *  opposed to a parse error or an HTTP status we understood. */
export const isUnreachable = (err: unknown): boolean =>
  err instanceof FetchTimeoutError ||
  err instanceof HostUnreachableError ||
  err instanceof HostThrottledError ||
  err instanceof BudgetExhaustedError;

// ---------------------------------------------------------------------------
// Process-wide per-host throttle cooldown
// ---------------------------------------------------------------------------

/** host → epoch ms before which we will not dial it again. Deliberately
 *  NOT cleared by beginMuniBudget: the throttling host is shared across
 *  municipalities, which is the whole reason this outlives one budget. */
const cooldowns = new Map<string, number>();

/** Test seam — a fresh process starts with no cooldowns, so nothing in
 *  the production path needs this. */
export const resetHostCooldowns = (): void => cooldowns.clear();

const cooldownUntil = (host: string): number => {
  const until = cooldowns.get(host);
  if (until === undefined) return 0;
  if (until <= Date.now()) {
    cooldowns.delete(host);
    return 0;
  }
  return until;
};

/** Parse `Retry-After` in either of its two legal forms (delta-seconds or
 *  an HTTP-date), clamped. Wayback sends neither, hence the fallback. */
const retryAfterMs = (raw: string | null): number => {
  if (!raw) return THROTTLE_COOLDOWN_MS;
  const secs = Number(raw.trim());
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(raw) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return THROTTLE_COOLDOWN_MS;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
};

// ---------------------------------------------------------------------------
// Per-município wall-clock budget
// ---------------------------------------------------------------------------

type MuniBudget = {
  label: string;
  ctrl: AbortController;
  timer: NodeJS.Timeout;
  deadline: number;
  ms: number;
  expired: boolean;
  /** Consecutive transport failures per host; any response clears the host. */
  strikes: Map<string, number>;
  /**
   * Requests during this município that failed to yield a usable answer —
   * a transport failure, or a status that means "the server did not serve
   * it" (5xx, 429). NOT a 404: that is a definitive answer, and the
   * brute-force session probes are built out of them.
   *
   * The orchestrator reads this to tell "reached, nothing new published"
   * apart from "reached, but we never managed to look". Counting it HERE
   * rather than from MuniScrapeResult.errors is what makes it trustworthy:
   * that array mixes lookup failures with a parser's own editorial skips
   * ("PDF variant skipped"), which would otherwise read as a dead source.
   */
  lookupFailures: number;
  /**
   * One line per failed lookup, capped. The COUNT alone cost an hour on
   * 2026-08-09: ten municipalities each reported "1 failed lookup" and the
   * ten were three unrelated faults — a TCP blackhole on four council
   * hosts, a Cloudflare 520 on two, and an IP-level 429 from
   * web.archive.org on the rest. Which one you are looking at decides
   * whether you fix code, wait, or back off, and the number cannot tell
   * you.
   */
  reasons: string[];
};

/** Enough to classify the fault without turning a 1,440-URL probe's
 *  unwind into a wall of text. */
const MAX_RECORDED_REASONS = 8;

/** Statuses that mean the request did not produce the resource. 429 is in
 *  because the Wayback CDX index rate-limits us on a full run — a 429
 *  there means we never saw the protocol list at all. */
const isFailureStatus = (status: number): boolean =>
  status >= 500 || status === 429;

let budget: MuniBudget | null = null;

/**
 * Open a wall-clock budget around one município's scrape. Every request
 * made while it is open composes its abort signal, so expiry aborts the
 * in-flight request and short-circuits every later one. Idempotent —
 * opening a new budget closes any previous one.
 */
export const beginMuniBudget = (label: string, ms: number): void => {
  endMuniBudget();
  const ctrl = new AbortController();
  const b: MuniBudget = {
    label,
    ctrl,
    deadline: Date.now() + ms,
    ms,
    expired: false,
    strikes: new Map(),
    lookupFailures: 0,
    reasons: [],
    // Replaced immediately below; typed non-optional so callers can't see
    // a half-built budget.
    timer: undefined as unknown as NodeJS.Timeout,
  };
  b.timer = setTimeout(() => {
    b.expired = true;
    ctrl.abort(new BudgetExhaustedError(label, ms));
  }, ms);
  b.timer.unref?.();
  budget = b;
};

export const endMuniBudget = (): void => {
  if (budget) clearTimeout(budget.timer);
  budget = null;
};

export const muniBudgetExpired = (): boolean => budget?.expired ?? false;

export const muniBudgetRemainingMs = (): number =>
  budget ? Math.max(0, budget.deadline - Date.now()) : Number.POSITIVE_INFINITY;

/**
 * How many requests during the open município failed to yield the
 * resource. Zero alongside "0 new protocols" means the council genuinely
 * published nothing; non-zero means we could not see.
 */
export const muniLookupFailures = (): number => budget?.lookupFailures ?? 0;

/**
 * Why those lookups failed — one line each, capped at
 * MAX_RECORDED_REASONS. The orchestrator prints these next to UNVERIFIED
 * so the operator can tell a blocked host from a rate-limited API from a
 * broken origin without re-running anything.
 */
export const muniLookupFailureReasons = (): string[] =>
  budget ? [...budget.reasons] : [];

/** The open budget's abort signal, for callers that own their own fetch
 *  (the Gemini OCR call, which needs a far longer deadline than anything
 *  here but must still stop when the município's time is up). */
export const muniBudgetSignal = (): AbortSignal | undefined =>
  budget?.ctrl.signal;

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * Record one failed LOOKUP — never one failed attempt. `request` calls
 * this exactly once per call, after its retries are spent, so the count
 * the orchestrator reads stays a count of things we could not see rather
 * than of times we tried.
 */
const noteFailure = (url: string, reason: string): void => {
  if (!budget) return;
  budget.lookupFailures++;
  if (budget.reasons.length < MAX_RECORDED_REASONS)
    budget.reasons.push(`${url} — ${reason}`);
  else if (budget.reasons.length === MAX_RECORDED_REASONS)
    budget.reasons.push("… further failures omitted");
};

/** A transport failure: counts toward the per-host breaker as well. */
const recordStrike = (url: string, reason: string): void => {
  if (!budget) return;
  const h = hostOf(url);
  budget.strikes.set(h, (budget.strikes.get(h) ?? 0) + 1);
  noteFailure(url, reason);
};

/**
 * undici reports every transport failure as a bare `TypeError: fetch
 * failed` and hides the real reason on `.cause`. Unwrapped, four
 * municipalities in one run all say "fetch failed" and nothing tells the
 * operator whether that was DNS, a reset, or a TLS refusal.
 */
const describe = (err: unknown): Error => {
  if (!(err instanceof Error)) return new Error(String(err));
  const cause = (err as { cause?: unknown }).cause;
  if (!cause) return err;
  const code = (cause as { code?: string }).code;
  const detail =
    (cause instanceof Error ? cause.message : String(cause)) || String(cause);
  return new Error(`${err.message} (${code ? `${code}: ` : ""}${detail})`);
};

const clearStrikes = (url: string): void => {
  budget?.strikes.delete(hostOf(url));
};

const hostStrikes = (url: string): number =>
  budget?.strikes.get(hostOf(url)) ?? 0;

// ---------------------------------------------------------------------------
// The one request path
// ---------------------------------------------------------------------------

export type FetchOpts = {
  /** Overall ceiling for the whole request including the body. */
  timeoutMs?: number;
  /** Connect + first byte. Defaults to min(DEFAULT_HEADERS_MS, timeoutMs). */
  headersMs?: number;
  /** Gap between body chunks. Defaults to min(DEFAULT_IDLE_MS, timeoutMs). */
  idleMs?: number;
  method?: string;
  accept?: string;
  /** Merged over the defaults, so a caller may override the User-Agent. */
  headers?: Record<string, string>;
  /**
   * Extra attempts after the first. Defaults to DEFAULT_RETRIES. Set 0 for
   * bulk probes where a failure is expected and cheap — Казанлък walks
   * 1,440 speculative URLs, and retrying each would spend the breaker's
   * budget three times over before it could trip.
   */
  retries?: number;
};

const politeSleep = async (): Promise<void> => {
  // Once the budget is blown we are unwinding: the caller's loop still has
  // to walk its remaining URLs, and 250 ms of politeness each turns a
  // 1,440-URL probe into six more minutes of doing nothing.
  if (budget?.expired) return;
  await sleep(POLITE_DELAY_MS);
};

const decodeUtf8 = (buf: Buffer): string => {
  const s = buf.toString("utf8");
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
};

type RawResponse = {
  status: number;
  ok: boolean;
  body: Buffer;
  retryAfter: string | null;
};

/**
 * One attempt. Owns the three watchdogs and the polite delay; knows
 * nothing about retries, strikes or the failure count — those belong to
 * `request`, which is the thing that maps 1:1 onto a lookup.
 */
const attempt = async (url: string, opts: FetchOpts): Promise<RawResponse> => {
  const totalMs = opts.timeoutMs ?? HTML_TOTAL_MS;
  const headersMs = Math.min(opts.headersMs ?? DEFAULT_HEADERS_MS, totalMs);
  const idleMs = Math.min(opts.idleMs ?? DEFAULT_IDLE_MS, totalMs);

  const ctrl = new AbortController();
  const signal = budget
    ? AbortSignal.any([ctrl.signal, budget.ctrl.signal])
    : ctrl.signal;

  // Which watchdog fired, recorded before the abort so the catch below can
  // name the phase rather than reporting a bare "AbortError".
  let phase: TimeoutPhase | null = null;
  const fire = (p: TimeoutPhase) => () => {
    phase ??= p;
    ctrl.abort();
  };

  const totalTimer = setTimeout(fire("total"), totalMs);
  let headersTimer: NodeJS.Timeout | undefined = setTimeout(
    fire("headers"),
    headersMs,
  );
  let idleTimer: NodeJS.Timeout | undefined;

  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        "User-Agent": UA,
        Accept: opts.accept ?? "*/*",
        ...opts.headers,
      },
      signal,
      redirect: "follow",
      // undici-only: makes `headersMs` the real connect+TLS deadline
      // instead of undici's own 10 s default.
      // @ts-expect-error dispatcher is not in the DOM fetch typings
      dispatcher,
    });
    clearTimeout(headersTimer);
    headersTimer = undefined;

    const chunks: Buffer[] = [];
    if (res.body) {
      const reader = res.body.getReader();
      idleTimer = setTimeout(fire("idle"), idleMs);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          clearTimeout(idleTimer);
          if (value) chunks.push(Buffer.from(value));
          idleTimer = setTimeout(fire("idle"), idleMs);
        }
      } finally {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    }

    return {
      status: res.status,
      ok: res.ok,
      body: Buffer.concat(chunks),
      retryAfter: res.headers.get("retry-after"),
    };
  } catch (err) {
    // Budget expiry aborts the same signal, so check it before the phase:
    // "the município ran out of time" is the more useful of the two.
    if (budget?.expired)
      throw new BudgetExhaustedError(budget.label, budget.ms);
    if (phase)
      throw new FetchTimeoutError(
        url,
        phase,
        phase === "headers" ? headersMs : phase === "idle" ? idleMs : totalMs,
      );
    throw describe(err);
  } finally {
    clearTimeout(totalTimer);
    if (headersTimer) clearTimeout(headersTimer);
    if (idleTimer) clearTimeout(idleTimer);
    await politeSleep();
  }
};

/**
 * Statuses worth a second look. A 5xx is usually the origin briefly
 * falling over behind its CDN (Cloudflare's own 520 is exactly that); 429
 * is a request to slow down, which is a retry with a wait.
 *
 * Identical to `isFailureStatus` today, and deliberately a SEPARATE
 * predicate: the two answer different questions, and the first status that
 * splits them is an obvious one — a 403 is a failed lookup that retrying
 * cannot help.
 */
const isRetryableStatus = (status: number): boolean =>
  status >= 500 || status === 429;

/**
 * One logical lookup: the short-circuits, up to DEFAULT_RETRIES extra
 * attempts, and exactly one failure recorded at the end.
 *
 * Nothing here retries past the município budget — a run that is already
 * out of time must unwind, not sleep.
 */
const request = async (url: string, opts: FetchOpts): Promise<RawResponse> => {
  // All three short-circuits are deliberately BEFORE any attempt: they
  // must not pay the polite delay, because their whole purpose is a fast
  // unwind.
  if (budget?.expired) {
    noteFailure(url, "município budget already exhausted");
    throw new BudgetExhaustedError(budget.label, budget.ms);
  }
  const host = hostOf(url);
  const until = cooldownUntil(host);
  if (until > 0) {
    noteFailure(url, `skipped — ${host} is in 429 back-off`);
    throw new HostThrottledError(host, until);
  }
  if (hostStrikes(url) >= CONSECUTIVE_TIMEOUT_LIMIT) {
    noteFailure(url, `skipped — ${host} circuit breaker open`);
    throw new HostUnreachableError(host, hostStrikes(url));
  }

  const maxRetries = Math.max(0, opts.retries ?? DEFAULT_RETRIES);

  for (let i = 0; ; i++) {
    const backoff = RETRY_BACKOFF_MS[Math.min(i, RETRY_BACKOFF_MS.length - 1)];
    // Only the BACKOFF has to fit in what's left, not the attempt after
    // it: the retry composes the budget's abort signal, so an attempt that
    // outruns the budget is cut off rather than overrunning it. Requiring
    // room for the whole worst-case timeout instead is what silently
    // disabled retry altogether — with a 60 s HTML ceiling, any budget
    // under 60 s never retried once, and the guard read as if it did.
    const canRetry =
      i < maxRetries &&
      !budget?.expired &&
      muniBudgetRemainingMs() > backoff + 1_000;

    try {
      const res = await attempt(url, opts);
      // Any complete response — including a 404 — proves the host is
      // alive, so the breaker resets even on a status we count as a
      // failed lookup.
      clearStrikes(url);
      if (!isFailureStatus(res.status)) return res;
      if (canRetry && isRetryableStatus(res.status)) {
        await sleep(backoff);
        continue;
      }
      // Out of attempts. A 429 additionally silences the host process-wide
      // — it asked us to stop, and three parsers behind this one are about
      // to dial the very same API.
      if (res.status === 429) {
        const waitMs = retryAfterMs(res.retryAfter);
        cooldowns.set(host, Date.now() + waitMs);
        noteFailure(
          url,
          `HTTP 429 — rate-limited; backing off from ${host} for ${Math.round(waitMs / 1000)}s`,
        );
      } else {
        noteFailure(url, `HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      if (budget?.expired) {
        noteFailure(url, "município budget exhausted mid-request");
        throw new BudgetExhaustedError(budget.label, budget.ms);
      }
      if (canRetry) {
        await sleep(backoff);
        continue;
      }
      // Timeouts AND connection-level failures (ECONNREFUSED, ENOTFOUND,
      // socket hang up) both count toward the breaker — from here they are
      // the same fact: this host is not answering.
      recordStrike(
        url,
        err instanceof Error
          ? err.message.replace(`${url} → `, "")
          : String(err),
      );
      throw err;
    }
  }
};

export const fetchHtml = async (
  url: string,
  opts: FetchOpts = {},
): Promise<string> => {
  const res = await request(url, {
    ...opts,
    accept: opts.accept ?? "text/html,*/*",
    timeoutMs: opts.timeoutMs ?? HTML_TOTAL_MS,
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return decodeUtf8(res.body);
};

export const fetchJson = async <T>(
  url: string,
  opts: FetchOpts = {},
): Promise<T> => {
  const res = await request(url, {
    ...opts,
    accept: opts.accept ?? "application/json,*/*",
    timeoutMs: opts.timeoutMs ?? HTML_TOTAL_MS,
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return JSON.parse(decodeUtf8(res.body)) as T;
};

/**
 * "Does this URL exist?" Returns the status rather than throwing on it —
 * the brute-force session probes are built entirely out of expected 404s.
 *
 * HEAD is the implementation, not the contract. Plenty of small municipal
 * servers answer 405/501 to a HEAD they would serve happily as a GET, and
 * on a speculative probe that failure mode is the dangerous kind: every
 * URL reads as "not there", the probe finds nothing, and the município
 * reports zero protocols with zero LOOKUP failures — indistinguishable
 * from a council that genuinely published nothing. So the first 405/501
 * from a host switches it to a one-byte ranged GET for the rest of the
 * process.
 *
 * Callers must test `ok`, not `status === 200`: a server honouring the
 * Range answers **206**.
 */
const headUnsupported = new Set<string>();

export const fetchHead = async (
  url: string,
  opts: FetchOpts = {},
): Promise<{ ok: boolean; status: number }> => {
  const host = hostOf(url);
  const ranged = headUnsupported.has(host);
  const res = await request(url, {
    ...opts,
    method: ranged ? "GET" : "HEAD",
    // bytes=0-0 keeps the "cheap" property of a HEAD on a server that
    // honours it, and costs one body on a server that ignores it.
    headers: ranged ? { Range: "bytes=0-0", ...opts.headers } : opts.headers,
    timeoutMs: opts.timeoutMs ?? HEAD_TOTAL_MS,
  });
  if (!ranged && (res.status === 405 || res.status === 501)) {
    headUnsupported.add(host);
    // One retry only — `ranged` is true on the way back in.
    return fetchHead(url, opts);
  }
  return { ok: res.ok, status: res.status };
};

export const fetchToFile = async (
  url: string,
  filePath: string,
  opts: FetchOpts = {},
): Promise<void> => {
  const res = await request(url, {
    ...opts,
    timeoutMs: opts.timeoutMs ?? FILE_TOTAL_MS,
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, res.body);
};

/**
 * Resolve a (possibly relative) href against a base URL. Council CMSes
 * commonly emit href="bg/resheniya-2025-godina" instead of an absolute
 * path; new URL() handles that against the page's base.
 */
export const resolveUrl = (href: string, base: string): string =>
  new URL(href, base).toString();
