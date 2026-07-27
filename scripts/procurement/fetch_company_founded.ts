// Backfill company incorporation dates → the `company_founded` PG table, for the
// newFirmWinner risk flag. Source: the Registry Agency CR API
//   GET https://portal.registryagency.bg/CR/api/Deeds/{eik}   (no auth, no CAPTCHA)
// The initial-entry date is min(fieldEntryDate) over the whole deed tree.
// ⚠️ Fetched via `curl` (child_process), NOT Node fetch: the host TLS-
// fingerprints and 500s undici but serves curl 200 (verified 2026-07-18).
//
// ⚠️ Rate limit ≈ 1 token / ~5s per IP (HTTP 429, no Retry-After). We pace at
// 1 req / 5s, widen the pace as failures accumulate, and trip a circuit breaker
// rather than grinding. The per-IP limit tightens over a long run — a crawl that
// starts healthy can end effectively blocked (measured 2026-07: throughput fell
// to ~30 min/EIK by day 7), so a stalled run must be LOUD, not silent. Total
// runtime is therefore pace-dependent, not a fixed figure: ~14h for ~10k EIKs
// at a healthy 5s, indefinitely longer once the source starts throttling.
//
// ⚠️ A date == 2008 is the ТР re-registration date (register launched
// 2008-01-01), not true founding — recorded as-is; harmless for newFirmWinner
// (such firms are old and never fire).
//
// ⭐ THE INVARIANT THIS SCRIPT EXISTS TO PROTECT: a row in company_founded means
// "the register answered". A NULL founded_date means "it answered, and had no
// dated deed" — it must NEVER mean "we could not reach it". Because the resume
// query skips every EIK already present, a row written on a failed fetch is a
// permanent, silent lie that no later run will revisit. The original version
// returned a bare `null` for every failure mode and wrote it; over the 2026-07
// backfill that recorded ~4,100 reachable firms as undated (daily null rate
// climbed 4.7% → 47.2% in lockstep with the throttling). Failures are now
// counted, never persisted, so the EIK stays unfetched and the next run retries.
//
// MEASURED RESPONSE SHAPES (against the live API, 2026-07-27) — the classifier
// below is built on these, not on guesses:
//   • a real company → 200, ~36KB JSON object with keys
//     deedStatus / companyName / uic / uicWithCtx / legalForm / sections
//   • an unknown EIK → 200 with an EMPTY BODY (it does NOT 404)
//   • 404 does not occur in practice, so it is treated conservatively as a
//     failure rather than as an answer — a WAF-served 404 would otherwise
//     reintroduce exactly the permanent-poisoning bug this file exists to stop.
//
// REPAIR (one-time, after this change — local company_founded still holds the
// ~4,100 pre-provenance poisoned rows):
//   1. tsx …/fetch_company_founded.ts --requeue-nulls --dry-run  # how many rows?
//   2. tsx …/fetch_company_founded.ts --requeue-nulls            # delete untrusted nulls
//   3. tsx …/fetch_company_founded.ts                            # re-crawl (resumable)
//   Verify: SELECT count(*) FROM company_founded WHERE http_status IS NULL;  -- → 0
//
// Resumable: skips EIKs already in company_founded. Idempotent upsert.
//
//   tsx scripts/procurement/fetch_company_founded.ts --limit 40      # sample
//   tsx scripts/procurement/fetch_company_founded.ts --since 2023-01-01
//   tsx scripts/procurement/fetch_company_founded.ts --eiks 200859512,121587769
//   tsx scripts/procurement/fetch_company_founded.ts --probe 20      # measure block state
//   tsx scripts/procurement/fetch_company_founded.ts --pace 15000    # widen base pace (ms)
//   tsx scripts/procurement/fetch_company_founded.ts --requeue-nulls --dry-run
//   tsx scripts/procurement/fetch_company_founded.ts --requeue-nulls --null-since 2026-07-01
//   tsx scripts/procurement/fetch_company_founded.ts --requeue-all-nulls  # incl. verified ones
//   tsx scripts/procurement/fetch_company_founded.ts                 # full backfill

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { allRows, withClient, end } from "../db/lib/pg";

const pexec = promisify(execFile);

const DEEDS_URL = (eik: string) =>
  `https://portal.registryagency.bg/CR/api/Deeds/${eik}`;
