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
import { fetchAllDaily } from "./fetch_daily";
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

// Probe one resource: GET, check status, cancel the body without downloading.
const probeOne = async (e: TrDatasetEntry): Promise<boolean> => {
  const url = `https://data.egov.bg/resource/download/${e.uuid}/json`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ac.signal,
    });
    await res.body?.cancel().catch(() => {});
    return res.status === 200;
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
      const fetched = await fetchAllDaily({
        rawFolder,
        entries: historicalMissing,
        maxRetries: 1, // keep waste low on any days still broken
      });
      console.log(
        `[tr/daily-refresh] backfill fetched ${fetched.fetched}, failed ${fetched.failed.length}`,
      );
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
