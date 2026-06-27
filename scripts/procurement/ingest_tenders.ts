// Tender-stage procurement ingest — the PROCEDURE counterpart to ingest.ts
// (signed contracts). Pulls the ЦАИС ЕОП flat "поръчки" (tenders) open-data feed
// from storage.eop.bg, normalizes each procedure (УНП) into a Tender record with
// nested lots + a QUARANTINED estimated value, and writes a parallel tenders/
// shard tree that never touches the contracted-spend aggregates.
//
// Why a separate tree (see docs/plans/procurement-tenders-ingest-v1.md):
//   - estimated (прогнозна) value is a FORECAST, not money spent — it must never
//     be summed into contracted totals (the "поскъпна 4 пъти" / legacy "-x" trap);
//   - tenders have no contractor and a different lifecycle (active → cancelled /
//     contracted);
//   - lineage back to a signed contract is free: ocid = ocds-e82gsb-<tenderId>.
//
// The storage.eop.bg tenders feed is NOT behind the data.egov.bg 403 (verified),
// so the backfill runs from any egress. Two modes (mirrors ingest_eop.ts):
//   - INCREMENTAL (default): last ~30 tender days into the cache.
//   - BACKFILL (one-off, flag-gated): full 2020→ history. Operator-run, never CI.
// The tenders tree is ALWAYS rebuilt from ALL cached days, so one --backfill makes
// it complete; later incremental runs just refresh recent days.
//
//   tsx scripts/procurement/ingest_tenders.ts --apply                              # incremental
//   tsx scripts/procurement/ingest_tenders.ts --backfill --from 2020-01-01 --apply # full history
//   tsx scripts/procurement/ingest_tenders.ts --apply --upload                     # + bucket sync

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import { buildTenders, type Tender } from "./normalize_eop_tender";
import { tendersDayUrl, type EopTenderRecord } from "./eop_tender_types";
import { canonicalJson } from "./validate";
import { uploadTextTree } from "../lib/upload";
import type { TenderSearchRow } from "@/lib/tenderTopics";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sentinel for the corpus-collapse guard, so the catch can tell "the corpus
// collapsed, abort" apart from "the previous index was unreadable, proceed"
// without matching on the error message text.
class CollapseError extends Error {}

const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const TENDERS_DIR = path.join(PROCUREMENT_DIR, "tenders");
const SHARD_DIR = path.join(TENDERS_DIR, "by-tender", "shard");
const INDEX_FILE = path.join(TENDERS_DIR, "index.json");
const CACHE_DIR = path.resolve(
  __dirname,
  "../../raw_data/procurement/eop_tenders",
);

// 2 hex chars → 256 shards. УНП is sha256-hashed for a uniform spread (raw УНП
// prefixes are the buyer code → wildly uneven). Mirrors by_id_shards.ts.
const SHARD_PREFIX_LEN = 2;
const shardOf = (unp: string): string =>
  createHash("sha256").update(unp).digest("hex").slice(0, SHARD_PREFIX_LEN);

// ---- fetch / cache (shared cache dir with build_tender_oblast_map.ts) --------
// The day-bucket URL builder is shared with the normalizer (see eop_tender_types).
const dayUrl = tendersDayUrl;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const enumerateDays = (from: string, to: string): string[] => {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = start; t <= end; t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

// Fetch one day, caching gzipped. Empty days (403/404 = not published) are cached
// as [] so a re-run doesn't re-probe them. Returns the records, or null on error.
const fetchDay = async (
  day: string,
  refresh: boolean,
): Promise<EopTenderRecord[] | null> => {
  const cacheFile = path.join(CACHE_DIR, `${day}.json.gz`);
  if (!refresh && fs.existsSync(cacheFile)) {
    return JSON.parse(
      zlib.gunzipSync(fs.readFileSync(cacheFile)).toString("utf8"),
    ) as EopTenderRecord[];
  }
  const url = dayUrl(day);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "electionsbg.com data pipeline (procurement/eop-tenders)",
      Accept: "application/json",
    },
  });
  if (res.status === 404) {
    // 404 = genuinely not published that day — cache [] so re-runs don't re-probe.
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, zlib.gzipSync(JSON.stringify([])));
    return [];
  }
  // 403 = egress/IP block (outside-BG / Starlink / VPN), NOT "no data" — do NOT
  // cache it as empty, or a later run from a good IP serves the poisoned empty
  // day (the existsSync short-circuit never re-fetches). Return null so the day
  // stays uncached and is re-fetched. See reference_egov_api_endpoints; the
  // sibling ingest_eop.ts does the same.
  if (res.status === 403) return null;
  if (!res.ok) throw new Error(`GET ${day} → ${res.status} ${res.statusText}`);
  if (new URL(res.url || url).host !== new URL(url).host)
    throw new Error(`refusing cross-host redirect for ${day}: ${res.url}`);
  const body = await res.json();
  const records: EopTenderRecord[] = Array.isArray(body)
    ? (body as EopTenderRecord[])
    : ((body as { data?: EopTenderRecord[] })?.data ?? []);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, zlib.gzipSync(JSON.stringify(records)));
  return records;
};

