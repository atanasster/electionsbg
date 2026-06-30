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

/** Numbered DDL migrations applied by scripts/db/migrate.ts. */
export const SCHEMA_DIR = path.join(REPO_ROOT, "scripts", "db", "schema");

/** Procurement source-of-truth SQLite (Phase 2). Lives under raw_data/ next to
 *  the TR state.sqlite — gitignored, a regenerable cache distributed via GCS
 *  (Phase 3), never committed. */
export const PROC_DB = path.join(
  REPO_ROOT,
  "raw_data",
  "procurement",
  "procurement.sqlite",
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
