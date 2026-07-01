// Phase 3 — DB versioning helpers. The procurement .sqlite is a regenerable
// cache, so we version the *recipe + inputs* (schema migrations in git, meta
// stamped at load) and distribute the *binary* via GCS with a committed lockfile
// pointer — mirroring how data/ already ships (see bucket:sync / bucket:gz).
//
// The lockfile (data/db/procurement.lock.json, committed) records the DB's data
// identity (schema version, row counts, coverage, git sha) plus, once pushed, the
// snapshot artifact (GCS url, gz sha256, bytes) for download-integrity on restore.
//
// See docs/plans/sql-migration-v1.md (Phase 3).

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DB_DIR, PROC_DB } from "./paths";
import { openDb } from "./open";

export const GCS_DB_DIR = "gs://data-electionsbg-com/db";
export const LATEST_NAME = "procurement-latest.sqlite.gz";
export const LOCK_FILE = path.join(DB_DIR, "procurement.lock.json");

export interface SnapshotRef {
  gcs: string;
  sha256: string; // of the gzipped artifact (download-integrity check)
  bytes: number;
  pushedAt: string;
}

export interface Lockfile {
  db: string;
  schemaVersion: string | null;
  rowCounts: { contracts: number };
  coverage: string | null;
  generatedAt: string | null;
  codeGitSha: string | null;
  /** null until `db:push` uploads a snapshot. */
  snapshot: SnapshotRef | null;
}

const readMeta = (dbPath: string): Record<string, string> => {
  const db = openDb(dbPath, { readOnly: true });
  const rows = db.prepare("SELECT key, value FROM meta").all() as Array<{
    key: string;
    value: string;
  }>;
  db.close();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};

/** Data-identity of the DB, derived from its meta table (stamped at load). */
export const readIdentity = (
  dbPath: string = PROC_DB,
): Omit<Lockfile, "snapshot"> => {
  const m = readMeta(dbPath);
  return {
    db: path.basename(dbPath),
    schemaVersion: m.schema_version ?? null,
    rowCounts: { contracts: Number(m.contracts ?? 0) },
    coverage: m.coverage ?? null,
    generatedAt: m.generated_at ?? null,
    codeGitSha: m.code_git_sha ?? null,
  };
};

export const readLockfile = (): Lockfile | null =>
  fs.existsSync(LOCK_FILE)
    ? (JSON.parse(fs.readFileSync(LOCK_FILE, "utf8")) as Lockfile)
    : null;

export const writeLockfile = (lock: Lockfile): void => {
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`);
};

export const sha256File = (p: string): string =>
  createHash("sha256").update(fs.readFileSync(p)).digest("hex");
