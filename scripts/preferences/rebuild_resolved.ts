import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { saveCandidateResolved } from "./save_candidate_resolved";

// Rebuild ONLY the per-candidate resolution shards
// (`data/<election>/candidates/<name>/resolved.json` + `by-slug/<slug>.json`)
// for every parliamentary election, without re-parsing raw CSVs or re-running
// the rest of the preferences pipeline.
//
// Why this exists: those shards precompute the CIK-candidate → parliament-MP
// match, so they depend on `data/parliament/index.json`. The full preferences
// pipeline (which writes them inline) only runs on a manual
// `npm run data -- --candidates`, but the parliament index is refreshed
// independently by the `parliament-scrape` skill. This script is the cheap,
// network-free re-match step that skill runs afterwards (the parliamentary
// analogue of `decorate_local_mp_links.ts`) so candidate pages don't show a
// stale MP photo / party group / match after the roster changes.
//
// Reads candidates.json + cik_parties.json + parliament/index.json (all on
// disk); writes are skipped where the shard is unchanged, so a no-op run is
// cheap and the diff stays minimal. ~1 s per election.
//
// Usage:
//   npx tsx scripts/preferences/rebuild_resolved.ts            # all elections
//   npx tsx scripts/preferences/rebuild_resolved.ts 2021_11_14 # one election

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataFolder = path.resolve(__dirname, "../../data");

const only = process.argv[2];
// Parliamentary election folders only — YYYY_MM_DD with no _mi/_chmi suffix.
const folders = fs
  .readdirSync(dataFolder, { withFileTypes: true })
  .filter((f) => f.isDirectory() && /^20\d\d_\d\d_\d\d$/.test(f.name))
  .map((f) => f.name)
  .filter((n) => !only || n === only)
  .sort();

const stringify = (o: object) => JSON.stringify(o);

let count = 0;
for (const year of folders) {
  if (!fs.existsSync(`${dataFolder}/${year}/candidates.json`)) continue;
  saveCandidateResolved({ publicFolder: dataFolder, year, stringify });
  count += 1;
  process.stdout.write(`\rrebuilt resolved shards: ${year}`.padEnd(60, " "));
}
process.stdout.write("\n");
console.log(`done — ${count} election(s)`);