// ---- index / slim row --------------------------------------------------------

interface SlimTender {
  unp: string;
  ocid?: string;
  publicationDate: string;
  buyerEik: string;
  buyerName: string;
  subject: string;
  estimatedValueEur?: number;
  currency?: string;
  lotsCount?: number;
  isCancelled: boolean;
  nuts?: string;
}

const slim = (t: Tender): SlimTender => ({
  unp: t.unp,
  ocid: t.ocid,
  publicationDate: t.publicationDate,
  buyerEik: t.buyerEik,
  buyerName: t.buyerName,
  subject: t.subject,
  estimatedValueEur: t.estimatedValueEur,
  currency: t.currency,
  lotsCount: t.lotsCount,
  isCancelled: t.isCancelled,
  nuts: t.nuts,
});

interface TendersIndex {
  generatedAt: string;
  source: string;
  /** Loud reminder for any consumer: these values are FORECASTS. */
  valueSemantics: string;
  coverage: { firstDay: string; lastDay: string; months: string[] };
  totals: {
    procedures: number;
    lots: number;
    cancelled: number;
    withEstimate: number;
    /** QUARANTINED — sum of estimated (forecast) value, NOT contracted spend. */
    estimatedValueEur: number;
  };
  byYear: Array<{
    year: string;
    procedures: number;
    cancelled: number;
    estimatedValueEur: number;
  }>;
  byProcedureType: Array<{
    type: string;
    procedures: number;
    estimatedValueEur: number;
  }>;
  /** Largest procedures by estimated value — drives the "biggest tenders"
   *  surface. Forecast values, clearly labeled. */
  topByValue: SlimTender[];
  /** Per-buyer counts so /awarder/:eik can show "N open/total procedures". */
  buyers: Array<{
    eik: string;
    name: string;
    procedures: number;
    cancelled: number;
    estimatedValueEur: number;
  }>;
}

// ---- writers -----------------------------------------------------------------

const writeMonthShards = (tenders: Tender[]): { files: number } => {
  fs.mkdirSync(TENDERS_DIR, { recursive: true });
  const byMonth = new Map<string, Tender[]>();
  for (const t of tenders) {
    const month = t.publicationDate.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const arr = byMonth.get(month) ?? [];
    arr.push(t);
    byMonth.set(month, arr);
  }
  let files = 0;
  for (const [month, rows] of byMonth) {
    const year = month.slice(0, 4);
    const dir = path.join(TENDERS_DIR, year);
    fs.mkdirSync(dir, { recursive: true });
    rows.sort((a, b) => a.unp.localeCompare(b.unp));
    fs.writeFileSync(path.join(dir, `${month}.json`), canonicalJson(rows));
    files++;
  }
  return { files };
};

const writeTenderShards = (tenders: Tender[]): { shards: number } => {
  // Rebuild from scratch so removed procedures don't linger.
  fs.rmSync(SHARD_DIR, { recursive: true, force: true });
  fs.mkdirSync(SHARD_DIR, { recursive: true });
  const buckets = new Map<string, Record<string, Tender>>();
  for (const t of tenders) {
    const prefix = shardOf(t.unp);
    let bucket = buckets.get(prefix);
    if (!bucket) {
      bucket = {};
      buckets.set(prefix, bucket);
    }
    bucket[t.unp] = t;
  }
  for (const [prefix, bucket] of buckets) {
    fs.writeFileSync(
      path.join(SHARD_DIR, `${prefix}.json`),
      JSON.stringify(bucket),
    );
  }
  return { shards: buckets.size };
};

