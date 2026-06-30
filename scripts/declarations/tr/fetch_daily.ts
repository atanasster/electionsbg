/**
 * Download a single TR daily-filing JSON from data.egov.bg's per-resource
 * endpoint. Used for incremental updates after the initial bulk-zip snapshot:
 * walk the dataset index, identify isoDates not yet on disk, fetch each one.
 *
 * Per-resource URL: GET /resource/download/{uuid}/json
 *
 * Each daily file is small (~8 MB raw / ~1–2 MB on a quiet day). Politeness:
 * 1 request per second by default.
 *
 * OUTAGE NOTE (June 2026): data.egov.bg's per-resource download endpoint broke
 * server-side — it now 302-redirects to the portal HTML shell with a "Грешка
 * при вземане на метаданни за ресурс" flash for EVERY file resource (this is a
 * backend metadata-fetch failure, not a CSRF/session issue we can satisfy from
 * the client; see scripts/procurement/legacy_csv.ts for the full diagnosis).
 * While it's down we (a) refuse to write the HTML shell as if it were a filing
 * — the old code did, leaving ~1100 stub files that made --reconstruct skip
 * every day — and (b) raise EgovPerResourceDownloadDownError so the caller can
 * fall back to the still-working full-dataset bulk-zip (fetch_bulk_zip.ts).
 */

import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { TrDatasetEntry } from "./fetch_dataset_index";

const BASE = "https://data.egov.bg";
const UA = "electionsbg.com data pipeline";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Thrown when the per-resource download endpoint serves the portal HTML shell
 * (or a redirect to it) instead of the resource — i.e. data.egov.bg's
 * file-download backend is down. Distinct type so fetchAllDaily / the CLI can
 * stop hammering 1700 dead requests and switch to the bulk-zip path.
 */
export class EgovPerResourceDownloadDownError extends Error {
  constructor(detail: string) {
    super(
      `data.egov.bg per-resource download is down (${detail}). The portal ` +
        `returns its HTML shell instead of the file for every resource. Use ` +
        `the bulk-zip path (--bulk) + --reconstruct, which still works.`,
    );
    this.name = "EgovPerResourceDownloadDownError";
  }
}

// Fold a response's Set-Cookie header(s) into a single "name=value; …" string.
const foldCookies = (res: Response): string => {
  const raw =
    typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie ===
    "function"
      ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
      : (res.headers.get("set-cookie")?.split(/,(?=\s*\w+=)/) ?? []);
  return raw
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
};

/**
 * Warm a portal session once and return its Cookie header. The per-resource
 * GET historically worked anonymously; the cookie is insurance in case the
 * restored backend starts requiring a session (matches how the resource page
 * itself is gated). Best-effort — returns "" if warming fails.
 */
export const warmEgovSession = async (): Promise<string> => {
  try {
    const res = await fetch(`${BASE}/`, {
      headers: { "User-Agent": UA, Accept: "text/html" },
    });
    return foldCookies(res);
  } catch {
    return "";
  }
};

const dailyPath = (rawFolder: string, isoDate: string): string =>
  path.join(rawFolder, "tr", "daily", `${isoDate}.json`);

export type FetchDailyResult = {
  outPath: string;
  bytes: number;
  skipped: boolean;
};

