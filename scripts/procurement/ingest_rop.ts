// Pre-ЦАИС РОП contract-register backfill ingest.
//
// Why this exists. АОП never published a machine-readable annual contracts dump
// for 2018 (data.egov.bg has only `excl2018.csv` — 37 out-of-scope rows), and
// ЦАИС ЕОП did not exist yet, so neither feed the site already ingests can cover
// 2018. The full corpus lives only in the legacy РОП web register at
// www.aop.bg, whose contract search returns a server-rendered HTML table by
// publication-date range. This CLI walks that search day-by-day, resolves the
// name-only rows to EIKs from our existing corpus (see normalize_rop.ts), and
// writes Contract month-shards — the same shape ingest.ts / ingest_eop.ts emit.
//
//   tsx scripts/procurement/ingest_rop.ts --backfill --from 2018-01-01 --to 2018-12-31            # dry run
//   tsx scripts/procurement/ingest_rop.ts --backfill --from 2018-01-01 --to 2018-12-31 --apply    # write
//   tsx scripts/procurement/ingest.ts   # then rebuild derived (or db:load:pg to reload PG)
//
// It deliberately does NOT rebuild rollups/derived — do that the normal way
// (single-sourced in ingest.ts), or just `npm run db:load:pg` which reads the
// shards straight into Postgres.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import {
  parseRopHtml,
  buildResolutionMaps,
  normalizeRopRows,
  type RopRow,
  type ResolutionMaps,
} from "./normalize_rop";
import { canonicalJson, findHugeContracts, validateContract } from "./validate";
import type { Contract } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "contracts");
const CACHE_DIR = path.resolve(__dirname, "../../raw_data/procurement/rop");

const SEARCH_URL = "https://www.aop.bg/esearch_awards_from_to.php";
const PAGE_SIZE = 50;

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

// Fetch one page's raw HTML (windows-1251), caching it gzipped under raw_data/.
// Retries on timeout / 5xx / network error — the register is frequently slow.
const fetchPage = async (
  day: string,
  page: number,
  refresh: boolean,
): Promise<string> => {
  const cacheFile = path.join(CACHE_DIR, `${day}_p${page}.html.gz`);
  if (!refresh && fs.existsSync(cacheFile)) {
    return zlib.gunzipSync(fs.readFileSync(cacheFile)).toString("utf8");
  }
  const url = pageUrl(day, page);
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "electionsbg.com data pipeline (procurement/rop)",
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
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, zlib.gzipSync(Buffer.from(html, "utf8")));
      return html;
    } catch (err) {
      lastErr = err as Error;
      if (attempt < 4) await sleep(attempt * 2_000);
    }
  }
  throw lastErr ?? new Error(`GET ${day} p${page} failed`);
};

// Fetch every page of one day and return all parsed rows. Cross-checks the row
// count against the register's reported total so a truncated crawl is loud.
const fetchDay = async (
  day: string,
  refresh: boolean,
  delayMs: number,
): Promise<{ rows: RopRow[]; total: number; shortfall: boolean }> => {
  const first = parseRopHtml(await fetchPage(day, 1, refresh));
  const rows = [...first.rows];
  const pages = Math.max(first.pages, Math.ceil(first.total / PAGE_SIZE));
  for (let p = 2; p <= pages; p++) {
    if (delayMs > 0 && !refresh) await sleep(delayMs);
    const pg = parseRopHtml(await fetchPage(day, p, refresh));
    rows.push(...pg.rows);
  }
  return { rows, total: first.total, shortfall: rows.length < first.total };
};

// ---- month-shard writer (mirrors ingest.ts / ingest_eop.ts) ----------------

const rowKey = (r: Contract): string =>
  `${r.releaseId}::${r.contractId ?? ""}::${r.contractorEik}::${r.tag}`;

const rowSort = (a: Contract, b: Contract): number => {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  if (a.ocid !== b.ocid) return a.ocid.localeCompare(b.ocid);
  return rowKey(a).localeCompare(rowKey(b));
};

