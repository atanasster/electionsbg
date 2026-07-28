// Shared client for the Registry Agency Commerce-Register deed API:
//   GET https://portal.registryagency.bg/CR/api/Deeds/{eik}   (no auth, no CAPTCHA)
//
// Extracted from scripts/procurement/fetch_company_founded.ts so the founding-date
// crawler and the full raw-capture crawler (fetch_cr_deeds.ts) share ONE hardened
// fetch path. See DUP-001 in the 2026-07-27 review and §0 of
// docs/plans/cr-deeds-capture-v1.md: a verbatim copy forks these semantics, and only
// one fork gets the next fix.
//
// ⚠️ THE INVARIANT THIS MODULE PROTECTS. A caller may only persist an ANSWER
// (`ok: true`). `ok: true` with `parsed === null` means "the register answered and
// has no such company" (a confirmed empty 200). `ok: false` means "we could not
// reach it" and must NEVER be written as data — because every resume query skips an
// EIK already present, a failure written as an answer becomes a permanent, silent
// lie no later run revisits. The original founding-date crawler wrote a bare `null`
// for every failure mode and poisoned ~4,100 reachable firms as "undated" before
// this discriminated result replaced it.
//
// ⚠️ MUST use curl, not Node's fetch: the CR host TLS-fingerprints and returns HTTP
// 500 to undici (verified) but 200 to curl.
//
// MEASURED RESPONSE SHAPES (live API, 2026-07-27):
//   • a real company → 200, ~5–41KB JSON object with keys
//     deedStatus / companyName / uic / uicWithCtx / legalForm / sections
//   • an unknown EIK → 200 with an EMPTY BODY (it does NOT 404), confirmed twice
//   • a block/interstitial → a 200 that is not JSON, or valid JSON without the deed
//     shape ({}, [], null, {"Message":…}); never persist these
//   • 404 does not occur in practice ⇒ treated as a failure (WAF/edge), never as an
//     answer, or a WAF-served 404 would reintroduce the permanent-poisoning bug.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export const DEEDS_URL = (eik: string) =>
  `https://portal.registryagency.bg/CR/api/Deeds/${eik}`;

export const BASE_PACE_MS = 5000; // 1 req / 5s per the measured token bucket
export const MAX_PACE_MS = 120_000; // ceiling for the adaptive widening
export const PACE_GROWTH = 1.5; // multiplier applied per consecutive failure
export const MAX_RETRY = 5;
// Once the source is clearly refusing us, retrying six times per EIK spends the
// token budget re-asking a question already answered.
export const DEGRADED_AFTER = 3;
export const DEGRADED_MAX_RETRY = 1;
// Two consecutive empty 200s is the register's "no such company" (measured).
export const EMPTY_CONFIRM = 2;
export const MAX_CONSECUTIVE_FAILURES = 10; // circuit breaker — bail instead of grinding
export const MAX_SILENCE_MS = 20 * 60_000; // …or 20 min with no answer at all

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Collect every `fieldEntryDate` (and `recordMinActionDate`) string in the tree
// and return the minimum's date part (YYYY-MM-DD), or null. This is the company's
// founding date (the earliest surviving current field entry — see §0a of the plan;
// the body carries no history, so it is not literally the registration date).
export const minEntryDate = (root: unknown): string | null => {
  let min: string | null = null;
  const walk = (v: unknown): void => {
    if (v == null) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (
          (k === "fieldEntryDate" || k === "recordMinActionDate") &&
          typeof val === "string" &&
          /^\d{4}-\d\d-\d\d/.test(val)
        ) {
          const d = val.slice(0, 10);
          if (min === null || d < min) min = d;
        } else {
          walk(val);
        }
      }
    }
  };
  walk(root);
  return min;
};

/**
 * Is this parsed body an actual deed tree, or something that merely happens to be
 * valid JSON? Deliberately a POSITIVE assertion keyed on the measured top-level
 * shape: "JSON.parse didn't throw" is not evidence the register answered. `null`,
 * `[]`, `{}`, `"blocked"` and the stock ASP.NET `{"Message":"An error has
 * occurred."}` envelope all parse cleanly and would each be a permanent lie.
 */
export const isDeedTree = (v: unknown): boolean => {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return "uic" in o || "deedStatus" in o || "sections" in o;
};

