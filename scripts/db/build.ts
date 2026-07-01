// Phase 4a — end-to-end "generate the procurement corpus from Postgres"
// orchestrator (was SQLite; now single-engine Postgres — see
// docs/plans/postgres-migration-v1.md).
//
// Brings the Postgres container up, reloads the store from the current contracts,
// then runs every generator in dependency order. Two modes:
//   npm run db:build            → VERIFY (default): each generator compares its
//                                 output to on-disk (no writes). Proves the whole
//                                 corpus reproduces from SQL. Safe.
//   npm run db:build -- --write → FLIP: each generator writes its output from
//                                 SQL (+ orphan sweep). This regenerates
//                                 production data (shards/lists/by-id get one
//                                 canonical field order → a one-time bucket
//                                 re-sync) and drops the 34 stale amendment-only
//                                 rollups. Run this deliberately, then bucket:sync.
//
// Dependency order matters only for --write (xref writes mp/pep before derived/
// by_ns/index read them; rollups before by_ns reads awarders geo). In verify
// mode every step reads the current on-disk inputs, so order is irrelevant.
//
// See docs/plans/postgres-migration-v1.md.

import { spawnSync } from "node:child_process";

const write = process.argv.includes("--write");

// [npm script, participates in --write]. db:pg:up is idempotent; db:load:pg
// always rebuilds the Postgres store from the current month shards.
const STEPS: Array<[string, boolean]> = [
  ["db:pg:up", false],
  ["db:load:pg", false],
  ["db:gen-rollups", true],
  ["db:gen-lists", true],
  ["db:gen-shards", true],
  ["db:gen-xref", true],
  ["db:gen-derived", true],
  ["db:gen-settlement", true],
  ["db:gen-byns", true],
  ["db:gen-index", true],
];

console.log(
  `db:build — ${write ? "WRITE (flip: regenerates production data)" : "VERIFY (no writes)"}\n`,
);

const failed: string[] = [];
for (const [script, supportsWrite] of STEPS) {
  const args = [
    "run",
    script,
    ...(write && supportsWrite ? ["--", "--write"] : []),
  ];
  console.log(`\n──▶ ${script}${write && supportsWrite ? " --write" : ""}`);
  const r = spawnSync("npm", args, { stdio: "inherit" });
  if (r.status !== 0) {
    failed.push(script);
    // Keep going in verify mode to surface every drift; stop on the first
    // failure in write mode (a bad write shouldn't cascade).
    if (write) break;
  }
}

if (failed.length) {
  console.error(
    `\n✗ db:build: ${failed.length} step(s) failed: ${failed.join(", ")}`,
  );
  process.exit(1);
}
console.log(
  write
    ? "\n✓ db:build --write complete — review the diff, then `npm run db:snapshot` + `npm run bucket:sync:all`"
    : "\n✓ db:build verify complete — the entire procurement corpus reproduces from Postgres",
);
