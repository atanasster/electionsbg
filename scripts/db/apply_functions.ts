// Surgical DDL apply — run one or more schema/pg/*.sql files against the target
// DATABASE_URL (local by default, Cloud SQL proxy when the caller sets a
// password-less DATABASE_URL, same convention as db:dump:cloud). For
// CREATE OR REPLACE FUNCTION changes that don't need a full db:load / destructive
// db:sync:cloud — idempotent, touches only the named objects.
//
//   npx tsx scripts/db/apply_functions.ts 011_company_api.sql 023_awarder_api.sql
//   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
//     npx tsx scripts/db/apply_functions.ts 011_company_api.sql 023_awarder_api.sql
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// THE COLLATERAL-DROP GUARD, and why this file needs one.
//
// "Touches only the named objects" is the promise above and it is FALSE for any file that
// opens with `DROP … CASCADE`. Applying such a file here deletes every dependent owned by
// OTHER migrations and exits 0 — this script recreates only what the caller listed.
//
// migration_drop_dependents.data.test.ts sanctions exactly that shape for four relations,
// on the stated ground that the recreate "rides the SAME path as the drop". That premise is
// about the LOADER. This script is a second applier of every one of those files, and it
// rides no path at all.
//
// Measured 2026-08-15, which is why this exists: applying 090_person_wealth.sql alone —
// the documented hatch for a function-body fix, and the natural way to ship the two commits
// that touched 090 that week — took `person_cohort_wealth` (097), `officials_rankings_table`
// (100), `mp_assets_rankings_table` (105) and `person_browse_table` (120) with it, on the
// LOCAL database and on Cloud SQL. /persons and /officials/assets answered 500 on prod until
// somebody looked. Nothing failed, nothing logged, and no row count moved — the counts that
// would have moved belonged to relations that no longer existed.
//
// The mechanism lives in ./lib/collateral_drop.ts, because this is not the only applier of
// those files: `load_declarations_pg.ts --resolve` applies the same 090 → … → 159 chain and
// is the path CLAUDE.md tells operators to use against Cloud SQL. It had no guard at all
// until 2026-08-19, when an aborted cloud resolve left the same four relations missing. Two
// appliers of one chain must not disagree about what counts as a loss.
// ═══════════════════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, end, DATABASE_URL } from "./lib/pg";
import {
  collateralDrops,
  relationSnapshot,
  reportCollateralDrops,
} from "./lib/collateral_drop";

const SCHEMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "schema/pg",
);

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: apply_functions.ts <file.sql> [<file.sql> …]");
  process.exit(1);
}

const target = DATABASE_URL.replace(/:[^:@/]*@/, ":***@");
console.log(`applying ${files.length} file(s) to ${target}`);

const before = await relationSnapshot();

for (const f of files) {
  const p = path.join(SCHEMA_DIR, f);
  if (!fs.existsSync(p)) {
    console.error(`  missing: ${p}`);
    process.exit(1);
  }
  await exec(fs.readFileSync(p, "utf8"));
  console.log(`  applied ${f}`);
}

const lost = await collateralDrops(before);

await end();

if (reportCollateralDrops(lost, target) > 0) process.exit(1);

console.log("done");