// Contract → tender lineage. A signed contract already carries the procedure's
// ocid (ocds-e82gsb-<tenderId>); this lets /contract/:key resolve "the procedure
// this came from" with ONE small fetch, WITHOUT mutating the 679 MB contracts
// tree. We store a compact lineage record keyed by ocid (subject, estimated
// value, lots, status) — enough for the lineage tile without a second hop to the
// by-tender shard. Sharded by the last 2 digits of the numeric tenderId so the
// client derives the shard from the contract's ocid with no hashing.
interface TenderLineage {
  unp: string;
  ocid: string;
  publicationDate: string;
  buyerEik: string;
  buyerName: string;
  subject: string;
  procedureType?: string;
  estimatedValueNative?: number;
  currency?: string;
  estimatedValueEur?: number;
  lotsCount?: number;
  isCancelled: boolean;
  linkToOjEu?: string;
  lots: Array<{ name?: string; estimatedValueEur?: number }>;
}

// shard = last 2 chars of the ocid (its tenderId is numeric, so this is 2
// digits → 100 buckets). The client computes the same from contract.ocid.
export const ocidShardKey = (ocid: string): string => ocid.slice(-2);

const writeOcidLookup = (tenders: Tender[]): { shards: number } => {
  const ocidDir = path.join(TENDERS_DIR, "by-ocid", "shard");
  fs.rmSync(ocidDir, { recursive: true, force: true });
  fs.mkdirSync(ocidDir, { recursive: true });
  const buckets = new Map<string, Record<string, TenderLineage>>();
  for (const t of tenders) {
    if (!t.ocid) continue;
    const prefix = ocidShardKey(t.ocid);
    let bucket = buckets.get(prefix);
    if (!bucket) {
      bucket = {};
      buckets.set(prefix, bucket);
    }
    bucket[t.ocid] = {
      unp: t.unp,
      ocid: t.ocid,
      publicationDate: t.publicationDate,
      buyerEik: t.buyerEik,
      buyerName: t.buyerName,
      subject: t.subject,
      procedureType: t.procedureType,
      estimatedValueNative: t.estimatedValueNative,
      currency: t.currency,
      estimatedValueEur: t.estimatedValueEur,
      lotsCount: t.lotsCount,
      isCancelled: t.isCancelled,
      linkToOjEu: t.linkToOjEu,
      lots: t.lots.map((l) => ({
        name: l.name,
        estimatedValueEur: l.estimatedValueEur,
      })),
    };
  }
  for (const [prefix, bucket] of buckets) {
    fs.writeFileSync(
      path.join(ocidDir, `${prefix}.json`),
      JSON.stringify(bucket),
    );
  }
  return { shards: buckets.size };
};

// Per-year search shards — the full corpus, slim, for keyword / topic / year
// search on the FE (/procurement/tenders?q=…&year=…) and the openTenders AI
// tool. One file per publication year (~3-4 MB, lazy-loaded only on a search),
// mirroring the contracts faceted-browser's contract_index/<year>.json pattern.
const writeYearSearch = (tenders: Tender[]): { files: number } => {
  const dir = path.join(TENDERS_DIR, "by_year");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const byYear = new Map<string, TenderSearchRow[]>();
  for (const t of tenders) {
    const year = t.publicationDate.slice(0, 4);
    if (!/^\d{4}$/.test(year)) continue;
    const arr = byYear.get(year) ?? [];
    arr.push({
      unp: t.unp,
      ocid: t.ocid,
      date: t.publicationDate,
      buyerEik: t.buyerEik,
      buyerName: t.buyerName,
      subject: t.subject,
      cpv: t.cpv,
      cpvDesc: t.cpvDesc,
      estimatedValueEur: t.estimatedValueEur,
      currency: t.currency,
      lotsCount: t.lotsCount,
      isCancelled: t.isCancelled,
      nuts: t.nuts,
    });
    byYear.set(year, arr);
  }
  let files = 0;
  for (const [year, rows] of byYear) {
    // Biggest first so a truncated client render still shows the headline ones.
    rows.sort(
      (a, b) => (b.estimatedValueEur ?? 0) - (a.estimatedValueEur ?? 0),
    );
    fs.writeFileSync(path.join(dir, `${year}.json`), JSON.stringify(rows));
    files++;
  }
  return { files };
};

