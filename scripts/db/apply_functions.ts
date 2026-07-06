// Surgical DDL apply — run one or more schema/pg/*.sql files against the target
// DATABASE_URL (local by default, Cloud SQL proxy when the caller sets a
// password-less DATABASE_URL, same convention as db:push:cloud). For
// CREATE OR REPLACE FUNCTION changes that don't need a full db:load / destructive
// db:sync:cloud — idempotent, touches only the named objects.
//
//   npx tsx scripts/db/apply_functions.ts 011_company_api.sql 023_awarder_api.sql
//   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
//     npx tsx scripts/db/apply_functions.ts 011_company_api.sql 023_awarder_api.sql

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, end, DATABASE_URL } from "./lib/pg";

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

for (const f of files) {
  const p = path.join(SCHEMA_DIR, f);
  if (!fs.existsSync(p)) {
    console.error(`  missing: ${p}`);
    process.exit(1);
  }
  await exec(fs.readFileSync(p, "utf8"));
  console.log(`  applied ${f}`);
}

await end();
console.log("done");
