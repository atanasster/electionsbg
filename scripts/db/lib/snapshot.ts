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
import { allRows, DATABASE_URL } from "./pg";
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

// The local Docker container serves 127.0.0.1/localhost:5433 — dump it via
// `docker exec` (its client tools match the server version).
const isLocalContainerTarget = (): boolean => {
  try {
    const u = new URL(DATABASE_URL);
    return (
      (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
      (u.port === "5433" || u.port === "")
    );
  } catch {
    return true;
  }
};

const redactUrl = (url: string): string => url.replace(/\/\/[^@]*@/, "//");

// A remote target (the Cloud SQL proxy on 5434) is dumped through the LOCAL
// postgres:16 container's pg_dump — the host pg_dump is often older than the
// server (14 vs 16) and would refuse. The container reaches the host-side proxy
// via host.docker.internal; auth comes from a PGPASSFILE (never a plaintext
// password): we copy the repo .pgpass into the container with its host field
// rewritten to host.docker.internal so the line still matches. The password
// field is untouched and never printed.
const pgDumpRemoteViaContainer = (file: string, out: number): void => {
  const src = process.env.PGPASSFILE;
  if (!src || !fs.existsSync(src))
    throw new Error(
      "cloud pg_dump needs PGPASSFILE (a .pgpass with the proxy line); none set",
    );
  const u = new URL(DATABASE_URL);
  const port = u.port || "5432";
  const user = decodeURIComponent(u.username) || "postgres";
  const db = u.pathname.replace(/^\//, "") || PG_DB;
  const dockerHost = "host.docker.internal";
  // Rewrite the host field of the matching line so it still matches when the
  // container connects to `dockerHost` instead of 127.0.0.1. Password untouched.
  const rewritten = fs
    .readFileSync(src, "utf8")
    .replace(
      new RegExp(`^${u.hostname.replace(/\./g, "\\.")}:${port}:`, "gm"),
      `${dockerHost}:${port}:`,
    );
  const hostTmp = `${file}.pgpass.tmp`;
  const inTmp = `/tmp/ndp_pgpass_${process.pid}`;
  fs.writeFileSync(hostTmp, rewritten, { mode: 0o600 });
  try {
    if (spawnSync("docker", ["cp", hostTmp, `${PG_CONTAINER}:${inTmp}`]).status)
      throw new Error(`docker cp .pgpass → ${PG_CONTAINER} failed`);
    spawnSync("docker", ["exec", PG_CONTAINER, "chmod", "600", inTmp]);
    const r = spawnSync(
      "docker",
      [
        "exec",
        "-e",
        `PGPASSFILE=${inTmp}`,
        PG_CONTAINER,
        "pg_dump",
        "-h",
        dockerHost,
        "-p",
        port,
        "-U",
        user,
        "-Fc",
        db,
      ],
      { stdio: ["ignore", out, "inherit"], maxBuffer: 1 << 30 },
    );
    if (r.status !== 0)
      throw new Error(
        `pg_dump (via ${PG_CONTAINER}) failed (status ${r.status}) — is the container up and the proxy listening on ${redactUrl(DATABASE_URL)}?`,
      );
  } finally {
    spawnSync("docker", ["exec", PG_CONTAINER, "rm", "-f", inTmp]);
    fs.rmSync(hostTmp, { force: true });
  }
};

/** pg_dump the whole DB (custom, compressed, restorable) to `file`. */
export const pgDump = (file: string): void => {
  const out = fs.openSync(file, "w");
  try {
    if (isLocalContainerTarget()) {
      const r = spawnSync(
        "docker",
        ["exec", PG_CONTAINER, "pg_dump", "-U", "postgres", "-Fc", PG_DB],
        { stdio: ["ignore", out, "inherit"], maxBuffer: 1 << 30 },
      );
      if (r.status !== 0)
        throw new Error(
          `pg_dump failed (status ${r.status}) — is the container up?`,
        );
    } else {
      pgDumpRemoteViaContainer(file, out);
    }
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