/** Fetch one resource. Skips if the file already exists with non-zero size. */
export const fetchDailyResource = async (
  rawFolder: string,
  entry: TrDatasetEntry,
  opts: { cookie?: string } = {},
): Promise<FetchDailyResult> => {
  const outPath = dailyPath(rawFolder, entry.isoDate);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    return { outPath, bytes: fs.statSync(outPath).size, skipped: true };
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const url = `${BASE}/resource/download/${entry.uuid}/json`;
  // Atomic write: stream to .tmp, rename on success.
  const tmpPath = `${outPath}.tmp`;
  // Hard timeout for both the request and the body stream. Without this a
  // half-open TCP connection (server accepts, then never sends body bytes)
  // wedges the whole loop forever — fetch() has no implicit timeout.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json",
  };
  if (opts.cookie) headers.Cookie = opts.cookie;
  let res: Response;
  try {
    // `redirect: "manual"` so we SEE the outage redirect instead of silently
    // following it to the HTML shell. A healthy download is a direct 200.
    res = await fetch(url, { headers, redirect: "manual", signal: ac.signal });
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
  // A redirect (or an explicit HTML body) means the per-resource backend is
  // down — the portal is bouncing us to the resource page / homepage. Surface
  // it as the typed outage so the caller can switch to the bulk-zip path and
  // we never persist the HTML shell as a "filing".
  if (res.status >= 300 && res.status < 400) {
    clearTimeout(timer);
    throw new EgovPerResourceDownloadDownError(
      `GET ${url} → ${res.status} → ${res.headers.get("location") ?? "?"}`,
    );
  }
  if (!res.ok) {
    clearTimeout(timer);
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  const ctype = res.headers.get("content-type") ?? "";
  if (/text\/html/i.test(ctype)) {
    clearTimeout(timer);
    throw new EgovPerResourceDownloadDownError(
      `GET ${url} → 200 but content-type ${ctype}`,
    );
  }
  if (!res.body) {
    clearTimeout(timer);
    throw new Error(`GET ${url} returned empty body`);
  }
  const fileStream = fs.createWriteStream(tmpPath);
  const nodeStream = Readable.fromWeb(
    res.body as unknown as import("stream/web").ReadableStream,
  );
  try {
    await pipeline(nodeStream, fileStream);
  } finally {
    clearTimeout(timer);
  }

  // Guard against an HTML shell that slipped through with a non-html
  // content-type: peek the first byte of the .tmp before trusting it. Only
  // promote to the final path once it looks like data, never an HTML shell.
  const fd = fs.openSync(tmpPath, "r");
  const peek = Buffer.alloc(16);
  fs.readSync(fd, peek, 0, 16, 0);
  fs.closeSync(fd);
  const head = peek.toString("utf-8").trimStart();
  if (head.startsWith("<")) {
    fs.unlinkSync(tmpPath);
    throw new EgovPerResourceDownloadDownError(
      `GET ${url} returned an HTML body (starts with "${head.slice(0, 12)}")`,
    );
  }
  fs.renameSync(tmpPath, outPath);

  const bytes = fs.statSync(outPath).size;
  // Sanity guard: data.egov.bg occasionally serves an empty/near-empty body
  // with 200 OK instead of a real JSON payload. Treat tiny files as failures
  // so the retry/skip logic can re-fetch them on a later run.
  if (bytes < 32) {
    fs.unlinkSync(outPath);
    throw new Error(`GET ${url} returned only ${bytes} bytes`);
  }
  return { outPath, bytes, skipped: false };
};

export type FetchDailyAllOpts = {
  rawFolder: string;
  entries: TrDatasetEntry[];
  /** Politeness delay between requests in ms. Default 1000 (1 req/sec). */
  delayMs?: number;
  /** Retry attempts per resource on transient failure. Default 3. */
  maxRetries?: number;
  /** Stop after this many newly-fetched resources. Default = no cap. */
  limit?: number;
};

export type FetchDailyAllResult = {
  fetched: number;
  skipped: number;
  failed: Array<{ entry: TrDatasetEntry; error: string }>;
};

/**
 * Walk a list of entries (e.g. from the dataset index) and download anything
 * not yet on disk. Resume is implicit via the skip-if-exists check; per-entry
 * failures accumulate in `failed[]` rather than aborting the whole run.
 *
 * The exception is EgovPerResourceDownloadDownError: when the portal's
 * per-resource backend is down it fails identically for every entry, so we
 * abort the loop and re-throw on the FIRST such error rather than retrying
 * 1700 dead requests. The caller (cli.ts) catches it and falls back to the
 * bulk-zip path.
 */
export const fetchAllDaily = async (
  opts: FetchDailyAllOpts,
): Promise<FetchDailyAllResult> => {
  const delayMs = opts.delayMs ?? 1000;
  const maxRetries = opts.maxRetries ?? 3;
  const limit = opts.limit ?? Infinity;

  const result: FetchDailyAllResult = { fetched: 0, skipped: 0, failed: [] };
  // Warm one session up front; reused for every entry (insurance for a
  // restored backend — see warmEgovSession).
  const cookie = await warmEgovSession();

  for (const entry of opts.entries) {
    if (result.fetched >= limit) break;

    let attempt = 0;
    let lastErr: unknown = null;
    while (attempt < maxRetries) {
      try {
        const r = await fetchDailyResource(opts.rawFolder, entry, { cookie });
        if (r.skipped) {
          result.skipped++;
        } else {
          result.fetched++;
          if (result.fetched % 25 === 0) {
            console.log(
              `[tr/daily] ${result.fetched} fetched / ${result.skipped} skipped — last: ${entry.isoDate}`,
            );
          }
          await sleep(delayMs);
        }
        lastErr = null;
        break;
      } catch (err) {
        // Systemic outage — don't retry, don't continue; let the caller
        // switch strategies. Surfaces on the very first entry.
        if (err instanceof EgovPerResourceDownloadDownError) {
          console.warn(`[tr/daily] ${err.message}`);
          throw err;
        }
        lastErr = err;
        attempt++;
        // Exponential backoff: 2s, 4s, 8s …
        const backoff = 2000 * 2 ** (attempt - 1);
        console.warn(
          `[tr/daily] ${entry.isoDate} attempt ${attempt}/${maxRetries} failed: ${(err as Error).message}; retrying in ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }
    if (lastErr) {
      result.failed.push({ entry, error: (lastErr as Error).message });
    }
  }

  console.log(
    `[tr/daily] done — fetched ${result.fetched}, skipped ${result.skipped}, failed ${result.failed.length}`,
  );
  return result;
};

export type FetchDailyResilientOpts = {
  rawFolder: string;
  entries: TrDatasetEntry[];
  /** Politeness delay between successful fetches in ms. Default 1000. */
  delayMs?: number;
  /** Retries on a 302/HTML outage for a single day before skipping it. Default 2. */
  outageRetries?: number;
  /** Retries on a network/transient error before giving up on a day. Default 3. */
  transientRetries?: number;
  /** Log a progress line every N successful fetches. Default 25. */
  progressEvery?: number;
  /** Prefix for log lines, e.g. "[tr/daily-refresh]". Default "[tr/daily]". */
  logPrefix?: string;
};

export type FetchDailyResilientResult = {
  fetched: number;
  bytes: number;
  /** Days the per-resource backend 302'd for (skipped after retries). */
  outage: string[];
  failed: Array<{ isoDate: string; error: string }>;
};

/**
 * Like {@link fetchAllDaily}, but a 302/HTML outage on one day is a PER-DAY
 * skip instead of a whole-run abort. data.egov.bg's per-resource endpoint
 * 302s intermittently for individual resources (and there are a few resources
 * it 302s permanently); `fetchAllDaily` re-throws on the first such error so
 * the CLI can fall back to the bulk zip, but for the daily catch-up + the
 * historical backfill we want to keep going and collect the unreachable days.
 *
 * Skip-if-exists makes it resume-safe: already-cached days cost one `stat`.
 */
export const fetchAllDailyResilient = async (
  opts: FetchDailyResilientOpts,
): Promise<FetchDailyResilientResult> => {
  const delayMs = opts.delayMs ?? 1000;
  const outageRetries = opts.outageRetries ?? 2;
  const transientRetries = opts.transientRetries ?? 3;
  const progressEvery = opts.progressEvery ?? 25;
  const tag = opts.logPrefix ?? "[tr/daily]";

  const result: FetchDailyResilientResult = {
    fetched: 0,
    bytes: 0,
    outage: [],
    failed: [],
  };
  const cookie = await warmEgovSession();
  const t0 = Date.now();

  for (const entry of opts.entries) {
    let done = false;
    let outageHits = 0;
    let transientHits = 0;
    while (!done) {
      try {
        const r = await fetchDailyResource(opts.rawFolder, entry, { cookie });
        if (!r.skipped) {
          result.fetched++;
          result.bytes += r.bytes;
          if (result.fetched % progressEvery === 0) {
            const mins = ((Date.now() - t0) / 60000).toFixed(1);
            console.log(
              `${tag}   ${result.fetched} fetched ` +
                `(${(result.bytes / 1024 / 1024).toFixed(0)} MB, ${mins}m) — last ${entry.isoDate}`,
            );
          }
          await sleep(delayMs);
        }
        done = true;
      } catch (err) {
        if (err instanceof EgovPerResourceDownloadDownError) {
          outageHits++;
          if (outageHits > outageRetries) {
            result.outage.push(entry.isoDate);
            done = true;
            break;
          }
          await sleep(3000 * outageHits);
          continue;
        }
        transientHits++;
        if (transientHits > transientRetries) {
          result.failed.push({
            isoDate: entry.isoDate,
            error: (err as Error).message,
          });
          done = true;
          break;
        }
        await sleep(2000 * 2 ** (transientHits - 1));
      }
    }
  }

  return result;
};
