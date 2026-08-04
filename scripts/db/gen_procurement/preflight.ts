// Skip-and-warn preflight for the two PG-sourced generators that WRITE a
// committed artifact — hub_stats.ts and sector_stats.ts.
//
// Those two are the odd ones out in gen_procurement/. The other seven entries
// (rollups, contract_lists, month_shards, derived, cross_reference, index,
// by_ns) are sql-migration-v1 PARITY VERIFIERS: they re-derive the JSON pipeline
// from Postgres, compare, and write nothing unless `--write` is passed. These
// two have no JSON-pipeline counterpart — they are genuine generators whose
// output (data/procurement/derived/{hub,sector}_stats.json) is committed and
// bucket-synced — so they belong in `db:refresh`, and once there they inherit
// the chain's fresh-clone contract:
//
//   a loader in the &&-chained db:refresh must SKIP AND WARN on a missing
//   dependency, never abort the chain (refresh_coverage.ts, gaps plan T1.0).
//
// Both previously did the opposite — any missing relation, function or
// gitignored input surfaced as a thrown query and `process.exit(1)`.
//
// The second half of the contract is quieter and matters just as much: a skip
// must leave the COMMITTED artifact untouched. Writing a partial one (all-zero
// counts from an empty corpus, or a sector_stats.json missing the eight
// budget-basis sectors whose source tree is gitignored) would overwrite a good
// served file with a worse one and reconcile against nothing — strictly worse
// than not running. Hence `skip()` returns to the caller BEFORE any write rather
// than degrading the payload.

import fs from "node:fs";
import path from "node:path";
import { allRows } from "../lib/pg";

/** Relations (tables / matviews) absent from the connected database. */
export const missingRelations = async (names: string[]): Promise<string[]> => {
  const rows = (await allRows(
    `SELECT n AS name, to_regclass('public.' || n) IS NOT NULL AS present
       FROM unnest($1::text[]) AS n`,
    [names],
  )) as { name: string; present: boolean }[];
  return rows.filter((r) => !r.present).map((r) => r.name);
};

/**
 * Functions absent from the connected database, given `name(argtypes)`
 * signatures. `to_regprocedure` returns NULL rather than raising for an unknown
 * signature, so this stays a probe and never becomes the failure it detects.
 */
export const missingFunctions = async (sigs: string[]): Promise<string[]> => {
  const rows = (await allRows(
    `SELECT s AS sig, to_regprocedure(s) IS NOT NULL AS present
       FROM unnest($1::text[]) AS s`,
    [sigs],
  )) as { sig: string; present: boolean }[];
  return rows.filter((r) => !r.present).map((r) => r.sig);
};

/**
 * True when `rel` holds no rows. Caller must have established the relation
 * EXISTS (missingRelations) — this is the separate "present but never loaded"
 * case, which is what a fresh clone leaves behind after a loader skips its own
 * gitignored input but still applies its migration.
 */
export const isEmpty = async (rel: string): Promise<boolean> => {
  const [row] = (await allRows(
    `SELECT NOT EXISTS (SELECT 1 FROM ${rel}) AS empty`,
  )) as { empty: boolean }[];
  return !!row?.empty;
};

/** Declared inputs that are absent from disk, repo-relative. */
export const missingPaths = (root: string, rels: string[]): string[] =>
  rels.filter((r) => !fs.existsSync(path.join(root, r)));

/**
 * Report a skip in the shared shape. The caller must `return` without writing —
 * this only logs. Deliberately `console.warn` + exit 0 at the call site: the
 * chain must go on, and the artifact's own data test (e.g.
 * sector_stats.data.test.ts) is where a genuinely stale file should go red.
 */
export const warnSkip = (
  generator: string,
  reason: string,
  remedy: string,
): void => {
  console.warn(`  ⚠ ${generator}: ${reason}`);
  console.warn(`    ${remedy}`);
  console.warn(
    `    Leaving the committed artifact untouched — nothing written.`,
  );
};
