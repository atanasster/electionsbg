// DB versioning helpers (Postgres). The Postgres store is a regenerable cache,
// so we version the *recipe + inputs* (schema SQL in git, meta stamped at load)
// and distribute a *pg_dump snapshot* via GCS with a committed lockfile pointer —
// mirroring how data/ already ships (see bucket:sync / bucket:gz).
//
// The lockfile (data/db/procurement.lock.json, committed) records the DB's data
// identity (schema version, row counts, coverage, git sha) plus, once pushed, the
// snapshot artifact (GCS url, sha256, bytes) for download-integrity on restore.
//
// pg_dump/pg_restore run inside the local Postgres container (its client tools
// match the server version; a brew pg_dump on the host may be older and refuse a
// newer server). For a deployed Postgres, run these against DATABASE_URL with a
// matching client instead. See docs/plans/postgres-migration-v1.md.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { allRows } from "./pg";
import { DB_DIR } from "./paths";

export const GCS_DB_DIR = "gs://data-electionsbg-com/db";
export const LATEST_NAME = "electionsbg-latest.dump";
export const LOCK_FILE = path.join(DB_DIR, "procurement.lock.json");
export const PG_CONTAINER = process.env.PG_CONTAINER ?? "electionsbg-pg";
export const PG_DB = process.env.PGDATABASE ?? "electionsbg";

export interface SnapshotRef {
  gcs: string;
  sha256: string; // of the dump artifact (download-integrity check)
  bytes: number;
  pushedAt: string;
}

export interface Lockfile {
  db: string;
  schemaVersion: string | null;
  rowCounts: { contracts: number; trCompanies: number; trOfficers: number };
  coverage: string | null;
  generatedAt: string | null;
  codeGitSha: string | null;
  /** null until `db:push` uploads a snapshot. */
  snapshot: SnapshotRef | null;
}

const meta = async (): Promise<Record<string, string>> => {
  const rows = await allRows<{ key: string; value: string }>(
    "SELECT key, value FROM meta",
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};

const count = async (table: string): Promise<number> => {
  try {
    const r = await allRows<{ n: string }>(
      `SELECT count(*) AS n FROM ${table}`,
    );
    return Number(r[0]?.n ?? 0);
  } catch {
    return 0;
  }
};

/** Data-identity of the DB — counts from the live tables, stamps from meta. */
export const readIdentity = async (): Promise<Omit<Lockfile, "snapshot">> => {
  const m = await meta();
  return {
    db: PG_DB,
    schemaVersion: m.schema_version ?? null,
    rowCounts: {
      contracts: await count("contracts"),
      trCompanies: await count("tr_companies"),
      trOfficers: await count("tr_officers"),
    },
    coverage: m.coverage ?? null,
    generatedAt: m.generated_at ?? null,
    codeGitSha: m.code_git_sha ?? null,
  };
};

/** pg_dump the whole DB (custom, compressed, restorable) to `file`. */
export const pgDump = (file: string): void => {
  const out = fs.openSync(file, "w");
  try {
    const r = spawnSync(
      "docker",
      ["exec", PG_CONTAINER, "pg_dump", "-U", "postgres", "-Fc", PG_DB],
      { stdio: ["ignore", out, "inherit"], maxBuffer: 1 << 30 },
    );
    if (r.status !== 0)
      throw new Error(
        `pg_dump failed (status ${r.status}) — is the container up?`,
      );
  } finally {
    fs.closeSync(out);
  }
};

/** pg_restore `file` into the DB (drops + recreates objects). */
export const pgRestore = (file: string): void => {
  const r = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      PG_CONTAINER,
      "pg_restore",
      "-U",
      "postgres",
      "-d",
      PG_DB,
      "--clean",
      "--if-exists",
      "--no-owner",
    ],
    {
      input: fs.readFileSync(file),
      stdio: ["pipe", "inherit", "inherit"],
      maxBuffer: 1 << 30,
    },
  );
  // pg_restore exits non-zero on ignorable "does not exist" notices under
  // --clean; surface real failures via the post-restore identity check instead.
  if (r.status !== 0)
    console.warn(
      `  pg_restore exited ${r.status} (often benign --clean notices)`,
    );
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
