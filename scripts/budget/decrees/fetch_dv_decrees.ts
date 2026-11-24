// Crawl Държавен вестник material pages by idMat into raw_data/budget/dv_decrees.sqlite,
// keeping the body of every Council of Ministers spending decree
// (docs/plans/insait-gap-v1.md §4).
//
//   pnpm run budget:dv-decrees                         # every id after the highest stored
//   pnpm run budget:dv-decrees --from-id 155000        # backfill from an id (2021-01 ≈ 155000)
//   pnpm run budget:dv-decrees --from-id 155500 --to-id 156500
//
// DV numbers its materials sequentially (~1,000 a month) and serves each as a plain
// GET; the issue index is a JSF postback, so walking ids is the robust path. The first
// backfill (2021 → today, ~93k ids) is an operator action: polite (one request at a
// time, DELAY_MS between them, backing off on errors) and resumable. Then
// `pnpm run db:load:budget-decrees:pg` loads the store.

import { fileURLToPath } from "node:url";
import { isSpendingDecree, parseHeader } from "./dv_decree";
import { DvStore } from "./dv_store";

export const BASE = "https://dv.parliament.bg/DVWeb";
const DELAY_MS = Number(process.env.DV_DELAY_MS ?? 300);
const UA = "naiasno-data/1.0 (public-records crawler)";
const MAX_CONSECUTIVE_FAILURES = 20;
/** Unissued ids past the newest stop a forward run — DV has not published them yet. */
const MAX_TRAILING_MISSING = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

export const idArg = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`expected a positive integer id, got „${raw}"`);
  return n;
};

/** The newest idMat linked from DV's front page. A client without a session cookie
 *  gets the links with `;jsessionid=…` spliced in before the query. */
export const newestIdFrom = (html: string): number => {
  const ids = [
    ...html.matchAll(
      /showMaterialDV\.jsp(?:;jsessionid=[^?"]*)?\?idMat=(\d+)/g,
    ),
  ].map((m) => Number(m[1]));
  if (!ids.length) throw new Error("DV: no material links on the front page");
  return Math.max(...ids);
};

export type Outcome =
  | { kind: "material"; decree: boolean }
  | { kind: "missing" }
  | { kind: "failed"; reason: string };

/** What one answer means for the store. DV answers an id it never issued with an EMPTY
 *  200; a 200 that has content but no material header is a failure to retry. */
export const classify = (httpStatus: number, body: string): Outcome => {
  if (httpStatus !== 200)
    return { kind: "failed", reason: `HTTP ${httpStatus}` };
  if (!body.trim()) return { kind: "missing" };
  const h = parseHeader(body);
  return h
    ? { kind: "material", decree: isSpendingDecree(h) }
    : { kind: "failed", reason: "200 without a material header" };
};

const get = async (url: string) => {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, body: await res.text() };
};

const main = async () => {
  const store = new DvStore();
  // The front page occasionally answers without its material list; ask again.
  let newest = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      const front = await get(`${BASE}/index.faces`);
      if (front.status !== 200) throw new Error(`HTTP ${front.status}`);
      newest = newestIdFrom(front.body);
      break;
    } catch (e) {
      if (attempt >= 3)
        throw new Error(
          `DV front page: ${e instanceof Error ? e.message : String(e)}`,
        );
      await sleep(5_000);
    }
  }
  const from = idArg(arg("--from-id")) ?? (store.maxId() ?? newest) + 1;
  // A forward run may pass the front page's newest id by a little: materials of an
  // issue being published are numbered before the page links them.
  const to = idArg(arg("--to-id")) ?? newest + MAX_TRAILING_MISSING;
  if (from > to) {
    console.log(`DV: nothing to do (from ${from} > to ${to})`);
    store.close();
    return;
  }
  const answered = store.answeredIds();
  console.log(`DV: newest linked id ${newest}; walking ${from}..${to}`);

  let materials = 0,
    decrees = 0,
    missing = 0,
    failed = 0,
    streak = 0,
    trailing = 0,
    delay = DELAY_MS;
  const retry = store.failedIds().filter((id) => id < from);
  const ids = function* () {
    yield* retry;
    for (let id = from; id <= to; id++) if (!answered.has(id)) yield id;
  };
  let blocked = false;
  for (const id of ids()) {
    let outcome: Outcome;
    let body = "";
    try {
      const r = await get(`${BASE}/showMaterialDV.jsp?idMat=${id}`);
      body = r.body;
      outcome = classify(r.status, r.body);
    } catch (e) {
      outcome = {
        kind: "failed",
        reason: e instanceof Error ? e.message : String(e),
      };
    }
    if (outcome.kind === "material") {
      store.put(id, parseHeader(body), outcome.decree ? body : null);
      materials++;
      if (outcome.decree) decrees++;
      trailing = 0;
    } else if (outcome.kind === "missing") {
      // Past the newest published id an empty answer means „not yet", not „never":
      // keep it on the retry list, since the next run starts above the highest stored id.
      if (id > newest) {
        trailing++;
        store.fail(id, "empty past the newest published id");
      } else store.put(id, null, null);
      missing++;
    } else {
      store.fail(id, outcome.reason);
      failed++;
    }
    if (outcome.kind === "failed") {
      streak++;
      delay = Math.min(delay * 2, 60_000);
      if (streak >= MAX_CONSECUTIVE_FAILURES) {
        console.error(
          `DV: ${streak} failures in a row — stopping; re-run to resume.`,
        );
        blocked = true;
        break;
      }
    } else {
      streak = 0;
      delay = DELAY_MS;
    }
    if (id > newest && trailing >= MAX_TRAILING_MISSING) break;
    if (id % 1000 === 0)
      console.log(
        `  ${id} · materials ${materials} · decrees ${decrees} · empty ${missing} · failed ${failed}`,
      );
    await sleep(delay);
  }
  const c = store.counts();
  console.log(
    `✓ DV: this run ${materials} material(s), ${decrees} spending decree(s), ${failed} failed. ` +
      `Store: ${c.answered} ids, ${c.decrees} decrees, ${c.failed} to retry.`,
  );
  store.close();
  // 2: some ids failed and are queued for the next run. 3: DV stopped answering, which
  // must fail the step rather than pass as a partial run.
  if (blocked) process.exitCode = 3;
  else if (failed) process.exitCode = 2;
};

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
