// Crawl pitay.government.bg application pages into raw_data/zdoi/pitay.sqlite.
//
//   pnpm run zdoi:fetch                       # every id not yet stored, 1..newest
//   pnpm run zdoi:fetch --refresh             # + re-fetch non-final and stale requests
//   pnpm run zdoi:fetch --recheck-missing     # + re-ask every id stored as missing
//   pnpm run zdoi:fetch --from-id 8900 --to-id 8910
//
// Operator action, not a pipeline step: the first run is ~23k pages. Polite by
// default (one request at a time, DELAY_MS between them, backing off on 429/5xx)
// and resumable — an answered id is not asked again unless --refresh says it can
// still move. Then `pnpm run db:load:zdoi:pg` loads the store.

import { fileURLToPath } from "node:url";
import { FINAL_STATUSES, parseApplication } from "./pitay_parse";
import { PitayStore } from "./pitay_store";

export const BASE = "https://pitay.government.bg";
const DELAY_MS = Number(process.env.PITAY_DELAY_MS ?? 400);
const UA = "naiasno-data/1.0 (public-records crawler)";
/** A final request is re-read after this long, so one the body later re-opens
 *  („Възобновено") is not frozen at its old status for ever. */
const STALE_DAYS = 30;
/** Consecutive failures that end the run — the site is down or refusing us, and
 *  marking the rest of the range failed would only cost a full re-ask. */
const MAX_CONSECUTIVE_FAILURES = 20;

/** The platform's own not-found page (fixture pitay_100.html). */
const NOT_FOUND_MARKER = "Страницата която търсите не може да бъде намерена";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** A positive integer CLI value, or the default; anything else is an error
 *  rather than a NaN range that silently fetches nothing. */
export const idArg = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`expected a positive integer id, got „${raw}"`);
  return n;
};

/** The newest application id, read from the platform's own front page list. */
export const newestIdFrom = (html: string): number => {
  const ids = [...html.matchAll(/\/application\/(\d+)\/view/g)].map((m) =>
    Number(m[1]),
  );
  if (!ids.length)
    throw new Error("pitay: no application links on the front page");
  return Math.max(...ids);
};

export type Outcome =
  | { kind: "application"; status: string }
  | { kind: "missing" }
  | { kind: "failed"; reason: string };

/** What one HTTP answer means for the store. Only the platform's REAL not-found
 *  page is a missing id; a 200 that is not an application (maintenance, an error
 *  page, a bot challenge) is a failure to retry, never a permanent absence. */
export const classify = (
  httpStatus: number,
  body: string,
  id: number,
): Outcome => {
  if (httpStatus === 200) {
    const app = parseApplication(body, id);
    return app
      ? { kind: "application", status: app.status }
      : { kind: "failed", reason: "200 without an application" };
  }
  if (httpStatus === 404 && body.includes(NOT_FOUND_MARKER))
    return { kind: "missing" };
  return { kind: "failed", reason: `HTTP ${httpStatus}` };
};

const get = async (
  url: string,
): Promise<{ status: number; body: string; retryAfter: number | null }> => {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal: AbortSignal.timeout(30_000),
  });
  const ra = Number(res.headers.get("retry-after"));
  return {
    status: res.status,
    body: await res.text(),
    retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null,
  };
};

const main = async () => {
  const store = new PitayStore();
  const redacted = store.redactExisting();
  if (redacted)
    console.log(`pitay: redacted the requester on ${redacted} stored page(s)`);
  const refresh = process.argv.includes("--refresh");
  const front = await get(`${BASE}/`);
  if (front.status !== 200)
    throw new Error(`pitay front page answered ${front.status}`);
  const newest = newestIdFrom(front.body);
  const from = idArg(arg("--from-id"), 1);
  const to = idArg(arg("--to-id"), newest);
  if (from > to) throw new Error(`--from-id ${from} is after --to-id ${to}`);

  const answered = store.answeredIds();
  const todo = new Set<number>();
  for (let id = from; id <= to; id++) if (!answered.has(id)) todo.add(id);
  const inRange = (id: number) => id >= from && id <= to;
  if (refresh) {
    const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000);
    for (const id of store.refreshIds(FINAL_STATUSES, staleBefore))
      if (inRange(id)) todo.add(id);
  }
  if (process.argv.includes("--recheck-missing"))
    for (const id of store.missingIds()) if (inRange(id)) todo.add(id);

  const ids = [...todo].sort((a, b) => a - b);
  console.log(
    `pitay: newest id ${newest}; fetching ${ids.length} page(s) in ${from}..${to}` +
      (refresh ? " (with refresh)" : ""),
  );
  let ok = 0,
    missing = 0,
    failed = 0,
    streak = 0,
    delay = DELAY_MS;
  for (const [i, id] of ids.entries()) {
    let outcome: Outcome;
    let retryAfter: number | null = null;
    let body = "";
    try {
      const r = await get(`${BASE}/application/${id}/view`);
      retryAfter = r.retryAfter;
      body = r.body;
      outcome = classify(r.status, r.body, id);
    } catch (e) {
      outcome = {
        kind: "failed",
        reason: e instanceof Error ? e.message : String(e),
      };
    }
    if (outcome.kind === "application") {
      store.put(id, 200, body, outcome.status);
      ok++;
    } else if (outcome.kind === "missing") {
      store.put(id, 404, "", null);
      missing++;
    } else {
      store.fail(id, outcome.reason);
      failed++;
    }
    if (outcome.kind === "failed") {
      streak++;
      // Back off: the server's Retry-After when it gives one, else doubling.
      delay = retryAfter ? retryAfter * 1000 : Math.min(delay * 2, 60_000);
      if (streak >= MAX_CONSECUTIVE_FAILURES) {
        console.error(
          `pitay: ${streak} failures in a row (last: ${outcome.reason}) — stopping; re-run to resume.`,
        );
        break;
      }
    } else {
      streak = 0;
      delay = DELAY_MS;
    }
    if ((i + 1) % 500 === 0)
      console.log(
        `  ${i + 1}/${ids.length} · ok ${ok} · 404 ${missing} · failed ${failed}`,
      );
    await sleep(delay);
  }
  const c = store.counts();
  console.log(
    `✓ pitay: this run ok ${ok} · 404 ${missing} · failed ${failed}. ` +
      `Store: ${c.pages} applications, ${c.missing} missing ids, ${c.failed} to retry.`,
  );
  store.close();
  if (failed) process.exitCode = 2;
};

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
