// Pure LOAD for the ДФ „Земеделие" subsidy corpus — the db:load:agri:pg half
// of the fetch/load split (gaps plan T2). Reads ONLY the raw_data/agri/ cache
// (egov year sheets + СЕУ CSVs) and publishes agri_subsidies + agri_payloads
// via the stage build + DELETE+INSERT publish / stage merge in
// scripts/agri/ingest.ts; it never touches the network. The fetch+load path stays `npm run agri:ingest` (update-agri skill).
//
//   npm run db:load:agri:pg          (local)
//   npm run db:load:agri:pg:cloud    (Cloud SQL proxy :5434)
//
// raw_data/agri/ is GITIGNORED, so on a fresh clone the cache is legitimately
// absent — skip-and-warn (the &&-chained db:refresh survives; gaps plan T1.0).
// A PRESENT but PARTIAL cache — a missing year sheet or СЕУ CSV — throws
// inside runAgriIngest instead: silently publishing a corpus without a
// financial year is the shrunken-corpus failure the guards exist for.

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runAgriIngest } from "../agri/ingest";
import { end } from "./lib/pg";

const AGRI_CACHE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
  "raw_data/agri",
);

const main = async (): Promise<void> => {
  if (!existsSync(AGRI_CACHE_DIR) || readdirSync(AGRI_CACHE_DIR).length === 0) {
    console.warn(
      `[agri] no ${AGRI_CACHE_DIR} cache — load skipped ` +
        "(fill it with `npm run agri:seu && npm run agri:ingest`).",
    );
    return;
  }
  await runAgriIngest({ offline: true });
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (e) => {
    console.error(e);
    await end();
    process.exit(1);
  });
}