export const BASE_PACE_MS = 5000; // 1 req / 5s per the measured token bucket
const MAX_PACE_MS = 120_000; // ceiling for the adaptive widening
const PACE_GROWTH = 1.5; // multiplier applied per consecutive failure
const MAX_RETRY = 5;
// Once the source is clearly refusing us, retrying six times per EIK spends the
// token budget re-asking a question already answered.
const DEGRADED_AFTER = 3;
const DEGRADED_MAX_RETRY = 1;
// Two consecutive empty 200s is the register's "no such company" (measured).
const EMPTY_CONFIRM = 2;
const MAX_CONSECUTIVE_FAILURES = 10; // circuit breaker — bail instead of grinding
const MAX_SILENCE_MS = 20 * 60_000; // …or 20 min with no answer at all
const DEFAULT_PROBE = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Collect every `fieldEntryDate` (and `recordMinActionDate`) string in the tree
// and return the minimum's date part (YYYY-MM-DD), or null.
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
 * Is this parsed body an actual deed tree, or something that merely happens to
 * be valid JSON? Deliberately a POSITIVE assertion keyed on the measured
 * top-level shape: "JSON.parse didn't throw" is not evidence the register
 * answered. `null`, `[]`, `{}`, `"blocked"` and the stock ASP.NET
 * `{"Message":"An error has occurred."}` envelope all parse cleanly and all
 * walk to a null date — writing any of them would be a permanent lie.
 */
export const isDeedTree = (v: unknown): boolean => {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return "uic" in o || "deedStatus" in o || "sections" in o;
};

/**
 * The register either ANSWERED (`ok: true` — `date` is the founding date, or
 * null when it holds no dated deed / no such company) or it did NOT
 * (`ok: false`). Only an answer may be persisted; see the invariant note at the
 * top of this file. The bare `string | null` this replaced could not express the
 * difference, which is exactly how ~4,100 unreachable firms got written as
 * "undated".
 */
export type FetchResult =
  | { ok: true; date: string | null; status: number; attempts: number }
  | { ok: false; reason: string; status: number | null; attempts: number };

type CurlRunner = (url: string) => Promise<{ stdout: string }>;

// ⚠️ MUST use curl, not Node's fetch: the CR host TLS-fingerprints and returns
// HTTP 500 to undici (verified) but 200 to curl. `-w \n%{http_code}` appends the
// status as a trailing line so we can detect 429/500 without --fail eating the body.
const curlRunner: CurlRunner = (url) =>
  pexec("curl", ["-s", "-m", "30", "-w", "\n%{http_code}", url], {
    maxBuffer: 10_000_000,
  });

