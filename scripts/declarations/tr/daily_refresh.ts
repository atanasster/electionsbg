/**
 * Daily TR historical-backfill probe + rebuild.
 *
 * Run AFTER the watcher-driven TR refresh (`update-connections`), which owns
 * fetching the recent daily filings. This job has one extra responsibility:
 * recover the ~1,090 historical resources (2022-09 → 2026-04) that data.egov.bg
 * currently returns HTTP 500 for. Each run it:
 *
 *   1. PROBES a few missing days from the historical window (before the
 *      known-working boundary) to detect recovery,
 *   2a. if still broken → fetches nothing (the watcher already grabbed the
 *       recent days; re-storming the broken tail every morning is pointless),
 *   2b. if recovered → backfills every missing historical day in one go
 *       (one-time catch-up; cached forever after),
 *   3. reconstructs raw_data/tr/state.sqlite from the merged daily/ + bulk
 *      sources (picks up whatever the watcher fetched plus any backfill),
 *   4. rebuilds the per-EIK company → people-in-power files.
 *
 * Steps 3 + 4 run every day (cheap, ~35 s + ~3 s) so the rebuild reflects both
 * the watcher's recent fetch and any curated-graph change.
 *
 * Deliberately does NOT fetch the recent tail — that is the watcher's job, and
 * probing only the historical window avoids a recent uncached day falsely
 * signalling "recovered" and triggering a needless full re-fetch.
 *
 * Run:  npx tsx scripts/declarations/tr/daily_refresh.ts
 *   or:  npm run tr:daily-refresh
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  fetchDatasetIndex,
  type TrDatasetEntry,
  type DatasetIndexFile,
} from "./fetch_dataset_index";
import { fetchAllDaily, EgovPerResourceDownloadDownError } from "./fetch_daily";
import { reconstructState } from "./reconstruct_state";
import { buildCompanyConnections } from "./build_company_connections";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rawFolder = path.resolve(__dirname, "../../../raw_data");
const dailyDir = path.join(rawFolder, "tr", "daily");
const indexPath = path.join(rawFolder, "tr", "dataset-index.json");

// data.egov.bg's per-resource endpoint serves days on/after this date but 500s
// for everything older. Anything missing AND older than this is the broken
// "historical window" this job exists to backfill. (Empirically the boundary
// sits at 2026-04-22; a small margin keeps the probe strictly inside the
// known-broken range.)
const HISTORICAL_BOUNDARY = "2026-04-15";

// How many historical missing days to probe for recovery each run.
const PROBE_COUNT = 3;
const PROBE_TIMEOUT_MS = 30_000;
const UA = "electionsbg.com data pipeline";

const isCached = (e: TrDatasetEntry): boolean =>
  fs.existsSync(path.join(dailyDir, `${e.isoDate}.json`));

// The watcher (or a prior --index) keeps dataset-index.json fresh; reuse it so
// this job stays lean. Historical UUIDs are stable, so a slightly stale index
// is fine for the backfill purpose. Fetch only if it's missing entirely.
const loadIndex = async (): Promise<DatasetIndexFile> => {
  if (fs.existsSync(indexPath)) {
    return JSON.parse(fs.readFileSync(indexPath, "utf-8")) as DatasetIndexFile;
  }
  console.log("[tr/daily-refresh] no cached dataset-index — fetching");
  return fetchDatasetIndex({ rawFolder });
};

// Smallest body we'll treat as a real payload. Mirrors the same guard in
// fetchDailyResource — a recovered day is MBs; the broken window serves "[]".
const MIN_REAL_BYTES = 32;

// Probe one resource: GET and decide if the day has REAL content. A status
// check alone is not enough, and neither is a Content-Length check: while the
// per-resource backend is down, data.egov.bg answers
// `302 → https://data.egov.bg` and — if you follow it — the portal homepage
// returns 200 with a large HTML body whose Content-Length trivially clears
// MIN_REAL_BYTES, false-positiving "recovered" and triggering a pointless full
// backfill. So mirror fetchDailyResource's guards exactly: `redirect: "manual"`
// (any 3xx / non-200 = still down), reject a text/html content-type, and reject
// a body whose first non-space char is "<" (an HTML shell that slipped through
// with a non-html content-type). MIN_REAL_BYTES stays the final guard against
// the empty "[]" body the broken window used to serve. The still-broken case
// short-circuits at the status check, so we never download a body for it; only
// a genuinely recovered day reads its (JSON) body, once, on the recovery run.
const probeOne = async (e: TrDatasetEntry): Promise<boolean> => {
  const url = `https://data.egov.bg/resource/download/${e.uuid}/json`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      redirect: "manual",
      signal: ac.signal,
    });
    // Any redirect / non-200 means the per-resource backend is still down.
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return false;
    }
    // The portal shell comes back as text/html — never a real JSON filing.
    const ctype = res.headers.get("content-type") ?? "";
    if (/text\/html/i.test(ctype)) {
      await res.body?.cancel().catch(() => {});
      return false;
    }
    // Read the body: reject an HTML shell that slipped through with a non-html
    // content-type (first non-space char "<"); a genuinely recovered day is
    // JSON ("[" / "{"). MIN_REAL_BYTES is the final guard.
    const text = await res.text();
    if (text.trimStart().startsWith("<")) return false;
    return text.length >= MIN_REAL_BYTES;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

// Sample a few of the historical missing days (spread oldest→newest) and return
// true if any now responds 200.
const probeRecovered = async (
  historicalMissing: TrDatasetEntry[],
): Promise<boolean> => {
  const picks: TrDatasetEntry[] = [];
  for (let i = 0; i < PROBE_COUNT; i++) {
    const idx = Math.floor(
      (i / Math.max(1, PROBE_COUNT - 1)) * (historicalMissing.length - 1),
    );
    const e = historicalMissing[idx];
    if (e && !picks.includes(e)) picks.push(e);
  }
  for (const e of picks) {
    const ok = await probeOne(e);
    console.log(
      `[tr/daily-refresh]   probe ${e.isoDate}: ${ok ? "200 OK" : "still failing"}`,
    );
    if (ok) return true;
  }
  return false;
};

const main = async (): Promise<void> => {
  const t0 = Date.now();
  console.log(`[tr/daily-refresh] start ${new Date().toISOString()}`);

  const idx = await loadIndex();

  // The empty historical window = missing days older than the working boundary.
  const historicalMissing = idx.entries
    .filter((e) => e.isoDate < HISTORICAL_BOUNDARY && !isCached(e))
    .sort((a, b) => (a.isoDate < b.isoDate ? -1 : 1));

  if (historicalMissing.length === 0) {
    console.log(
      "[tr/daily-refresh] historical window fully cached — nothing to backfill",
    );
  } else {
    console.log(
      `[tr/daily-refresh] ${historicalMissing.length} historical day(s) missing ` +
        `(${historicalMissing[0].isoDate} … ${historicalMissing[historicalMissing.length - 1].isoDate}); probing`,
    );
    const recovered = await probeRecovered(historicalMissing);
    if (recovered) {
      console.log(
        `[tr/daily-refresh] historical window RECOVERED — backfilling ${historicalMissing.length} day(s)`,
      );
      try {
        const fetched = await fetchAllDaily({
          rawFolder,
          entries: historicalMissing,
          maxRetries: 1, // keep waste low on any days still broken
        });
        console.log(
          `[tr/daily-refresh] backfill fetched ${fetched.fetched}, failed ${fetched.failed.length}`,
        );
      } catch (err) {
        // PARTIAL recovery: the probe saw the oldest historical day serving,
        // but the per-resource backend flipped back to its 302→HTML-shell
        // outage partway through the backfill. fetchAllDaily persists every
        // day it fetched before re-throwing on the first dead resource, so we
        // KEEP that progress and still fall through to reconstruct + rebuild
        // below — a mid-backfill outage must never wedge the daily rebuild
        // (which is this job's everyday responsibility). The next run resumes
        // from the first still-missing day (cached days are skipped). Re-throw
        // anything that isn't the known per-resource outage.
        if (!(err instanceof EgovPerResourceDownloadDownError)) throw err;
        console.warn(
          `[tr/daily-refresh] per-resource backend flipped back to down ` +
            `mid-backfill — keeping the days already fetched and proceeding ` +
            `to reconstruct. (${(err as Error).message})`,
        );
      }
    } else {
      console.log(
        "[tr/daily-refresh] historical window still broken — skipping fetch",
      );
    }
  }

  // Always rebuild — reflects the watcher's recent fetch + any backfill + any
  // curated-graph change. Both steps are cheap.
  const recon = await reconstructState({ rawFolder });
  console.log(
    `[tr/daily-refresh] reconstructed ${recon.companies.toLocaleString()} companies, ` +
      `${recon.persons.toLocaleString()} person rows`,
  );
  buildCompanyConnections();

  console.log(
    `[tr/daily-refresh] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
};

main().catch((err) => {
  console.error(`[tr/daily-refresh] FAILED: ${(err as Error).message}`);
  process.exit(1);
});