// Recent tenders per buyer EIK — the join source for the my-area "Recent
// activity" alerts (scripts/myarea/build_alerts.ts pins a município's
// municipal-tier awarders to it, then surfaces their freshly-announced
// procedures). Last ~180 days from the freshest data, capped per buyer; slim.
const RECENT_ALERT_DAYS = 180;
const RECENT_PER_BUYER = 6;
interface RecentTender {
  unp: string;
  subject: string;
  estimatedValueEur?: number;
  currency?: string;
  publicationDate: string;
  lotsCount?: number;
  isCancelled: boolean;
}
const writeRecentByBuyer = (tenders: Tender[]): { buyers: number } => {
  let maxDay = "";
  for (const t of tenders)
    if (t.publicationDate > maxDay) maxDay = t.publicationDate;
  const since = maxDay
    ? new Date(
        Date.parse(`${maxDay}T00:00:00Z`) - RECENT_ALERT_DAYS * 86_400_000,
      )
        .toISOString()
        .slice(0, 10)
    : "";
  const byBuyer = new Map<string, RecentTender[]>();
  for (const t of tenders) {
    if (since && t.publicationDate < since) continue;
    const arr = byBuyer.get(t.buyerEik) ?? [];
    arr.push({
      unp: t.unp,
      subject: t.subject,
      estimatedValueEur: t.estimatedValueEur,
      currency: t.currency,
      publicationDate: t.publicationDate,
      lotsCount: t.lotsCount,
      isCancelled: t.isCancelled,
    });
    byBuyer.set(t.buyerEik, arr);
  }
  const buyers: Record<string, RecentTender[]> = {};
  for (const [eik, arr] of byBuyer)
    buyers[eik] = arr
      .sort((a, b) => b.publicationDate.localeCompare(a.publicationDate))
      .slice(0, RECENT_PER_BUYER);
  fs.writeFileSync(
    path.join(TENDERS_DIR, "recent_by_buyer.json"),
    canonicalJson({ generatedAt: new Date().toISOString(), since, buyers }),
  );
  return { buyers: Object.keys(buyers).length };
};

const buildIndex = (tenders: Tender[], months: string[]): TendersIndex => {
  const byYear = new Map<
    string,
    { procedures: number; cancelled: number; estimatedValueEur: number }
  >();
  const byType = new Map<
    string,
    { procedures: number; estimatedValueEur: number }
  >();
  const byBuyer = new Map<
    string,
    {
      name: string;
      procedures: number;
      cancelled: number;
      estimatedValueEur: number;
    }
  >();
  let lots = 0;
  let cancelled = 0;
  let withEstimate = 0;
  let estimatedValueEur = 0;
  let firstDay = "9999-99-99";
  let lastDay = "0000-00-00";

  for (const t of tenders) {
    const year = t.publicationDate.slice(0, 4);
    const eur = t.estimatedValueEur ?? 0;
    lots += t.lots.length;
    if (t.isCancelled) cancelled++;
    if (t.estimatedValueEur != null) withEstimate++;
    estimatedValueEur += eur;
    if (t.sourceDay < firstDay) firstDay = t.sourceDay;
    if (t.sourceDay > lastDay) lastDay = t.sourceDay;

    const y = byYear.get(year) ?? {
      procedures: 0,
      cancelled: 0,
      estimatedValueEur: 0,
    };
    y.procedures++;
    if (t.isCancelled) y.cancelled++;
    y.estimatedValueEur += eur;
    byYear.set(year, y);

    const typeKey = t.procedureType ?? "(не е посочен)";
    const ty = byType.get(typeKey) ?? { procedures: 0, estimatedValueEur: 0 };
    ty.procedures++;
    ty.estimatedValueEur += eur;
    byType.set(typeKey, ty);

    const b = byBuyer.get(t.buyerEik) ?? {
      name: t.buyerName,
      procedures: 0,
      cancelled: 0,
      estimatedValueEur: 0,
    };
    b.procedures++;
    if (t.isCancelled) b.cancelled++;
    b.estimatedValueEur += eur;
    byBuyer.set(t.buyerEik, b);
  }

  const topByValue = tenders
    .filter((t) => t.estimatedValueEur != null)
    .sort((a, b) => (b.estimatedValueEur ?? 0) - (a.estimatedValueEur ?? 0))
    .slice(0, 250)
    .map(slim);

  // Cap the buyers list to the top 1000 by procedure count — the long tail is
  // one-off authorities and would bloat the index.
  const buyers = [...byBuyer.entries()]
    .map(([eik, v]) => ({ eik, ...v }))
    .sort((a, b) => b.procedures - a.procedures)
    .slice(0, 1000);

  return {
    generatedAt: new Date().toISOString(),
    source: "ЦАИС ЕОП (storage.eop.bg) — open-data поръчки feed",
    valueSemantics:
      "estimatedValueEur is a FORECAST (прогнозна стойност), not contracted spend. Never sum it into contracted totals.",
    coverage: {
      firstDay: firstDay === "9999-99-99" ? "" : firstDay,
      lastDay: lastDay === "0000-00-00" ? "" : lastDay,
      months,
    },
    totals: {
      procedures: tenders.length,
      lots,
      cancelled,
      withEstimate,
      estimatedValueEur,
    },
    byYear: [...byYear.entries()]
      .map(([year, v]) => ({ year, ...v }))
      .sort((a, b) => a.year.localeCompare(b.year)),
    byProcedureType: [...byType.entries()]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.procedures - a.procedures),
    topByValue,
    buyers,
  };
};

