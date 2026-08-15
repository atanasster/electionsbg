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
// The guard is a post-condition rather than a dependency parse: snapshot public relations
// either side of the apply and report any that vanished. It is blind to HOW the relation
// went (CASCADE, a bare DROP, a rename) so it cannot be outgrown by a new migration.
//
// A retirement is not a defect. A vanished relation is reported only when some schema file
// still CREATEs it — so deleting a tombstoned matview's CREATE (025 / 031) retires it from
// this guard in the same edit, with no allowlist to keep in step.
// ═══════════════════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, end, allRows, DATABASE_URL } from "./lib/pg";

const SCHEMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "schema/pg",
);

/** Every relation a reader can lose: tables, views, matviews, partitioned tables. */
const relations = async (): Promise<Set<string>> =>
  new Set(
    (
      await allRows<{ relname: string }>(
        `SELECT c.relname
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind IN ('r', 'p', 'v', 'm')`,
      )
    ).map((r) => r.relname),
  );

/** Which schema file CREATEs `name`, if any still does. A relation no file creates has been
 *  retired on purpose (a tombstone DROP), and its disappearance is the intended outcome. */
const creator = (name: string): string | undefined =>
  fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .find((f) =>
      new RegExp(
        `CREATE\\s+(?:UNLOGGED\\s+)?(?:MATERIALIZED\\s+VIEW|VIEW|TABLE)\\s+` +
          `(?:IF\\s+NOT\\s+EXISTS\\s+)?${name}\\b`,
        "i",
      ).test(fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8")),
    );

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: apply_functions.ts <file.sql> [<file.sql> …]");
  process.exit(1);
}

const target = DATABASE_URL.replace(/:[^:@/]*@/, ":***@");
console.log(`applying ${files.length} file(s) to ${target}`);

const before = await relations();

for (const f of files) {
  const p = path.join(SCHEMA_DIR, f);
  if (!fs.existsSync(p)) {
    console.error(`  missing: ${p}`);
    process.exit(1);
  }
  await exec(fs.readFileSync(p, "utf8"));
  console.log(`  applied ${f}`);
}

const after = await relations();
// Collateral only: a relation the caller's own files recreate is not lost, and one no file
// creates any more was retired on purpose.
const lost = [...before]
  .filter((r) => !after.has(r))
  .map((r) => ({ rel: r, owner: creator(r) }))
  .filter((x): x is { rel: string; owner: string } => Boolean(x.owner));

await end();

if (lost.length > 0) {
  const owners = [...new Set(lost.map((l) => l.owner))].sort();
  console.error(
    `\nCOLLATERAL DROP — ${lost.length} relation(s) this apply deleted and did not recreate:`,
  );
  for (const { rel, owner } of lost)
    console.error(`  ${rel}  (created by ${owner})`);
  console.error(
    `\nA DROP … CASCADE in one of the applied files took them. They are GONE from ` +
      `${target} and every route reading them answers 500 until they are rebuilt:\n\n` +
      `  DATABASE_URL=${target} npx tsx scripts/db/apply_functions.ts ${owners.join(" ")}\n\n` +
      `Check that order against each file's dependencies before running it, and add the ` +
      `owning files to the ORIGINAL command so the next apply is whole.`,
  );
  process.exit(1);
}

console.log("done");
