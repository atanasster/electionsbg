// TED ingest (plan P10) — crawl Bulgarian notices from the open v3 API into
// data/procurement/ted.json.
//
//   npx tsx scripts/procurement/ted/ingest.ts --probe   # one year, no write
//   npx tsx scripts/procurement/ted/ingest.ts --apply   # 2015→now
//
// Resumable per YEAR: a year already present in the on-disk artifact is skipped
// unless --refresh. TED is immutable for closed years, so re-crawling them is
// pure waste; the current year is always re-fetched.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONCURRENCY,
  TED_FIELDS,
  TED_FIRST_YEAR,
  PAGE_DELAY_MS,
  TED_PAGE_SIZE,
  TED_SEARCH_URL,
  tedQuery,
} from "./sources";
import { parseTedNotice, type TedNotice } from "./parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../../data/procurement/ted.json");

type Page = {
  notices?: Record<string, unknown>[];
  totalNoticeCount?: number;
  iterationNextToken?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ⚠️ 429 IS RETRYABLE AND 4xx IS NOT — the first cut lumped them together with
 *  „4xx is our query being wrong", and TED answered 429 on the second page of
 *  the very first year, killing the crawl. TED does rate-limit (the API
 *  publishes no figure; measured, two concurrent paginating workers trip it
 *  immediately). Honour `Retry-After` when it is sent, back off generously when
 *  it is not, and keep every other 4xx fatal — a malformed query never improves. */
const post = async (body: unknown): Promise<Page> => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(TED_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return (await res.json()) as Page;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 5)
      throw new Error(
        `TED ${res.status} ${res.statusText}` +
          (res.status === 429 ? " — still rate-limited after 6 attempts" : ""),
      );
    const after = Number(res.headers.get("retry-after"));
    const wait =
      Number.isFinite(after) && after > 0 ? after * 1000 : 2000 * 2 ** attempt;
    await sleep(wait);
  }
};

/** One year, walked with the iteration token. A plain `page` parameter caps out
 *  well below the ~30k notices a Bulgarian year holds. */
const crawlYear = async (year: number): Promise<TedNotice[]> => {
  const out: TedNotice[] = [];
  let token: string | undefined;
  let expected = 0;
  for (;;) {
    const page = await post({
      query: tedQuery(year),
      fields: [...TED_FIELDS],
      limit: TED_PAGE_SIZE,
      paginationMode: "ITERATION",
      ...(token ? { iterationNextToken: token } : {}),
    });
    if (!expected) expected = page.totalNoticeCount ?? 0;
    const batch = page.notices ?? [];
    for (const n of batch) {
      const row = parseTedNotice(n);
      if (row) out.push(row);
    }
    token = page.iterationNextToken;
    if (!token || !batch.length) break;
    // Paced deliberately. A year is ~120 pages, so this costs ~1 min/year and
    // is what keeps the crawl inside TED's unpublished limit.
    await sleep(PAGE_DELAY_MS);
  }
  // ⚠️ A SHORT YEAR IS A SILENT HOLE. The whole point of TED here is „what is
  // missing from our corpus", so a year that stopped paginating early would
  // manufacture exactly the finding this dataset exists to make.
  if (expected && out.length < expected * 0.98)
    throw new Error(
      `${year}: got ${out.length} of ${expected} notices — pagination stopped ` +
        `early. Refusing to record a partial year, which would read as ` +
        `„these procurements were never published in TED".`,
    );
  return out;
};

const main = async (): Promise<void> => {
  const apply = process.argv.includes("--apply");
  const probe = process.argv.includes("--probe");
  const refresh = process.argv.includes("--refresh");
  const now = new Date().getUTCFullYear();
  const years = probe
    ? [now - 1]
    : Array.from(
        { length: now - TED_FIRST_YEAR + 1 },
        (_, i) => TED_FIRST_YEAR + i,
      );

  const prev: Record<string, TedNotice[]> =
    !refresh && fs.existsSync(OUT)
      ? (JSON.parse(fs.readFileSync(OUT, "utf8")).byYear ?? {})
      : {};

  const byYear: Record<string, TedNotice[]> = { ...prev };
  let queue = years.filter(
    // The current year is never final — always re-fetch it.
    (y) => refresh || y === now || !prev[String(y)]?.length,
  );
  if (probe) queue = years;
  console.log(
    `→ ${years.length} year(s); ${queue.length} to fetch, ` +
      `${years.length - queue.length} already on disk`,
  );

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= queue.length) return;
        const y = queue[i];
        const rows = await crawlYear(y);
        byYear[String(y)] = rows;
        console.log(`  ${y}: ${rows.length.toLocaleString()} notices`);
      }
    }),
  );

  // ⚠️ AN EMPTY YEAR IS NOT „NO PROCUREMENT" — it is the API's coverage floor.
  // TED's v3 index does not reach back indefinitely: 2015 returns 0 while 2019
  // returns ~17,000. Recording the empty years would put „Bulgaria published
  // nothing above the EU threshold" into an artifact whose ENTIRE PURPOSE is to
  // say what is missing from the national corpus. They are dropped, and the
  // floor that survives is reported.
  for (const [y, rows] of Object.entries(byYear))
    if (!rows.length) delete byYear[y];
  const covered = Object.keys(byYear)
    .map(Number)
    .sort((a, b) => a - b);
  if (!covered.length) throw new Error("no year returned any notice");
  if (covered[0] > TED_FIRST_YEAR)
    console.log(
      `  note: TED's index starts at ${covered[0]}; ${covered[0] - TED_FIRST_YEAR} ` +
        `earlier year(s) returned nothing and were DROPPED rather than recorded ` +
        `as zero.`,
    );

  const all = Object.values(byYear).flat();
  const withEik = all.filter((n) => n.buyerEik).length;
  console.log(
    `\n  ${all.length.toLocaleString()} notices · ` +
      `${withEik.toLocaleString()} with a buyer ЕИК ` +
      `(${((withEik / Math.max(all.length, 1)) * 100).toFixed(1)}%) · ` +
      `${new Set(all.map((n) => n.buyerEik).filter(Boolean)).size.toLocaleString()} distinct buyers`,
  );

  if (!apply) {
    console.log(
      "\n(dry run — pass --apply to write data/procurement/ted.json)",
    );
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        source: {
          url: TED_SEARCH_URL,
          fetchedAt: new Date().toISOString().slice(0, 10),
        },
        counts: {
          notices: all.length,
          withBuyerEik: withEik,
          // The span actually covered, so a consumer cannot read the artifact's
          // earliest year as the earliest year of Bulgarian EU-threshold
          // procurement.
          firstYear: covered[0],
          lastYear: covered[covered.length - 1],
        },
        byYear,
      },
      null,
      1,
    )}\n`,
  );
  console.log(`\n✓ wrote ${path.relative(process.cwd(), OUT)}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