/**
 * The register either ANSWERED (`ok: true`) or it did NOT (`ok: false`). On an
 * answer, `body`/`parsed` are the raw JSON string and its parse — or BOTH null for
 * the confirmed-empty-200 "no such company". Only an answer may be persisted.
 */
export type DeedFetchResult =
  | {
      ok: true;
      body: string | null; // null ⇒ confirmed empty 200 (no such company)
      parsed: unknown | null; // the parsed deed tree, or null alongside body
      status: number;
      attempts: number;
    }
  | { ok: false; reason: string; status: number | null; attempts: number };

export type CurlRunner = (url: string) => Promise<{ stdout: string }>;

// `-w \n%{http_code}` appends the status as a trailing line so we can detect
// 429/500 without --fail eating the body. 30s timeout, 10MB buffer.
export const curlRunner: CurlRunner = (url) =>
  pexec("curl", ["-s", "-m", "30", "-w", "\n%{http_code}", url], {
    maxBuffer: 10_000_000,
  });

/**
 * Fetch one EIK's deed body with the full hardening: curl, 429 exp-backoff,
 * empty-200 confirmation, positive deed-shape check, and a bounded retry budget.
 * Returns the raw body so a caller can persist it verbatim (raw capture) or derive
 * a field from it (founding date) without a second fetch.
 */
export const fetchDeed = async (
  eik: string,
  opts: { run?: CurlRunner; pace?: number; maxRetry?: number } = {},
): Promise<DeedFetchResult> => {
  const { run = curlRunner, pace = BASE_PACE_MS, maxRetry = MAX_RETRY } = opts;
  // Sleeping before we give up buys nothing — on the 429 ladder the final backoff
  // alone was 51% of a failed EIK's total cost.
  const backoff = async (ms: number, attempt: number): Promise<void> => {
    if (attempt < maxRetry) await sleep(ms);
  };

  let lastStatus: number | null = null;
  let lastReason = "no-attempt";
  let emptyStreak = 0;
  let attempt = 0;

  for (; attempt <= maxRetry; attempt++) {
    let out: string;
    try {
      ({ stdout: out } = await run(DEEDS_URL(eik)));
    } catch {
      // curl itself failed (timeout, DNS, connection reset) — no answer.
      lastReason = "curl-failed";
      emptyStreak = 0;
      await backoff(pace * (attempt + 1), attempt);
      continue;
    }
    const nl = out.lastIndexOf("\n");
    const status = Number(out.slice(nl + 1).trim());
    const body = out.slice(0, nl);
    lastStatus = status;

    if (status === 429) {
      lastReason = "rate-limited";
      emptyStreak = 0;
      await backoff(pace * Math.pow(2, attempt), attempt);
      continue;
    }
    // 404 is NOT treated as "no such company": the register answers an unknown EIK
    // with an empty 200 (measured), so a 404 here is far more likely to be an
    // edge/WAF layer — and persisting it would look legitimate in http_status
    // while being exactly the original bug.
    if (status !== 200) {
      lastReason = `http-${status}`;
      emptyStreak = 0;
      await backoff(pace * (attempt + 1), attempt);
      continue;
    }
    if (!body.trim()) {
      // An empty 200 IS the register's "no such company" — but confirm it, since a
      // truncated/dropped response looks identical on a single sample.
      emptyStreak++;
      if (emptyStreak >= EMPTY_CONFIRM)
        return {
          ok: true,
          body: null,
          parsed: null,
          status,
          attempts: attempt + 1,
        };
      lastReason = "empty-body";
      await backoff(pace, attempt);
      continue;
    }
    emptyStreak = 0;

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      // A 200 that isn't JSON is a block/interstitial page, not an answer.
      lastReason = "unparseable-body";
      await backoff(pace * (attempt + 1), attempt);
      continue;
    }
    if (!isDeedTree(parsed)) {
      lastReason = "unexpected-shape";
      await backoff(pace * (attempt + 1), attempt);
      continue;
    }
    return { ok: true, body, parsed, status, attempts: attempt + 1 };
  }
  return {
    ok: false,
    reason: lastReason,
    status: lastStatus,
    attempts: attempt,
  };
};

/** Adaptive pace: widen on failure, decay back toward the base on success. */
export const makePacer = (base: number, max: number, growth: number) => {
  let cur = base;
  return {
    onOk: () => {
      cur = Math.max(base, Math.round(cur / growth));
    },
    onFail: () => {
      cur = Math.min(max, Math.round(cur * growth));
    },
    get current() {
      return cur;
    },
  };
};