const writeMonthShards = (
  rows: Contract[],
): { newFiles: number; modifiedFiles: number } => {
  if (rows.length === 0) return { newFiles: 0, modifiedFiles: 0 };
  const byMonth = new Map<string, Contract[]>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const arr = byMonth.get(month) ?? [];
    arr.push(r);
    byMonth.set(month, arr);
  }
  let newFiles = 0;
  let modifiedFiles = 0;
  for (const [month, freshRows] of byMonth) {
    const dir = path.join(CONTRACTS_DIR, month.slice(0, 4));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${month}.json`);
    const existing: Contract[] = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, "utf8")) as Contract[])
      : [];
    const byKey = new Map<string, Contract>();
    for (const r of existing) byKey.set(rowKey(r), r);
    for (const r of freshRows) byKey.set(rowKey(r), r);
    const merged = [...byKey.values()].sort(rowSort);
    const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const next = canonicalJson(merged);
    if (next === prev) continue;
    fs.writeFileSync(file, next);
    if (prev == null) newFiles++;
    else modifiedFiles++;
  }
  return { newFiles, modifiedFiles };
};

// ---- cross-source content dedup (mirrors ingest_eop.ts) --------------------

const normContractNo = (s: string | undefined): string =>
  (s ?? "").toLocaleLowerCase("bg").replace(/[\s".,\-_/№#]/g, "");

const contentKeys = (r: Contract): string[] => {
  const keys: string[] = [];
  const amt = r.amountEur != null ? String(Math.round(r.amountEur)) : "";
  if (r.unp && r.contractorEik) keys.push(`u:${r.unp}:${r.contractorEik}:${amt}`);
  const cn = normContractNo(r.contractId);
  if (cn && r.awarderEik && r.contractorEik)
    keys.push(`c:${r.awarderEik}:${r.contractorEik}:${cn}:${r.dateSigned ?? ""}`);
  if (r.awarderEik && r.contractorEik && (r.dateSigned || amt !== ""))
    keys.push(`f:${r.awarderEik}:${r.contractorEik}:${r.dateSigned ?? ""}:${amt}`);
  return keys;
};

const loadExistingContentKeys = (years: Set<string>): Set<string> => {
  const out = new Set<string>();
  for (const year of years) {
    const dir = path.join(CONTRACTS_DIR, year);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}\.json$/.test(f)) continue;
      const rows = JSON.parse(
        fs.readFileSync(path.join(dir, f), "utf8"),
      ) as Contract[];
      if (!Array.isArray(rows)) continue;
      for (const r of rows) for (const k of contentKeys(r)) out.add(k);
    }
  }
  return out;
};

// Run `worker` over `items` with at most `concurrency` in flight. Results are
// returned in input order. A worker that throws yields `undefined` for that
// item (the caller treats a missing day as a shortfall).
const runPool = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<R | undefined>> => {
  const out: Array<R | undefined> = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await worker(items[i], i);
      } catch {
        out[i] = undefined;
      }
    }
  });
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
  if (days.length > 40 && !args.backfill) {
    throw new Error(
      `window is ${days.length} days — pass --backfill to confirm a large crawl`,
    );
  }

  console.log(`→ building EIK-resolution maps from the on-disk corpus`);
  const maps: ResolutionMaps = buildResolutionMaps(CONTRACTS_DIR);
  console.log(
    `  awarder prefixes ${maps.awarderByPrefix.size.toLocaleString()}, ` +
      `awarder names ${maps.awarderByName.size.toLocaleString()}, ` +
      `contractor names ${maps.contractorByName.size.toLocaleString()}`,
  );

  const years = new Set(days.map((d) => d.slice(0, 4)));
  const existingKeys = loadExistingContentKeys(years);
  console.log(
    `→ ${days.length} day(s) ${args.from}…${args.to}; deduping against ` +
      `${existingKeys.size.toLocaleString()} content key(s) from ` +
      `${[...years].sort().join(", ")} on disk`,
  );

  const kept: Contract[] = [];
  const agg = {
    daysWithRows: 0,
    rowsSeen: 0,
    rowsEmitted: 0,
    droppedNoAwarderEik: 0,
    droppedNoContractorEik: 0,
    droppedNoAmount: 0,
    droppedSelfDeal: 0,
    droppedDuplicate: 0,
  };
  const shortfallDays: string[] = [];

  // Fetch the slow network in parallel (bounded), then normalize + dedup
  // sequentially in date order so the dedup ("first row wins") is deterministic.
  console.log(`→ fetching ${days.length} day(s) with concurrency ${args.concurrency}`);
  let done = 0;
  const fetched = await runPool(days, args.concurrency, async (day) => {
    const res = await fetchDay(day, args.refreshCache, args.delayMs);
    done++;
    if (done % 25 === 0 || done === days.length)
      console.log(`  …${done}/${days.length} days fetched`);
    return res;
  });

  days.forEach((day, i) => {
    const res = fetched[i];
    if (!res) {
      shortfallDays.push(day);
      return;
    }
    if (res.shortfall) shortfallDays.push(day);
    if (res.rows.length === 0) return;
    agg.daysWithRows++;
    const { contracts, stats } = normalizeRopRows(res.rows, maps, pageUrl(day, 1));
    agg.rowsSeen += stats.rowsSeen;
    agg.rowsEmitted += stats.rowsEmitted;
    agg.droppedNoAwarderEik += stats.droppedNoAwarderEik;
    agg.droppedNoContractorEik += stats.droppedNoContractorEik;
    agg.droppedNoAmount += stats.droppedNoAmount;
    agg.droppedSelfDeal += stats.droppedSelfDeal;
    for (const r of contracts) {
      const keys = contentKeys(r);
      if (keys.some((k) => existingKeys.has(k))) {
        agg.droppedDuplicate++;
        continue;
      }
      for (const k of keys) existingKeys.add(k);
      kept.push(r);
    }
  });

  kept.forEach(validateContract);
  const huge = findHugeContracts(kept);
  if (huge.length > 0)
    console.log(
      `  ⚠ ${huge.length} contract(s) ≥1B — glance: ${huge
        .slice(0, 3)
        .map((h) => `${h.releaseId} ${h.amount}`)
        .join("; ")}`,
    );

  console.log(
    `→ ${agg.daysWithRows} day(s) with rows; ${agg.rowsSeen.toLocaleString()} row(s) seen`,
  );
  console.log(
    `→ resolution drops — awarder ${agg.droppedNoAwarderEik.toLocaleString()}, ` +
      `contractor ${agg.droppedNoContractorEik.toLocaleString()}, ` +
      `no-amount ${agg.droppedNoAmount.toLocaleString()}, ` +
      `self-deal ${agg.droppedSelfDeal.toLocaleString()}`,
  );
  const resolvable = agg.rowsSeen - agg.droppedNoAwarderEik - agg.droppedNoContractorEik;
  if (agg.rowsSeen > 0)
    console.log(
      `  EIK-resolved ${resolvable.toLocaleString()}/${agg.rowsSeen.toLocaleString()} ` +
        `(${((100 * resolvable) / agg.rowsSeen).toFixed(1)}%)`,
    );
  console.log(
    `→ cross-source dedup: kept ${kept.length.toLocaleString()} NEW row(s); ` +
      `dropped ${agg.droppedDuplicate.toLocaleString()} already in corpus`,
  );
  if (shortfallDays.length > 0)
    console.log(
      `  ⚠ ${shortfallDays.length} day(s) failed or returned fewer rows than the ` +
        `reported total — re-run (cache makes it cheap) to complete: ` +
        `${shortfallDays.slice(0, 8).join(", ")}${shortfallDays.length > 8 ? " …" : ""}`,
    );

  if (!args.apply) {
    console.log(`✓ dry run — pass --apply to write month-shards`);
    return;
  }
  if (kept.length === 0) {
    console.log(`✓ nothing new to write`);
    return;
  }
  const { newFiles, modifiedFiles } = writeMonthShards(kept);
  console.log(`→ wrote ${newFiles} new + ${modifiedFiles} modified month-shard(s)`);
  console.log(`✓ done. Now reload PG:\n    npm run db:load:pg`);
};

const cli = command({
  name: "ingest_rop",
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
      description: "Confirm a large (>40-day) crawl window.",
      defaultValue: () => false,
    }),
    apply: flag({
      type: optional(boolean),
      long: "apply",
      description: "Write month-shards (default is a dry run).",
      defaultValue: () => false,
    }),
    refreshCache: flag({
      type: optional(boolean),
      long: "refresh-cache",
      description: "Re-download days even when a cached copy exists.",
      defaultValue: () => false,
    }),
    delayMs: option({
      type: optional(string),
      long: "delay-ms",
      description: "Politeness delay between a day's page fetches (default 250).",
    }),
    concurrency: option({
      type: optional(string),
      long: "concurrency",
      description: "Days fetched in parallel (default 6). The register is slow.",
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
      concurrency: args.concurrency ? Math.max(1, parseInt(args.concurrency, 10)) : 6,
    }),
});

run(cli, process.argv.slice(2));
