// One-off: restore MP declaration history from the raw XML cache.
//
// The MP ingest used to overwrite each per-MP file instead of merging, so a
// single-year run deleted every other year the MP had on file. 244 of the 245
// MPs who filed in 2025 were left with only 2025. The merge is fixed
// (scripts/lib/declaration_merge.ts), but the deleted rows do not come back on
// their own — a normal run only ever targets the newest folder.
//
// Everything needed is still on disk: raw_data/declarations/<folder>/ holds the
// source XML for every folder ever ingested. This walks those folders through
// the REAL ingest (so the rows are parsed, dated and merged exactly as a normal
// run would produce them), reading each declaration from cache. Only list.xml
// is fetched — one request per folder.
//
// Manual by design, per the repo's convention for one-off backfills: it is not
// wired into `npm run data` and takes the folders explicitly.
//
//   npx tsx scripts/declarations/backfill_from_cache.ts            # every cached folder
//   npx tsx scripts/declarations/backfill_from_cache.ts 2022 2023  # just these

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseFinancialDeclarations } from "./index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const RAW = path.join(REPO, "raw_data");
const PUBLIC = path.join(REPO, "data");

const cachedFolders = (): string[] => {
  const dir = path.join(RAW, "declarations");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
};

const main = async () => {
  const requested = process.argv.slice(2);
  const folders = requested.length > 0 ? requested : cachedFolders();
  if (folders.length === 0) {
    console.error("[backfill] no cached declaration folders under raw_data/");
    process.exit(1);
  }
  console.log(`[backfill] folders: ${folders.join(", ")}`);

  // One folder at a time. The merge is authoritative for exactly the folders a
  // run targets, so folder-at-a-time keeps each one's rows replaced cleanly and
  // leaves the others alone — and a failure part-way through has only touched
  // the folders already done.
  for (const folder of folders) {
    process.env.DECL_YEARS = folder;
    await parseFinancialDeclarations({
      publicFolder: PUBLIC,
      dataFolder: RAW,
      stringify: (o) => JSON.stringify(o, null, 0),
      // The company-index / TR / connections chain reads the finished per-MP
      // files; running it once after the last folder is both correct and far
      // cheaper than running it per folder.
      declarationsOnly: true,
    });
  }
  console.log(
    `[backfill] done — run the normal declarations pipeline once to rebuild the company index and connections graph`,
  );
};

void main();