// ---- main --------------------------------------------------------------------

const collectCachedRecords = (): {
  dated: { day: string; rec: EopTenderRecord }[];
  cachedDays: number;
  months: Set<string>;
} => {
  const dated: { day: string; rec: EopTenderRecord }[] = [];
  const months = new Set<string>();
  let cachedDays = 0;
  if (!fs.existsSync(CACHE_DIR)) return { dated, cachedDays, months };
  for (const f of fs.readdirSync(CACHE_DIR).sort()) {
    if (!f.endsWith(".json.gz")) continue;
    cachedDays++;
    const day = f.replace(".json.gz", "");
    // A partially-written .json.gz (process killed mid-write) must not abort the
    // whole rebuild — skip the one bad day and keep every other (mirrors
    // build_alerts.ts::readJson swallowing parse errors).
    let recs: EopTenderRecord[];
    try {
      recs = JSON.parse(
        zlib
          .gunzipSync(fs.readFileSync(path.join(CACHE_DIR, f)))
          .toString("utf8"),
      ) as EopTenderRecord[];
    } catch (e) {
      console.log(`  ! skipping corrupt cache ${f}: ${(e as Error).message}`);
      continue;
    }
    if (recs.length > 0) months.add(day.slice(0, 7));
    for (const rec of recs) dated.push({ day, rec });
  }
  return { dated, cachedDays, months };
};

