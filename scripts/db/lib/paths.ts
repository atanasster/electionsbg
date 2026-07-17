// Shared paths for the SQL-migration tooling (Phase 1 regression net + later
// the SQL source-of-truth build). Resolved from this file's location so the
// commands work regardless of the cwd a test runner invokes them from.
//
// See docs/plans/sql-migration-v1.md.

import { fileURLToPath } from "node:url";
import path from "node:path";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export const DATA_DIR = path.join(REPO_ROOT, "data");

/** Generated procurement JSON the frontend fetches — the corpus Phase 1
 *  characterizes and Phase 2 will regenerate from SQL. */
export const PROC_DIR = path.join(DATA_DIR, "procurement");

/** Matches a per-EIK rollup filename under PROC_DIR/{contractors,awarders}.
 *  EIKs are not numeric-only: ~124 foreign suppliers carry a letter-bearing
 *  VAT/registration id (ATU14715405, 5210084655NTRPL000005852, 140639Y), so a
 *  \d+ filter silently drops their rollups. Neither dir holds an index.json —
 *  every file in them is an EIK rollup. */
export const isEikRollupFile = (f: string): boolean =>
  /^[A-Za-z0-9]+\.json$/.test(f);

/** Postgres pg_dump snapshot artifact (custom format). Lives under raw_data/ —
 *  gitignored, a regenerable cache distributed via GCS with a committed lockfile
 *  pointer, never committed. See docs/plans/postgres-migration-v1.md. */
export const PG_DUMP_FILE = path.join(
  REPO_ROOT,
  "raw_data",
  "procurement",
  "electionsbg.dump",
);

/** Home for SQL-migration artifacts. The compact manifest here IS committed
 *  (small, git-tracked baseline); the full per-file map lives under .cache. */
export const DB_DIR = path.join(DATA_DIR, "db");

/** Committed compact baseline: per-category digests + headline totals. */
export const MANIFEST_FILE = path.join(DB_DIR, "procurement.manifest.json");

/** Full per-file canonical-hash map — large + regenerable, kept out of git and
 *  out of the GCS data sync (lives under scripts/, not data/). The drill-down
 *  baseline for the Phase 2 byte-level diff. */
export const FULL_MANIFEST_FILE = path.join(
  REPO_ROOT,
  "scripts",
  "db",
  ".cache",
  "procurement.files.json",
);

/** Committed golden fixtures — canonicalized snapshots of hand-picked entities
 *  for human-readable diffs. */
export const GOLDEN_DIR = path.join(
  REPO_ROOT,
  "scripts",
  "db",
  "__golden__",
  "procurement",
);
