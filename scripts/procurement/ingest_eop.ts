// ЦАИС ЕОП flat-feed procurement gap-fill ingest.
//
// Why this exists. Our primary procurement feed (ingest.ts) pulls АОП's OCDS
// "обявления" bundles from data.egov.bg. That OCDS export omits ~900 small
// contracting authorities — overwhelmingly schools & kindergartens — whose
// signed contracts only appear in ЦАИС ЕОП's own flat "договори" open-data feed
// at storage.eop.bg (one bucket per day). This ingest fetches that flat feed
// and gap-fills ONLY buyers that are entirely absent from our corpus, so an EOP
// row can never double-count an OCDS contract (an absent buyer has zero OCDS
// rows by definition).
//
// Two modes (mirrors the kzp_prices pattern):
//   - INCREMENTAL (default): last ~30 days. Cheap; run by /update-procurement
//     when the `eop_procurement` watcher source flips. No --backfill needed.
//   - BACKFILL (one-off, flag-gated): the full 2020→ history (~1,600 daily
//     files). `--backfill --from 2020-01-01`. Operator-run, never in CI.
//
// It deliberately does NOT rebuild rollups. After a run, rebuild the derived
// data the normal way (single-sourced in ingest.ts), which picks up the new
// shards from disk:
//
//   tsx scripts/procurement/ingest_eop.ts --apply                          # incremental
//   tsx scripts/procurement/ingest_eop.ts --backfill --from 2020-01-01 --apply  # full history
//   tsx scripts/procurement/ingest.ts            # rebuilds rollups/derived/by-settlement/index
//
// See README + the update-procurement skill.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import { normalizeEopDay, type EopContractRecord } from "./normalize_eop";
import { canonicalJson } from "./validate";
import type { Contract } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "contracts");
const AWARDERS_DIR = path.join(PROCUREMENT_DIR, "awarders");
const CACHE_DIR = path.resolve(__dirname, "../../raw_data/procurement/eop");

const EOP_BASE = "https://storage.eop.bg";

// The flat договори object key embeds the day as DD.MM.YYYY. Verified live
// against storage.eop.bg (2020→2026): this base file is always present on a
// published day. The OCDS package in the same bucket is the data.egov.bg feed
// we already ingest — we deliberately read only the flat договори superset here.
const dogovoriKey = (day: string): string => {
  const [y, m, d] = day.split("-");
  return `Автоматично генерирани данни за договори, публикувани в ЦАИС ЕОП на ${d}.${m}.${y}.json`;
};

const dayUrl = (day: string): string =>
  `${EOP_BASE}/open-data-${day}/${encodeURIComponent(dogovoriKey(day))}`;

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

// Fetch a day's flat договори records, caching the raw JSON gzipped under
// raw_data/. Returns null when the day is not published (403/404) — the bucket
// is sparse (no weekend/holiday publications). Throws on unexpected errors.
const fetchDay = async (
  day: string,
  refresh: boolean,
): Promise<EopContractRecord[] | null> => {
  const cacheFile = path.join(CACHE_DIR, `${day}.json.gz`);
  if (!refresh && fs.existsSync(cacheFile)) {
    const raw = zlib.gunzipSync(fs.readFileSync(cacheFile)).toString("utf8");
    return JSON.parse(raw) as EopContractRecord[];
  }
  const url = dayUrl(day);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "electionsbg.com data pipeline (procurement/eop)",
      Accept: "application/json",
    },
  });
  if (res.status === 403 || res.status === 404) return null; // day not published
  if (!res.ok) throw new Error(`GET ${day} → ${res.status} ${res.statusText}`);
  // Same-host guard: never follow a redirect off storage.eop.bg.
  if (new URL(res.url || url).host !== new URL(url).host) {
    throw new Error(`refusing cross-host redirect for ${day}: ${res.url}`);
  }
  const body = await res.json();
  const records: EopContractRecord[] = Array.isArray(body)
    ? (body as EopContractRecord[])
    : ((body?.data ?? body?.contracts ?? []) as EopContractRecord[]);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, zlib.gzipSync(JSON.stringify(records)));
  return records;
};

