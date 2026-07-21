// Pre-ЦАИС РОП tender (procedure) backfill ingest — the tender-STAGE counterpart
// to ingest_rop.ts (which backfills pre-2020 CONTRACTS from the same register).
//
// Why this exists. ЦАИС ЕОП (storage.eop.bg), the only source the tenders
// pipeline ingests, did not exist before 2020 — so the tender corpus starts in
// 2020. But the legacy РОП (Регистър на обществените поръчки) at www.aop.bg has a
// procedure-stage search — esearch_cases_from_to.php ("преписки" = the procedures
// themselves) — that returns a server-rendered HTML table by publication-date
// range, reaching back a decade. This CLI walks that search day-by-day, resolves
// its name-only buyer rows to EIKs from our existing corpus (the SAME resolution
// ingest_rop.ts uses), and emits synthetic EopTenderRecord day-caches under
// raw_data/procurement/rop_tenders/. ingest_tenders.ts merges that cache into its
// rebuild, so one backfill extends the whole tenders tree (shards, index,
// lineage, search) back before 2020 with no changes to the serving layer.
//
//   tsx scripts/procurement/ingest_rop_tenders.ts --from 2018-01-01 --to 2018-12-31            # dry run
//   tsx scripts/procurement/ingest_rop_tenders.ts --backfill --from 2010-01-01 --to 2019-12-31 --apply
//   tsx scripts/procurement/ingest_tenders.ts --apply   # then rebuild the tenders tree from all caches
//
// The cases-search columns (fixed order):
//   № | Дата на публикуване | УНП | Възложител | Процедура | Обект | Предмет |
//   Прогнозна стойност | Валута | Европейско финансиране
// That maps onto the tender shape: УНП (spine), buyer, procedure type, object
// (works/goods/services), subject, and the QUARANTINED estimated (прогнозна)
// value. The register carries NO lots, CPV, or numeric tenderId at list level, so
// these procedures land without lots/CPV/ocid — lineage to the signed contract
// still holds via УНП (contracts↔tenders join key is УНП, not ocid).

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import { buildResolutionMaps, type ResolutionMaps } from "./normalize_rop";
import {
  parseCasesHtml,
  resolveBuyerEik,
  toEopRecord,
  type RopCaseRow,
} from "./normalize_rop_tender";
import type { EopTenderRecord } from "./eop_tender_types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "contracts");
// Raw HTML page cache (one gz per day+page) — the slow-scrape cache.
const HTML_CACHE_DIR = path.resolve(
  __dirname,
  "../../raw_data/procurement/rop_tenders_html",
);
// Synthetic EopTenderRecord day-caches — the file ingest_tenders.ts reads.
const REC_CACHE_DIR = path.resolve(
  __dirname,
  "../../raw_data/procurement/rop_tenders",
);

const SEARCH_URL = "https://www.aop.bg/esearch_cases_from_to.php";
const PAGE_SIZE = 50;
// Safety cap: no single publication day has anywhere near 2000 procedures. A day
// that hits this is a runaway (pager loop) and is logged as a shortfall.
const MAX_PAGES = 40;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const enumerateDays = (from: string, to: string): string[] => {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
};

// YYYY-MM-DD → DD/MM/YYYY (the register's expected input format).
const toBgDate = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const pageUrl = (day: string, page: number): string => {
  const bg = encodeURIComponent(toBgDate(day));
  const base = `${SEARCH_URL}?mode=search&validated_on_from=${bg}&validated_on_to=${bg}`;
  return page > 1 ? `${base}&_page=${page}` : base;
};

