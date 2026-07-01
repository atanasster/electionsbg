// Phase 2d — end-to-end "generate the procurement corpus from SQL" orchestrator.
//
// Reloads the SQL store from the current contracts, then runs every generator in
// dependency order. Two modes:
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
// See docs/plans/sql-migration-v1.md (Phase 2d).

import { spawnSync } from "node:child_process";

const write = process.argv.includes("--write");

// [npm script, participates in --write]. `db:load` always rebuilds the SQLite.
const STEPS: Array<[string, boolean]> = [
  ["db:load", false],
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
    : "\n✓ db:build verify complete — the entire procurement corpus reproduces from SQL",
);
