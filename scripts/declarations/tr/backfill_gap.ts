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
 * Unlike `fetchAllDaily` (cli `--incremental`), which ABORTS the entire run on
 * the first 302 outage and then makes the CLI re-download the whole bulk zip,
 * this backfill treats a 302/HTML (EgovPerResourceDownloadDownError) as a
 * PER-DAY skip — a single intermittently-broken day never strands the rest.
 *
 * Manual one-off — NOT wired into the watcher. Resume is implicit (skips files
 * already on disk). Run:
 *   npx tsx scripts/declarations/tr/backfill_gap.ts            # whole gap, default range
 *   npx tsx scripts/declarations/tr/backfill_gap.ts --from 2023-04-19 --to 2026-04-14
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  fetchDailyResource,
  warmEgovSession,
  EgovPerResourceDownloadDownError,
} from "./fetch_daily";
import type { TrDatasetEntry } from "./fetch_dataset_index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rawFolder = path.resolve(__dirname, "../../../raw_data");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const DELAY_MS = 1000; // politeness — 1 req/sec against a gov portal
const OUTAGE_RETRIES = 2; // per-day retries on a 302/HTML before skipping it
const TRANSIENT_RETRIES = 3; // per-day retries on a network/transient error

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

  // Ascending order (oldest → newest) so persistent-302 days at the old edge
  // don't strand newer days; skip-if-exists makes already-present days cheap.
  const targets = idx.entries
    .filter((e) => e.isoDate >= from && e.isoDate <= to)
    .sort((a, b) => (a.isoDate < b.isoDate ? -1 : 1));

  const dailyFolder = path.join(rawFolder, "tr", "daily");
  const onDisk = (iso: string) => {
    const p = path.join(dailyFolder, `${iso}.json`);
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  };
  const missing = targets.filter((e) => !onDisk(e.isoDate));

  console.log(
    `[tr/backfill] range ${from} → ${to}: ${targets.length} days in index, ` +
      `${targets.length - missing.length} already on disk, ${missing.length} to fetch`,
  );

  const cookie = await warmEgovSession();
  let fetched = 0;
  let bytes = 0;
  const outage: string[] = []; // days that 302'd (endpoint down for them)
  const failed: Array<{ iso: string; error: string }> = [];
  const t0 = Date.now();

  for (let i = 0; i < missing.length; i++) {
    const entry = missing[i];
    let done = false;
    let lastErr: unknown = null;
    let outageHits = 0;
    let transientHits = 0;

    while (!done) {
      try {
        const r = await fetchDailyResource(rawFolder, entry, { cookie });
        fetched++;
        bytes += r.bytes;
        done = true;
        if (fetched % 25 === 0) {
          const mins = ((Date.now() - t0) / 60000).toFixed(1);
          console.log(
            `[tr/backfill]   ${fetched}/${missing.length} fetched ` +
              `(${(bytes / 1024 / 1024).toFixed(0)} MB, ${mins}m) — last ${entry.isoDate}`,
          );
        }
        await sleep(DELAY_MS);
      } catch (err) {
        lastErr = err;
        if (err instanceof EgovPerResourceDownloadDownError) {
          outageHits++;
          if (outageHits > OUTAGE_RETRIES) {
            outage.push(entry.isoDate);
            done = true;
            break;
          }
          await sleep(3000 * outageHits); // brief backoff, then retry this day
          continue;
        }
        // network / transient
        transientHits++;
        if (transientHits > TRANSIENT_RETRIES) {
          failed.push({ iso: entry.isoDate, error: (err as Error).message });
          done = true;
          break;
        }
        await sleep(2000 * 2 ** (transientHits - 1));
      }
    }
    void lastErr;
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(
    `[tr/backfill] done in ${mins}m — fetched ${fetched} ` +
      `(${(bytes / 1024 / 1024).toFixed(0)} MB), ` +
      `outage(302)-skipped ${outage.length}, failed ${failed.length}`,
  );
  if (outage.length)
    console.log(`[tr/backfill] 302-skipped days: ${outage.join(", ")}`);
  if (failed.length)
    console.log(
      `[tr/backfill] failed days: ${failed.map((f) => `${f.iso}(${f.error})`).join("; ")}`,
    );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