// Fetch one page's raw HTML (windows-1251), caching it gzipped. Retries on
// timeout / 5xx / network error — the register is frequently slow.
const fetchPage = async (
  day: string,
  page: number,
  refresh: boolean,
): Promise<string> => {
  const cacheFile = path.join(HTML_CACHE_DIR, `${day}_p${page}.html.gz`);
  if (!refresh && fs.existsSync(cacheFile)) {
    return zlib.gunzipSync(fs.readFileSync(cacheFile)).toString("utf8");
  }
  const url = pageUrl(day, page);
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "electionsbg.com data pipeline (procurement/rop-tenders)",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`GET ${day} p${page} → ${res.status}`);
      // Same-host guard: never follow a redirect off aop.bg.
      if (new URL(res.url || url).host !== new URL(url).host) {
        throw new Error(`refusing cross-host redirect for ${day}: ${res.url}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const html = new TextDecoder("windows-1251").decode(buf);
      fs.mkdirSync(HTML_CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, zlib.gzipSync(Buffer.from(html, "utf8")));
      return html;
    } catch (err) {
      lastErr = err as Error;
      if (attempt < 4) await sleep(attempt * 2_000);
    }
  }
  throw lastErr ?? new Error(`GET ${day} p${page} failed`);
};

// Fetch every page of one day and return all parsed rows. The register omits a
// reliable pager total, so we page until a page returns fewer than PAGE_SIZE rows
// (the last page, possibly empty). A page that errors after retries sets `failed`
// so the caller re-runs it (cache makes that cheap).
const fetchDay = async (
  day: string,
  refresh: boolean,
  delayMs: number,
): Promise<{ rows: RopCaseRow[]; failed: boolean; cappedOut: boolean }> => {
  const rows: RopCaseRow[] = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    let pageRows: RopCaseRow[];
    try {
      pageRows = parseCasesHtml(await fetchPage(day, p, refresh));
    } catch {
      return { rows, failed: true, cappedOut: false };
    }
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE)
      return { rows, failed: false, cappedOut: false };
    if (delayMs > 0 && !refresh) await sleep(delayMs);
  }
  return { rows, failed: false, cappedOut: true };
};

// Write one day's synthetic records to the record cache (gz JSON array). Empty
// days are cached as [] so a re-run doesn't re-scrape a genuinely empty day.
const writeRecCache = (day: string, recs: EopTenderRecord[]): void => {
  fs.mkdirSync(REC_CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REC_CACHE_DIR, `${day}.json.gz`),
    zlib.gzipSync(JSON.stringify(recs)),
  );
};

// Run `worker` over `items` with at most `concurrency` in flight. A worker that
// throws yields `undefined` for that item (a missing day = a shortfall).
const runPool = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<R | undefined>> => {
  const out: Array<R | undefined> = new Array(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        try {
          out[i] = await worker(items[i], i);
        } catch {
          out[i] = undefined;
        }
      }
    },
  );
  await Promise.all(runners);
  return out;
};

const main = async (args: {
  from: string;
  to: string;
  backfill: boolean;
  apply: boolean;
  refreshCache: boolean;
  delayMs: number;
  concurrency: number;
}): Promise<void> => {
  const days = enumerateDays(args.from, args.to);
  if (days.length > 45 && !args.backfill) {
    throw new Error(
      `window is ${days.length} days — pass --backfill to confirm a large crawl`,
    );
  }

  console.log(
    `→ building EIK-resolution maps from the on-disk contract corpus`,
  );
  const maps: ResolutionMaps = buildResolutionMaps(CONTRACTS_DIR);
  console.log(
    `  awarder prefixes ${maps.awarderByPrefix.size.toLocaleString()}, ` +
      `awarder names ${maps.awarderByName.size.toLocaleString()}`,
  );

  console.log(
    `→ fetching ${days.length} day(s) ${args.from}…${args.to} with concurrency ${args.concurrency}`,
  );
  let done = 0;
  const fetched = await runPool(days, args.concurrency, async (day) => {
    const res = await fetchDay(day, args.refreshCache, args.delayMs);
    done++;
    if (done % 25 === 0 || done === days.length)
      console.log(`  …${done}/${days.length} days fetched`);
    return res;
  });

  const agg = {
    daysWithRows: 0,
    rowsSeen: 0,
    resolved: 0,
    droppedNoEik: 0,
  };
  const shortfallDays: string[] = [];
  // Day → its synthetic records (only resolvable rows are emitted).
  const perDay = new Map<string, EopTenderRecord[]>();

  days.forEach((day, i) => {
    const res = fetched[i];
    if (!res || res.failed || res.cappedOut) {
      shortfallDays.push(day);
      if (res?.cappedOut) console.log(`  ! ${day}: hit page cap — investigate`);
      return;
    }
    // A cleanly-fetched day (even 0 rows) is authoritative — record it so
    // writeRecCache can cache [] and skip it on the next run.
    perDay.set(day, []);
    if (res.rows.length === 0) return;
    agg.daysWithRows++;
    const src = pageUrl(day, 1);
    const recs = perDay.get(day)!;
    for (const row of res.rows) {
      agg.rowsSeen++;
      const eik = resolveBuyerEik(row, maps);
      if (!eik) {
        agg.droppedNoEik++;
        continue;
      }
      agg.resolved++;
      recs.push(toEopRecord(row, eik, src));
    }
  });

  console.log(
    `→ ${agg.daysWithRows} day(s) with rows; ${agg.rowsSeen.toLocaleString()} procedure row(s) seen`,
  );
  if (agg.rowsSeen > 0)
    console.log(
      `  EIK-resolved ${agg.resolved.toLocaleString()}/${agg.rowsSeen.toLocaleString()} ` +
        `(${((100 * agg.resolved) / agg.rowsSeen).toFixed(1)}%); ` +
        `dropped ${agg.droppedNoEik.toLocaleString()} unresolved`,
    );
  if (shortfallDays.length > 0)
    console.log(
      `  ⚠ ${shortfallDays.length} day(s) failed to fetch — re-run (cache makes ` +
        `it cheap) to complete: ${shortfallDays.slice(0, 8).join(", ")}` +
        `${shortfallDays.length > 8 ? " …" : ""}`,
    );

  if (!args.apply) {
    const totalRecs = [...perDay.values()].reduce((s, r) => s + r.length, 0);
    console.log(
      `✓ dry run — pass --apply to write ${totalRecs.toLocaleString()} record(s) ` +
        `across ${perDay.size} day-cache(s). Then run ingest_tenders.ts --apply.`,
    );
    return;
  }

  // Only write days we cleanly fetched (a shortfall day is left uncached so the
  // next run re-fetches it, rather than freezing a partial day into the cache).
  let files = 0;
  for (const [day, recs] of perDay) {
    writeRecCache(day, recs);
    files++;
  }
  console.log(`→ wrote ${files} day-cache(s) under ${REC_CACHE_DIR}`);
  console.log(
    `✓ done. Now rebuild the tenders tree (merges these + the ЦАИС cache):\n` +
      `    tsx scripts/procurement/ingest_tenders.ts --apply\n` +
      `  then reload PG:  npm run db:load:tenders:pg`,
  );
};

const cli = command({
  name: "ingest_rop_tenders",
  args: {
    from: option({
      type: string,
      long: "from",
      description: "First publication day (YYYY-MM-DD).",
    }),
    to: option({
      type: string,
      long: "to",
      description: "Last publication day (YYYY-MM-DD).",
    }),
    backfill: flag({
      type: optional(boolean),
      long: "backfill",
      description: "Confirm a large (>45-day) crawl window.",
      defaultValue: () => false,
    }),
    apply: flag({
      type: optional(boolean),
      long: "apply",
      description: "Write the record day-caches (default is a dry run).",
      defaultValue: () => false,
    }),
    refreshCache: flag({
      type: optional(boolean),
      long: "refresh-cache",
      description: "Re-download days even when a cached HTML page exists.",
      defaultValue: () => false,
    }),
    delayMs: option({
      type: optional(string),
      long: "delay-ms",
      description:
        "Politeness delay between a day's page fetches (default 250).",
    }),
    concurrency: option({
      type: optional(string),
      long: "concurrency",
      description:
        "Days fetched in parallel (default 6). The register is slow.",
    }),
  },
  handler: (args) =>
    main({
      from: args.from,
      to: args.to,
      backfill: !!args.backfill,
      apply: !!args.apply,
      refreshCache: !!args.refreshCache,
      delayMs: args.delayMs ? parseInt(args.delayMs, 10) : 250,
      concurrency: args.concurrency
        ? Math.max(1, parseInt(args.concurrency, 10))
        : 6,
    }),
});

run(cli, process.argv.slice(2));
