/**
 * Thin CLI for the TR Phase 3 + 4 pipelines. Run with `npx tsx`.
 *
 *   --bulk          Stream the full ~540 MB dataset zip to raw_data/tr/.
 *                   Resume support via HTTP Range. Primary path for the
 *                   initial snapshot.
 *
 *   --index         Walk the paginated dataset listing and cache the per-day
 *                   resource UUIDs to raw_data/tr/dataset-index.json. Refresh
 *                   before each --incremental run.
 *
 *   --incremental   Read the cached index, then fetch any per-day resources
 *                   that aren't already on disk. Use after --bulk to catch up
 *                   on days published after the bulk snapshot.
 *
 *   --reconstruct   Phase 4: stream every daily filing through parser + replay
 *                   and persist the result to raw_data/tr/state.sqlite. Auto-
 *                   selects zip mode (raw_data/tr/all-resources.json.zip) or
 *                   folder mode (raw_data/tr/daily/*.json).
 *
 *   --limit N       For --incremental: cap the number of files to download.
 *                   For --reconstruct: cap the number of days to replay (smoke).
 *
 * The fetchers + reconstruct are kept out of `scripts/main.ts` because the
 * bulk download takes minutes and reconstruction takes much longer — running
 * them inline would make `npm run prod` painful.
 */

import path from "path";
import { fileURLToPath } from "url";
import { command, run, flag, option, optional, boolean, number } from "cmd-ts";
import { fetchBulkZip } from "./fetch_bulk_zip";
import { fetchDatasetIndex } from "./fetch_dataset_index";
import { fetchAllDaily } from "./fetch_daily";
import { reconstructState } from "./reconstruct_state";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rawFolder = path.resolve(__dirname, "../../../raw_data");

const app = command({
  name: "tr-fetch",
  args: {
    bulk: flag({
      type: optional(boolean),
      long: "bulk",
      defaultValue: () => false,
    }),
    index: flag({
      type: optional(boolean),
      long: "index",
      defaultValue: () => false,
    }),
    incremental: flag({
      type: optional(boolean),
      long: "incremental",
      defaultValue: () => false,
    }),
    reconstruct: flag({
      type: optional(boolean),
      long: "reconstruct",
      defaultValue: () => false,
    }),
    limit: option({ type: optional(number), long: "limit" }),
  },
  handler: async ({ bulk, index, incremental, reconstruct, limit }) => {
    if (!bulk && !index && !incremental && !reconstruct) {
      console.error(
        "tr-fetch: pass at least one of --bulk, --index, --incremental, --reconstruct",
      );
      process.exit(2);
    }

    if (bulk) {
      await fetchBulkZip({ rawFolder });
    }
    if (index || incremental) {
      const idx = await fetchDatasetIndex({ rawFolder });
      if (incremental) {
        await fetchAllDaily({
          rawFolder,
          entries: idx.entries,
          limit: limit ?? undefined,
        });
      }
    }
    if (reconstruct) {
      await reconstructState({ rawFolder, limit: limit ?? undefined });
    }
  },
});

run(app, process.argv.slice(2));
