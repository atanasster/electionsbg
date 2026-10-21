// Crawl the АЗ news into a committed open-calls snapshot. See az_parse.ts for why only intakes
// with a labelled END become rows.
//
//   npm run opencalls:az            # fetch + write data/opencalls/az.json
//   npm run opencalls:az -- --dry   # fetch, report, write nothing
//
// One GET for the list, then one per news item (10 on the list page), serial, with a delay
// and an identifying User-Agent.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AZ_NEWS_URL,
  mergeAzCalls,
  parseAzItem,
  parseAzNewsList,
  parseAzOutcome,
} from "./az_parse";
import type { OpenCall, OpenCallsSnapshot } from "./types";
import { writeSnapshot } from "./write_snapshot";

const UA = "electionsbg-opencalls/1.0 (+https://electionsbg.com)";
const RAW_DIR = "raw_data/opencalls/az";
const DELAY_MS = 1_200;
/** A list page with fewer links is a markup change, not a quiet week: it shows ten. */
const MIN_ITEMS = 5;
const SNAPSHOT = "data/opencalls/az.json";

/** The committed rows, or none. A corrupt file THROWS: merging into nothing would silently
 *  drop the archive the merge exists to keep. */
const previousCalls = (): OpenCall[] => {
  if (!existsSync(SNAPSHOT)) return [];
  return (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as OpenCallsSnapshot)
    .calls;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const get = async (url: string): Promise<string> => {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
};

const cache = (name: string, html: string): void => {
  try {
    mkdirSync(RAW_DIR, { recursive: true });
    writeFileSync(path.join(RAW_DIR, name), html, "utf8");
  } catch {
    // Best-effort debugging cache; never fail a crawl over it.
  }
};

const main = async (): Promise<void> => {
  const dry = process.argv.includes("--dry");
  const list = await get(AZ_NEWS_URL);
  cache("news.html", list);
  const urls = parseAzNewsList(list);
  if (urls.length < MIN_ITEMS)
    throw new Error(
      `АЗ news list parsed to ${urls.length} link(s) — the markup changed; nothing written`,
    );

  const calls: OpenCall[] = [];
  let unreadable = 0;
  for (const url of urls) {
    await sleep(DELAY_MS);
    const html = await get(url);
    const item = parseAzItem(html, url);
    if (!item) {
      unreadable++;
      continue;
    }
    cache(`item_${item.id}.html`, html);
    const o = parseAzOutcome(item);
    if (!o) continue;
    if (o.kind === "calls") calls.push(...o.calls);
    else console.log(`  ✗ ${o.date} ${o.title.slice(0, 70)} — ${o.why}`);
  }
  // A markup change on the ITEM pages parses every one to null, which would otherwise read as a
  // quiet week (no calls, snapshot kept, exit 0).
  if (unreadable * 2 >= urls.length)
    throw new Error(
      `АЗ: ${unreadable} of ${urls.length} news page(s) did not parse as a news item — the markup changed; nothing written`,
    );
  if (unreadable)
    console.warn(`  ${unreadable} news page(s) did not parse as a news item`);
  const now = new Date().toISOString();
  console.log(
    `АЗ: ${urls.length} news item(s) → ${calls.length} call(s) with a labelled end ` +
      `(${calls.filter((c) => c.closesAt! >= now).length} open now)`,
  );
  if (dry) {
    console.log("--dry: nothing written");
    return;
  }
  // The list page shows only the latest ten items, so a window scrolling off it is not a window
  // that ended: merge into the committed archive rather than replacing it.
  const merged = mergeAzCalls(previousCalls(), calls);
  if (!merged.length) {
    console.log("no call with a labelled end yet — no snapshot written");
    return;
  }
  console.log(`wrote ${writeSnapshot("az", merged)}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
