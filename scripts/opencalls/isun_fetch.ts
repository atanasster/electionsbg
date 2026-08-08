// Crawl ИСУН 2020's procedure register into a committed snapshot.
//
//   npm run opencalls:isun            # crawl + write data/opencalls/isun.json
//   npm run opencalls:isun -- --dry   # crawl, report, write nothing
//
// TWO TIERS, TWO KINDS. /Active is what a reader can apply to (kind='call'); /PublicDiscussion
// is draft guidance out for public comment (kind='consultation'), which we publish in its own
// section and never beside a real call. Measured 2026-08-08: 55 open, 0 in consultation — the
// consultation tier is frequently empty, and an empty tier is an ANSWER, not a failure.
//
// ── POLITENESS ──────────────────────────────────────────────────────────────────────────
// A government host being technically crawlable is not a licence to hammer it. One listing
// GET per tier, then one detail GET per procedure, SERIAL, with a delay between each and an
// identifying User-Agent. At today's 55 procedures that is ~57 requests taking about a minute.
//
// The plan sketched "detail GETs only for GUIDs that are new or whose Въпроси-и-отговори stamp
// moved". That optimisation is CIRCULAR — the stamp only exists on the detail page, so you
// cannot know it moved without fetching the page you were trying to skip. Since fetching all
// of them is already inside the stated ≤56/day budget, this fetches all of them and stays
// correct: a deadline EXTENSION is exactly the change a "skip known procedures" rule would
// miss, and it is the change a reader most needs. MAX_DETAILS caps a pathological run.
//
// ── FAILURE POSTURE ─────────────────────────────────────────────────────────────────────
// A listing that will not load aborts the whole run WITHOUT writing: a snapshot missing half
// the register would look to the loader like a genuine shrink. Individual detail failures are
// tolerated and COUNTED — the loader's parse-rate guard is what decides whether the vintage is
// good enough to publish.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseIsunListing,
  parseIsunDetail,
  toOpenCall,
  type IsunListingRow,
} from "./isun_parse";
import type { CallKind, OpenCall, OpenCallsSnapshot } from "./types";
import { writeSnapshot } from "./write_snapshot";

const BASE = "https://eumis2020.government.bg";
const UA = "electionsbg-opencalls/1.0 (+https://electionsbg.com)";
const REQUEST_TIMEOUT_MS = 60_000;
const DELAY_MS = 1_100;
/** A backstop, not a budget: today's register is 55. If a listing ever returns thousands,
 *  stop and let a human look rather than walking it. */
const MAX_DETAILS = 400;
const RAW_DIR = "raw_data/opencalls/isun";
/** Above this share of unreadable rows, treat the run as source drift rather than a smaller
 *  register — the same posture as load_kzk_decisions_pg.ts. */
const MAX_FAIL_RATE = 0.15;
const allowShrink = process.argv.includes("--allow-shrink");

