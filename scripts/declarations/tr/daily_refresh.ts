/**
 * Daily TR (Commerce Registry) catch-up — fetch new daily filings, rebuild.
 *
 * Wired into the watcher pipeline: `process-watch-report` runs this whenever
 * the `egov_commerce` source flips (a new daily filing dropped on
 * data.egov.bg). It is the single command that keeps the TR snapshot current,
 * so it does NOT need to be run by hand.
 *
 * Each run:
 *   1. refreshes the dataset index (so the newest day's UUID is known),
 *   2. fetches EVERY index day not yet on disk via the per-resource endpoint,
 *      resiliently — a 302/HTML outage on one day is skipped, not fatal, so
 *      neither a transient blip nor the handful of permanently-302 resources
 *      (e.g. 2023-04-19, 2024-12-09, 2024-12-18) strands the rest,
 *   3. reconstructs raw_data/tr/state.sqlite from the merged daily/ + bulk
 *      sources,
 *   4. rebuilds the per-EIK company → people-in-power files.
 *
 * Steps 3 + 4 run every time (cheap, ~2 min + ~3 s) so the rebuild reflects
 * whatever was fetched plus any curated-graph change. The bucket upload is the
 * orchestrator's job (its final `bucket:sync`), not this script's.
 *
 * NOTE — the per-resource endpoint, not the bulk zip, is the only source for
 * days after 2022-09-02 (see scripts/declarations/tr/backfill_gap.ts for the
 * disjoint-halves explanation). A large historical gap is a one-time job for
 * backfill_gap.ts; this daily job only chases the moving frontier.
 *
 * Run:  npx tsx scripts/declarations/tr/daily_refresh.ts   (or `npm run tr:daily-refresh`)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  fetchDatasetIndex,
  type TrDatasetEntry,
  type DatasetIndexFile,
} from "./fetch_dataset_index";
import { fetchAllDailyResilient } from "./fetch_daily";
import { reconstructState } from "./reconstruct_state";
import { buildCompanyConnections } from "./build_company_connections";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rawFolder = path.resolve(__dirname, "../../../raw_data");
const dailyDir = path.join(rawFolder, "tr", "daily");

const isCached = (e: TrDatasetEntry): boolean => {
  const p = path.join(dailyDir, `${e.isoDate}.json`);
  return fs.existsSync(p) && fs.statSync(p).size > 0;
};

// Refresh the index so a day published since the last run is visible. Fall back
// to the cached index if the listing walk fails (network blip) so steps 3 + 4
// still run on whatever is already on disk.
const loadFreshIndex = async (): Promise<DatasetIndexFile> => {
  try {
    return await fetchDatasetIndex({ rawFolder });
  } catch (err) {
    const cached = path.join(rawFolder, "tr", "dataset-index.json");
    if (fs.existsSync(cached)) {
      console.warn(
        `[tr/daily-refresh] index refresh failed (${(err as Error).message}); ` +
          `using cached dataset-index.json`,
      );
      return JSON.parse(fs.readFileSync(cached, "utf-8")) as DatasetIndexFile;
    }
    throw err;
  }
};

const main = async (): Promise<void> => {
  const t0 = Date.now();
  console.log(`[tr/daily-refresh] start ${new Date().toISOString()}`);

  const idx = await loadFreshIndex();
  const missing = idx.entries
    .filter((e) => !isCached(e))
    .sort((a, b) => (a.isoDate < b.isoDate ? -1 : 1));

  if (missing.length === 0) {
    console.log(
      "[tr/daily-refresh] up to date — no new daily filings to fetch",
    );
  } else {
    console.log(
      `[tr/daily-refresh] ${missing.length} day(s) missing ` +
        `(${missing[0].isoDate} … ${missing[missing.length - 1].isoDate}); fetching`,
    );
    const res = await fetchAllDailyResilient({
      rawFolder,
      entries: missing,
      logPrefix: "[tr/daily-refresh]",
    });
    console.log(
      `[tr/daily-refresh] fetched ${res.fetched} ` +
        `(${(res.bytes / 1024 / 1024).toFixed(0)} MB), ` +
        `302-skipped ${res.outage.length}, failed ${res.failed.length}`,
    );
    if (res.outage.length)
      console.log(
        `[tr/daily-refresh] unreachable (302) day(s): ${res.outage.join(", ")}`,
      );
    if (res.failed.length)
      console.log(
        `[tr/daily-refresh] failed day(s): ${res.failed
          .map((f) => `${f.isoDate}(${f.error})`)
          .join("; ")}`,
      );
  }

  // Always rebuild — reflects whatever was fetched + any curated-graph change.
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