export const fetchFounded = async (
  eik: string,
  opts: { run?: CurlRunner; pace?: number; maxRetry?: number } = {},
): Promise<FetchResult> => {
  const { run = curlRunner, pace = BASE_PACE_MS, maxRetry = MAX_RETRY } = opts;
  // Sleeping before we give up buys nothing — on the 429 ladder the final
  // backoff alone was 51% of a failed EIK's total cost.
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
    // 404 is NOT treated as "no such company": the register answers an unknown
    // EIK with an empty 200 (measured), so a 404 here is far more likely to be
    // an edge/WAF layer — and persisting it would look legitimate in
    // http_status while being exactly the original bug.
    if (status !== 200) {
      lastReason = `http-${status}`;
      emptyStreak = 0;
      await backoff(pace * (attempt + 1), attempt);
      continue;
    }
    if (!body.trim()) {
      // An empty 200 IS the register's "no such company" — but confirm it,
      // since a truncated/dropped response looks identical on a single sample.
      emptyStreak++;
      if (emptyStreak >= EMPTY_CONFIRM)
        return { ok: true, date: null, status, attempts: attempt + 1 };
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
    return {
      ok: true,
      date: minEntryDate(parsed),
      status,
      attempts: attempt + 1,
    };
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

export type ParsedArgs = {
  eiks?: string[];
  limit?: number;
  since?: string;
  probe?: number;
  basePace: number;
  requeueNulls: boolean;
  requeueAll: boolean;
  nullSince?: string;
  dryRun: boolean;
};

/**
 * `undefined` = flag absent · `null` = present but bare · string = its value.
 * The distinction matters: a value-taking flag that silently degrades into
 * "not passed" sent `--probe` straight into the multi-day WRITING backfill.
 */
const rawArg = (argv: string[], name: string): string | null | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = argv[i + 1];
  return next === undefined || next.startsWith("--") ? null : next;
};

export const parseArgs = (argv: string[]): ParsedArgs => {
  const num = (name: string, onBare?: number): number | undefined => {
    const raw = rawArg(argv, name);
    if (raw === undefined) return undefined;
    if (raw === null) {
      if (onBare !== undefined) return onBare;
      throw new Error(`--${name} needs a positive number (got nothing)`);
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0)
      throw new Error(
        `--${name} needs a positive number (got ${JSON.stringify(raw)})`,
      );
    return n;
  };

  const probe = num("probe", DEFAULT_PROBE);
  const limit = num("limit");
  if (probe !== undefined && limit !== undefined)
    throw new Error("--probe and --limit both cap the run; pass only one");

  // Floor the pace at the measured token-bucket rate so no input — typo or
  // otherwise — can turn this into an unpaced hammer.
  const paceArg = num("pace");
  const basePace = Math.max(BASE_PACE_MS, paceArg ?? BASE_PACE_MS);

  const eiksRaw = rawArg(argv, "eiks");
  const eiks =
    typeof eiksRaw === "string"
      ? eiksRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  if (eiks && (limit !== undefined || probe !== undefined))
    console.warn(
      "  note: --eiks is explicit; --limit/--probe caps do not apply",
    );

  const sinceRaw = rawArg(argv, "since");
  const nullSinceRaw = rawArg(argv, "null-since");

  return {
    eiks: eiks?.length ? eiks : undefined,
    limit,
    since: typeof sinceRaw === "string" ? sinceRaw : undefined,
    probe,
    basePace,
    requeueNulls: argv.includes("--requeue-nulls"),
    requeueAll: argv.includes("--requeue-all-nulls"),
    nullSince: typeof nullSinceRaw === "string" ? nullSinceRaw : undefined,
    dryRun: argv.includes("--dry-run"),
  };
};

/**
 * The WHERE for the requeue. Defaults to rows whose NULL cannot be trusted —
 * `http_status IS DISTINCT FROM 200` spares answers this script itself verified,
 * which is the entire point of having added the provenance columns. `all` opts
 * back into the blanket (expensive, days of re-crawl) form by name.
 */
export const requeueSql = (opts: {
  nullSince?: string;
  eiks?: string[];
  all?: boolean;
}): { sql: string; params: unknown[] } => {
  const where = ["founded_date IS NULL"];
  const params: unknown[] = [];
  if (!opts.all) where.push("http_status IS DISTINCT FROM 200");
  if (opts.nullSince)
    where.push(`fetched_at >= $${params.push(opts.nullSince)}`);
  if (opts.eiks?.length) where.push(`eik = ANY($${params.push(opts.eiks)})`);
  return { sql: where.join(" AND "), params };
};

const requeueNulls = async (opts: {
  nullSince?: string;
  eiks?: string[];
  all?: boolean;
  dryRun?: boolean;
}): Promise<number> => {
  const { sql, params } = requeueSql(opts);
  if (opts.dryRun) {
    const [row] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n FROM company_founded WHERE ${sql}`,
      params,
    );
    console.log(
      `→ --requeue-nulls would delete ${row?.n ?? 0} row(s) — re-run without --dry-run`,
    );
    return 0;
  }
  const res = await withClient((c) =>
    c.query(`DELETE FROM company_founded WHERE ${sql}`, params),
  );
  return res.rowCount ?? 0;
};

/** The upsert names http_status/attempts; fail with the fix rather than a raw PG error. */
const preflight = async (): Promise<void> => {
  const [row] = await allRows<{ n: string }>(
    `SELECT count(*)::text AS n FROM information_schema.columns
      WHERE table_name = 'company_founded' AND column_name = 'http_status'`,
  );
  if (row?.n === "0") {
    console.error(
      "✗ company_founded is missing http_status/attempts — apply 033 first:\n" +
        "    npx tsx scripts/db/apply_functions.ts 033_procurement_risk_indexes.sql",
    );
    await end();
    process.exit(2);
  }
};

const main = async () => {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.requeueNulls || opts.requeueAll) {
    const n = await requeueNulls({
      nullSince: opts.nullSince,
      eiks: opts.eiks,
      all: opts.requeueAll,
      dryRun: opts.dryRun,
    });
    if (!opts.dryRun)
      console.log(
        `→ requeued ${n} untrusted NULL row(s) — the next run will re-fetch them`,
      );
    if (!opts.eiks && opts.probe == null && opts.limit == null) {
      await end();
      return;
    }
  }

  let eiks: string[];
  if (opts.eiks) {
    eiks = opts.eiks;
  } else {
    // Distinct contractor EIKs from the contracts corpus, newest-contract first
    // (most likely to be genuinely-recent firms) — skipping ones already
    // fetched. The eik tiebreak keeps successive capped runs comparable.
    const cap = opts.probe ?? opts.limit;
    const rows = await allRows<{ contractor_eik: string }>(
      `SELECT contractor_eik
         FROM contracts
        WHERE tag='contract' AND contractor_eik ~ '^[1-9][0-9]{8}$'
          ${opts.since ? "AND date >= $1" : ""}
          AND NOT EXISTS (SELECT 1 FROM company_founded cf
                           WHERE cf.eik = contracts.contractor_eik)
        GROUP BY contractor_eik
        ORDER BY max(date) DESC, contractor_eik
        ${cap !== undefined ? `LIMIT ${cap}` : ""}`,
      opts.since ? [opts.since] : [],
    );
    eiks = rows.map((r) => r.contractor_eik);
  }

  // --probe: measure the current block state without writing anything, so a
  // stalled crawl can be diagnosed before committing to a multi-hour run. It
  // uses a near-zero retry budget deliberately — retrying six times would hide
  // the very signal it exists to read, and would make the "cheap" diagnostic
  // cost hours against a fully blocked source.
  if (opts.probe != null) {
    console.log(`→ probing ${eiks.length} EIK(s) (read-only, no writes)…`);
    let answered = 0;
    let firstTry = 0;
    let attemptSum = 0;
    const reasons = new Map<string, number>();
    const started = Date.now();
    for (const eik of eiks) {
      const r = await fetchFounded(eik, {
        pace: opts.basePace,
        maxRetry: DEGRADED_MAX_RETRY,
      });
      if (r.ok) {
        answered++;
        attemptSum += r.attempts;
        if (r.attempts === 1) firstTry++;
      } else reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
      await sleep(opts.basePace);
    }
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(
      `✓ probe: ${answered}/${eiks.length} answered ` +
        `(${firstTry} on the first try, mean ${(attemptSum / Math.max(1, answered)).toFixed(1)} attempts) in ${secs}s`,
    );
    if (reasons.size)
      console.log(
        `  failures: ${[...reasons].map(([k, v]) => `${k}×${v}`).join(", ")}`,
      );
    await end();
    return;
  }

  await preflight();

  console.log(`→ fetching founding dates for ${eiks.length} EIK(s)…`);
  let dated = 0;
  let undated = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let lastOkAt = Date.now();
  const pacer = makePacer(opts.basePace, MAX_PACE_MS, PACE_GROWTH);

  for (let i = 0; i < eiks.length; i++) {
    const eik = eiks[i];
    const r = await fetchFounded(eik, {
      pace: pacer.current,
      maxRetry:
        consecutiveFailures >= DEGRADED_AFTER ? DEGRADED_MAX_RETRY : MAX_RETRY,
    });

    if (r.ok) {
      await withClient((c) =>
        c.query(
          `INSERT INTO company_founded
             (eik, founded_date, source, fetched_at, http_status, attempts)
           VALUES ($1, $2, 'registryagency:CR/Deeds', now(), $3, $4)
           ON CONFLICT (eik) DO UPDATE
             SET founded_date = EXCLUDED.founded_date,
                 source = EXCLUDED.source, fetched_at = now(),
                 http_status = EXCLUDED.http_status,
                 attempts = EXCLUDED.attempts`,
          [eik, r.date, r.status, r.attempts],
        ),
      );
      if (r.date) dated++;
      else undated++;
      consecutiveFailures = 0;
      lastOkAt = Date.now();
      pacer.onOk();
    } else {
      // NOT persisted — the EIK stays unfetched so a later run retries it.
      failed++;
      consecutiveFailures++;
      pacer.onFail();
      const silentMs = Date.now() - lastOkAt;
      if (
        consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ||
        silentMs > MAX_SILENCE_MS
      ) {
        console.error(
          `✗ circuit breaker: ${consecutiveFailures} consecutive failures, ` +
            `${Math.round(silentMs / 60_000)} min since the last answer ` +
            `(last: ${r.reason}, status ${r.status ?? "n/a"}). The source is ` +
            `refusing this IP — nothing was written for them. Resume from a ` +
            `different egress; the run is fully resumable.`,
        );
        console.error(
          `  progress: ${i + 1}/${eiks.length} attempted — ${dated} dated, ${undated} undated, ${failed} failed`,
        );
        await end();
        process.exit(1);
      }
    }

    if ((i + 1) % 10 === 0 || i === eiks.length - 1)
      console.log(
        `  ${i + 1}/${eiks.length} (${dated} dated, ${undated} undated, ${failed} failed, pace ${pacer.current}ms)`,
      );
    if (i < eiks.length - 1) await sleep(pacer.current);
  }
  console.log(
    `✓ done — ${dated} dated, ${undated} undated, ${failed} failed (not written; re-run to retry)`,
  );
  await end();
};

// Only run when invoked as a script, so the exported helpers stay unit-testable.
if (process.argv[1]?.includes("fetch_company_founded"))
  main().catch(async (e) => {
    console.error(
      "✗ fetch_company_founded failed:",
      e instanceof Error ? e.message : e,
    );
    await end().catch(() => {});
    process.exit(1);
  });