/** The committed snapshot as it stands, or null on a first run / unreadable file. */
const readPrevious = (source: string): OpenCallsSnapshot | null => {
  const p = path.join("data/opencalls", `${source}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as OpenCallsSnapshot;
  } catch {
    return null;
  }
};

const TIERS: { path: string; kind: CallKind }[] = [
  { path: "/bg/s/Procedure/Active", kind: "call" },
  { path: "/bg/s/Procedure/PublicDiscussion", kind: "consultation" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A WAF interstitial served as HTTP 200.
 *
 *  `res.ok` is blind to this. scripts/funds/isun_download.ts documents a MEASURED case on the
 *  sister host 2020.eufunds.bg: an F5 BIG-IP refusal returned as a ~245-byte "Request Rejected"
 *  page with a 200, which flowed into the parser and resurfaced as "header row not found".
 *  Here it would be worse — it parses to ZERO procedures, which reads as an empty register.
 *  A real ИСУН page always carries the app shell marker. */
const looksLikeInterstitial = (html: string): boolean =>
  /Request Rejected|The requested URL was rejected/iu.test(html) ||
  (html.length < 2_000 && !/ИСУН|eumis/iu.test(html));

/** Retry only what retrying can fix. */
const retriable = (status: number | null): boolean =>
  status === null || status === 429 || status >= 500;

/** One GET with two retries on a TRANSIENT failure. Throws on a final failure so the caller
 *  decides whether it is fatal (a listing) or countable (a detail).
 *
 *  A 403/404 is not retried: it will not become a 200, and retrying every one of 57 requests
 *  three times turns the stated ~57-request politeness budget into 171 against a host that is
 *  already refusing us. */
const get = async (url: string, attempt = 0): Promise<string> => {
  let status: number | null = null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    status = res.status;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (looksLikeInterstitial(html))
      throw new Error("WAF interstitial served as 200");
    return html;
  } catch (e) {
    if (attempt >= 2 || !retriable(status)) throw e;
    await sleep(2_000 * (attempt + 1));
    return get(url, attempt + 1);
  }
};

/** Keep the raw HTML for debugging a parse regression. Gitignored — it is a cache, and the
 *  committed snapshot is the durable artifact. Never fatal. */
const cacheRaw = (name: string, html: string): void => {
  try {
    mkdirSync(RAW_DIR, { recursive: true });
    writeFileSync(path.join(RAW_DIR, name), html);
  } catch {
    /* a cache write failing must not fail the crawl */
  }
};

export interface CrawlResult {
  calls: OpenCall[];
  listed: number;
  /** Rows whose detail could not be fetched or yielded no deadline. The loader's parse-rate
   *  guard reads this ratio. */
  failed: number;
  failures: { guid: string; code: string | null; why: string }[];
}

export const crawlIsun = async (
  opts: { delayMs?: number } = {},
): Promise<CrawlResult> => {
  const delay = opts.delayMs ?? DELAY_MS;
  const listing: { row: IsunListingRow; kind: CallKind }[] = [];

  for (const tier of TIERS) {
    // FATAL on failure: a partial register is indistinguishable from a shrunken one.
    const html = await get(`${BASE}${tier.path}`);
    cacheRaw(`${tier.path.split("/").pop()}.html`, html);
    const rows = parseIsunListing(html);
    console.log(`${tier.path}: ${rows.length} row(s) [${tier.kind}]`);
    for (const row of rows) listing.push({ row, kind: tier.kind });
    await sleep(delay);
  }

  if (listing.length > MAX_DETAILS)
    throw new Error(
      `listing returned ${listing.length} rows (cap ${MAX_DETAILS}) — check the register before crawling`,
    );

  const calls: OpenCall[] = [];
  const failures: CrawlResult["failures"] = [];

  for (const [i, { row, kind }] of listing.entries()) {
    const url = `${BASE}/bg/s/Procedure/Info/${row.guid}`;
    try {
      const html = await get(url);
      cacheRaw(`info-${row.guid}.html`, html);
      const call = toOpenCall(row, parseIsunDetail(html), kind);
      // toOpenCall returns null when the page carries no Краен срок. That is a REJECTION, not
      // a silent skip: an exact-dated call with no deadline is what the DDL refuses, and
      // inventing one would be the most harmful thing this crawler could do.
      if (call) calls.push(call);
      else
        failures.push({ guid: row.guid, code: row.code, why: "no Краен срок" });
    } catch (e) {
      failures.push({
        guid: row.guid,
        code: row.code,
        why: (e as Error).message.slice(0, 80),
      });
    }
    if (i < listing.length - 1) await sleep(delay);
  }

  return { calls, listed: listing.length, failed: failures.length, failures };
};

const main = async (): Promise<void> => {
  const dry = process.argv.includes("--dry");
  const res = await crawlIsun();

  console.log(
    `\nlisted ${res.listed} · parsed ${res.calls.length} · failed ${res.failed}`,
  );
  // Print every failure in full. A crawl that quietly drops procedures is how a register
  // shrinks without anybody noticing.
  for (const f of res.failures)
    console.log(`  ! ${f.code ?? f.guid}: ${f.why}`);

  const byKind = res.calls.reduce<Record<string, number>>((a, c) => {
    a[c.kind] = (a[c.kind] ?? 0) + 1;
    return a;
  }, {});
  console.log(`kinds: ${JSON.stringify(byKind)}`);

  if (dry) {
    console.log("--dry: nothing written");
    return;
  }

  // The empty and shrink guards live in writeSnapshot() so every source inherits them.
  // This one is crawl-specific: a high failure RATE means source drift, and the ratio only
  // exists here (OpenCallsSnapshot carries {source, crawledAt, calls} — `listed`/`failed`
  // would be printed and discarded).
  const failRate = res.listed === 0 ? 1 : res.failed / res.listed;
  if (failRate > MAX_FAIL_RATE)
    throw new Error(
      `${res.failed}/${res.listed} rows failed (${Math.round(failRate * 100)}% > ${Math.round(
        MAX_FAIL_RATE * 100,
      )}%) — treating as source drift, not a smaller register`,
    );

  const prev = readPrevious("isun");
  // Keep the previous crawledAt when nothing actually changed, so a no-op crawl is a no-op
  // DIFF. The archive's value is in its diffs; a daily timestamp-only commit buries them.
  const unchanged =
    prev !== null &&
    JSON.stringify(prev.calls) ===
      JSON.stringify(
        [...res.calls].sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : 1)),
      );
  const out = writeSnapshot(
    "isun",
    res.calls,
    unchanged ? prev.crawledAt : new Date().toISOString(),
    undefined,
    allowShrink,
  );
  console.log(unchanged ? `unchanged; ${out} left as-is` : `wrote ${out}`);
};

// Only run when invoked directly, so the crawl functions stay importable by a test.
// EXACT url comparison, the convention at 7+ sites in this repo (e.g. kzk_decisions.ts). An
// `endsWith(basename)` match discards the directory, so importing any module whose filename
// merely ends the same way would fire a live 57-request crawl as an import side effect.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