// Existing awarder EIKs = the gap-fill exclusion set. A buyer already in our
// corpus has OCDS rows; we leave those untouched and only add buyers we lack.
const loadExistingAwarderEiks = (): Set<string> => {
  const out = new Set<string>();
  if (!fs.existsSync(AWARDERS_DIR)) return out;
  for (const f of fs.readdirSync(AWARDERS_DIR)) {
    const m = f.match(/^(\d{9,13})\.json$/);
    if (m) out.add(m[1]);
  }
  return out;
};

// ---- month-shard writer (mirrors ingest.ts; replicated to keep this module
// fully additive and avoid importing ingest.ts, whose module body runs a CLI). ----

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
    const year = month.slice(0, 4);
    const dir = path.join(CONTRACTS_DIR, year);
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

const main = async (args: {
  from: string;
  to: string;
  backfill: boolean;
  apply: boolean;
  refreshCache: boolean;
  delayMs: number;
}): Promise<void> => {
  const days = enumerateDays(args.from, args.to);
  // One-off-backfill guardrail: a window wider than ~5 weeks must opt in with
  // --backfill so the heavy full-range crawl is never run by accident.
  if (days.length > 40 && !args.backfill) {
    throw new Error(
      `window is ${days.length} days — pass --backfill to confirm a large crawl ` +
        `(or narrow --from/--to)`,
    );
  }

  const existing = loadExistingAwarderEiks();
  console.log(
    `→ ${days.length} day(s) ${args.from}…${args.to}; ` +
      `${existing.size} existing awarder(s) form the gap-fill exclusion set`,
  );

  const kept: Contract[] = [];
  const newBuyers = new Set<string>();
  let daysPublished = 0;
  let daysMissing = 0;
  let recordsSeen = 0;
  let rowsBeforeGapfill = 0;
  let droppedExisting = 0;

  for (const day of days) {
    let records: EopContractRecord[] | null;
    try {
      records = await fetchDay(day, args.refreshCache);
    } catch (err) {
      console.log(`  ! ${day}: ${(err as Error).message}`);
      continue;
    }
    if (records == null) {
      daysMissing++;
      continue;
    }
    daysPublished++;
    recordsSeen += records.length;
    const { rows } = normalizeEopDay(records, day, dayUrl(day));
    rowsBeforeGapfill += rows.length;
    for (const r of rows) {
      if (existing.has(r.awarderEik)) {
        droppedExisting++;
        continue;
      }
      kept.push(r);
      newBuyers.add(r.awarderEik);
    }
    // Only sleep on a live fetch (cache hits are free).
    if (!args.refreshCache && args.delayMs > 0) await sleep(args.delayMs);
  }

  console.log(
    `→ ${daysPublished} published / ${daysMissing} unpublished day(s); ` +
      `${recordsSeen.toLocaleString()} record(s) → ${rowsBeforeGapfill.toLocaleString()} row(s)`,
  );
  console.log(
    `→ gap-fill: kept ${kept.length.toLocaleString()} row(s) across ` +
      `${newBuyers.size.toLocaleString()} NEW buyer(s); ` +
      `dropped ${droppedExisting.toLocaleString()} row(s) for buyers already in corpus`,
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
  console.log(
    `→ wrote ${newFiles} new + ${modifiedFiles} modified month-shard(s)`,
  );
  console.log(
    `✓ done. Now rebuild derived data:\n` +
      `    tsx scripts/procurement/ingest.ts`,
  );
};

const cli = command({
  name: "ingest_eop",
  args: {
    from: option({
      type: optional(string),
      long: "from",
      description:
        "First bucket day (YYYY-MM-DD). Default: 30 days ago (incremental). Pass --backfill --from 2020-01-01 for the full history.",
    }),
    to: option({
      type: optional(string),
      long: "to",
      description: "Last bucket day (YYYY-MM-DD). Default today.",
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
      description: "Politeness delay between live day fetches (default 150).",
    }),
  },
  handler: (args) =>
    main({
      // Default to a ~30-day incremental window so the watcher-driven run in
      // /update-procurement is cheap; the full 2020→ history is the explicit
      // `--backfill --from 2020-01-01` one-off.
      from:
        args.from ??
        new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
      to: args.to ?? new Date().toISOString().slice(0, 10),
      backfill: !!args.backfill,
      apply: !!args.apply,
      refreshCache: !!args.refreshCache,
      delayMs: args.delayMs ? parseInt(args.delayMs, 10) : 150,
    }),
});

run(cli, process.argv.slice(2));
