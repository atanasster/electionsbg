// Crawl the АХУ news page into a committed open-calls snapshot. See ahu_parse.ts for what
// counts as a call and how its deadline is read.
//
//   npm run opencalls:ahu            # fetch + write data/opencalls/ahu.json
//   npm run opencalls:ahu -- --dry   # fetch, report, write nothing
//
// One GET, with an identifying User-Agent: the news page carries ~125 items, every call
// among them, so there is no per-call fetch.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AHU_NEWS_URL,
  MIN_NEWS_ITEMS,
  parseAhuItem,
  parseAhuNews,
} from "./ahu_parse";
import type { OpenCall } from "./types";
import { writeSnapshot } from "./write_snapshot";

const UA = "electionsbg-opencalls/1.0 (+https://electionsbg.com)";
const RAW_DIR = "raw_data/opencalls/ahu";

const main = async (): Promise<void> => {
  const dry = process.argv.includes("--dry");
  const res = await fetch(AHU_NEWS_URL, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${AHU_NEWS_URL} → HTTP ${res.status}`);
  const html = await res.text();
  try {
    mkdirSync(RAW_DIR, { recursive: true });
    writeFileSync(path.join(RAW_DIR, "news.html"), html, "utf8");
  } catch {
    // Best-effort debugging cache; never fail a crawl over it.
  }

  const items = parseAhuNews(html);
  if (items.length < MIN_NEWS_ITEMS)
    throw new Error(
      `АХУ news page parsed to ${items.length} item(s) (expected ~125) — the markup changed; nothing written`,
    );

  const now = new Date();
  const calls: OpenCall[] = [];
  for (const it of items) {
    const o = parseAhuItem(it);
    if (!o) continue;
    if (o.kind === "call") calls.push(o.call);
    else console.log(`  ✗ ${o.date} ${o.title.slice(0, 70)} — ${o.why}`);
  }
  const open = calls.filter(
    (c) => c.closesAt && c.closesAt >= now.toISOString(),
  );
  console.log(
    `АХУ: ${items.length} news item(s) → ${calls.length} call(s) ` +
      `(${open.length} open now)`,
  );
  if (dry) {
    console.log("--dry: nothing written");
    return;
  }
  console.log(`wrote ${writeSnapshot("ahu", calls)}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
