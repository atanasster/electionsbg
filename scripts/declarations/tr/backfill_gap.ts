/**
 * One-off historical backfill for the TR daily-archive gap.
 *
 * WHY THIS EXISTS — data.egov.bg serves this dataset's daily resources in two
 * disjoint halves:
 *   - 2021-01-01 → 2022-09-02 : ONLY inside the bulk zip (fetch_bulk_zip.ts)
 *   - 2022-09-03 → present     : ONLY via the per-resource endpoint (fetch_daily.ts)
 * So the bulk zip CANNOT fill the 2023-04-19 → 2026-04-14 daily gap — the
 * per-resource endpoint is the only source for those days. (The reconstruct
 * comment "a fresh bulk zip covers 2022-09 onward" is stale/inverted.)
 *
 * This is the manual, range-scoped twin of the daily catch-up: both fetch
 * resiliently via `fetchAllDailyResilient` (a 302/HTML outage is a per-day
 * skip, never a whole-run abort), but the daily job (daily_refresh.ts, wired
 * into the watcher) chases the moving frontier, while this fills an arbitrary
 * historical range on demand. NOT wired into the watcher; resume is implicit
 * (skip-if-exists). Run:
 *   npx tsx scripts/declarations/tr/backfill_gap.ts            # default gap
 *   npx tsx scripts/declarations/tr/backfill_gap.ts --from 2023-04-19 --to 2026-04-14
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchAllDailyResilient } from "./fetch_daily";
import type { TrDatasetEntry } from "./fetch_dataset_index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rawFolder = path.resolve(__dirname, "../../../raw_data");

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const from = arg("from") ?? "2023-04-19";
  const to = arg("to") ?? "2026-04-14";

  const indexPath = path.join(rawFolder, "tr", "dataset-index.json");
  if (!fs.existsSync(indexPath)) {
    console.error(
      `[tr/backfill] no dataset-index.json — run \`cli.ts --index\` first.`,
    );
    process.exit(2);
  }
  const idx = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as {
    entries: TrDatasetEntry[];
  };
  const dailyFolder = path.join(rawFolder, "tr", "daily");
  const onDisk = (iso: string) => {
    const p = path.join(dailyFolder, `${iso}.json`);
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  };

  // Ascending so persistent-302 days at the old edge don't strand newer days.
  const targets = idx.entries
    .filter((e) => e.isoDate >= from && e.isoDate <= to)
    .sort((a, b) => (a.isoDate < b.isoDate ? -1 : 1));
  const missing = targets.filter((e) => !onDisk(e.isoDate));

  console.log(
    `[tr/backfill] range ${from} → ${to}: ${targets.length} days in index, ` +
      `${targets.length - missing.length} already on disk, ${missing.length} to fetch`,
  );

  const t0 = Date.now();
  const res = await fetchAllDailyResilient({
    rawFolder,
    entries: missing,
    logPrefix: "[tr/backfill]",
  });
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(
    `[tr/backfill] done in ${mins}m — fetched ${res.fetched} ` +
      `(${(res.bytes / 1024 / 1024).toFixed(0)} MB), ` +
      `outage(302)-skipped ${res.outage.length}, failed ${res.failed.length}`,
  );
  if (res.outage.length)
    console.log(`[tr/backfill] 302-skipped days: ${res.outage.join(", ")}`);
  if (res.failed.length)
    console.log(
      `[tr/backfill] failed days: ${res.failed
        .map((f) => `${f.isoDate}(${f.error})`)
        .join("; ")}`,
    );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