const main = async (args: {
  from: string;
  to: string;
  backfill: boolean;
  refreshCache: boolean;
  apply: boolean;
  upload: boolean;
  force: boolean;
  delayMs: number;
}): Promise<void> => {
  // 1. Fetch the requested window into the cache.
  const days = enumerateDays(args.from, args.to);
  if (days.length > 45 && !args.backfill)
    throw new Error(
      `window is ${days.length} days — pass --backfill to confirm a large crawl`,
    );
  let published = 0;
  let missing = 0;
  for (const day of days) {
    try {
      const recs = await fetchDay(day, args.refreshCache);
      if (recs && recs.length > 0) published++;
      else missing++;
    } catch (e) {
      console.log(`  ! ${day}: ${(e as Error).message}`);
      continue;
    }
    if (args.delayMs > 0) await sleep(args.delayMs);
  }
  console.log(
    `→ fetch window ${args.from}…${args.to}: ${published} with records / ${missing} empty day(s)`,
  );

  // 2. Rebuild the whole tenders tree from ALL cached days.
  const { dated, cachedDays, months } = collectCachedRecords();
  console.log(
    `→ normalizing ${dated.length.toLocaleString()} record(s) from ${cachedDays} cached day(s)`,
  );
  const { tenders, stats } = buildTenders(dated);
  console.log(
    `  ${stats.proceduresEmitted.toLocaleString()} procedure(s), ` +
      `${stats.lotsEmitted.toLocaleString()} lot(s), ` +
      `${stats.cancelled.toLocaleString()} cancelled, ` +
      `${stats.proceduresFromLot.toLocaleString()} estimate-from-lots ` +
      `(skipped: ${stats.recordsSkippedNoUnp} no-УНП, ${stats.recordsSkippedNoBuyerEik} no-EIK)`,
  );

  if (!args.apply) {
    const withEst = tenders.filter((t) => t.estimatedValueEur != null).length;
    console.log(
      `✓ dry run (pass --apply to write): ${tenders.length.toLocaleString()} tender(s), ` +
        `${withEst.toLocaleString()} with an estimate (${((100 * withEst) / (tenders.length || 1)).toFixed(1)}%)`,
    );
    return;
  }

  // Sanity floor before the destructive tree write (writeTenderShards rm -rf's
  // the shard dirs). A normalize regression or a mass-403 cache (now returns
  // null, but defence-in-depth) could collapse the corpus — refuse to publish a
  // catastrophic drop vs the previously-published count. Override with --force.
  if (fs.existsSync(INDEX_FILE) && !args.force) {
    try {
      const prev = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")) as {
        totals?: { procedures?: number };
      };
      const prevCount = prev.totals?.procedures ?? 0;
      if (prevCount > 1000 && tenders.length < prevCount * 0.5) {
        throw new CollapseError(
          `tender count collapsed ${prevCount.toLocaleString()} → ${tenders.length.toLocaleString()} ` +
            `(<50%). Refusing to overwrite the published tree. Re-run with --force if intentional.`,
        );
      }
    } catch (e) {
      if (e instanceof CollapseError) throw e;
      // unreadable/legacy index → no baseline to compare; proceed.
    }
  }

  // 3. Write the month shards + per-tender hash shards + index.
  const { files } = writeMonthShards(tenders);
  const { shards } = writeTenderShards(tenders);
  const { shards: ocidShards } = writeOcidLookup(tenders);
  const { files: yearFiles } = writeYearSearch(tenders);
  const { buyers: recentBuyers } = writeRecentByBuyer(tenders);
  const index = buildIndex(tenders, [...months].sort());
  fs.mkdirSync(TENDERS_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, canonicalJson(index));
  console.log(
    `→ wrote ${files} month-shard(s), ${shards} by-tender shard(s), ` +
      `${ocidShards} by-ocid lineage shard(s), ${yearFiles} by-year search shard(s), ` +
      `recent_by_buyer.json (${recentBuyers} buyers), index.json`,
  );
  console.log(
    `  index totals: ${index.totals.procedures.toLocaleString()} procedures, ` +
      `${index.totals.cancelled.toLocaleString()} cancelled, ` +
      `forecast Σ €${(index.totals.estimatedValueEur / 1e9).toFixed(1)}bn (quarantined)`,
  );

  // 4. Optional bucket sync.
  if (args.upload) {
    console.log(`→ uploading data/procurement/tenders/ to bucket`);
    await uploadTextTree(TENDERS_DIR, "procurement/tenders");
    console.log(`✓ uploaded`);
  }
};

const cli = command({
  name: "ingest_tenders",
  args: {
    from: option({
      type: optional(string),
      long: "from",
      description: "First tender day (YYYY-MM-DD). Default: 30 days ago.",
    }),
    to: option({
      type: optional(string),
      long: "to",
      description: "Last tender day (YYYY-MM-DD). Default: today.",
    }),
    backfill: flag({
      type: optional(boolean),
      long: "backfill",
      description: "Confirm a large (>45-day) crawl window (one-off history).",
      defaultValue: () => false,
    }),
    refreshCache: flag({
      type: optional(boolean),
      long: "refresh-cache",
      description: "Re-download cached days.",
      defaultValue: () => false,
    }),
    apply: flag({
      type: optional(boolean),
      long: "apply",
      description: "Write the tenders/ tree (omit for a dry run).",
      defaultValue: () => false,
    }),
    upload: flag({
      type: optional(boolean),
      long: "upload",
      description: "rsync data/procurement/tenders/ to the GCS bucket.",
      defaultValue: () => false,
    }),
    force: flag({
      type: optional(boolean),
      long: "force",
      description: "Bypass the count-collapse sanity floor before --apply.",
      defaultValue: () => false,
    }),
    delayMs: option({
      type: optional(string),
      long: "delay-ms",
      description: "Politeness delay between live day fetches (default 120).",
    }),
  },
  handler: (args) => {
    // Validate the delay: an unparseable --delay-ms must fall back to the
    // default, not silently disable politeness (NaN > 0 is false).
    const parsedDelay = args.delayMs ? parseInt(args.delayMs, 10) : 120;
    return main({
      from:
        args.from ??
        new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
      to: args.to ?? new Date().toISOString().slice(0, 10),
      backfill: !!args.backfill,
      refreshCache: !!args.refreshCache,
      apply: !!args.apply,
      upload: !!args.upload,
      force: !!args.force,
      delayMs: Number.isFinite(parsedDelay) ? parsedDelay : 120,
    });
  },
});

run(cli, process.argv.slice(2));
