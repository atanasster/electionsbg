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
  /** null until `db:dump` uploads a snapshot. */
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

const redactUrl = (url: string): string => url.replace(/\/\/[^@]*@/, "//");
const DOCKER_HOST = "host.docker.internal";

interface Target {
  local: boolean; // the local docker container (127.0.0.1/localhost:5433)
  hostname: string;
  port: string;
  user: string;
  db: string;
}

// Parse a connection URL into a dump/restore target. The local docker container
// serves 127.0.0.1/localhost:5433 — dump/restore it via `docker exec` (its
// client tools match the server version). Anything else (the Cloud SQL proxy on
// 5434) is a remote target.
const parseTarget = (url: string): Target => {
  try {
    const u = new URL(url);
    const port = u.port || "5432";
    return {
      local:
        (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
        (u.port === "5433" || u.port === ""),
      hostname: u.hostname,
      port,
      user: decodeURIComponent(u.username) || "postgres",
      db: u.pathname.replace(/^\//, "") || PG_DB,
    };
  } catch {
    return { local: true, hostname: "", port: "", user: "postgres", db: PG_DB };
  }
};

// Run `fn` with a PGPASSFILE copied INTO the local postgres:16 container, its
// host field rewritten to host.docker.internal so the line still matches when
// the container dials the host-side proxy. The password field is untouched and
// never read into a variable or printed — auth stays file→file via PGPASSFILE.
// Used for remote dump/restore: the host pg client is often older than the Cloud
// SQL server (14 vs 16) and would refuse, but the container's client matches.
const withContainerPgpass = <T>(
  t: Target,
  hostTmpDir: string,
  fn: (inContainerPgpass: string) => T,
): T => {
  const src = process.env.PGPASSFILE;
  if (!src || !fs.existsSync(src))
    throw new Error(
      "remote pg needs PGPASSFILE (a .pgpass with the proxy line); none set",
    );
  const rewritten = fs
    .readFileSync(src, "utf8")
    .replace(
      new RegExp(`^${t.hostname.replace(/\./g, "\\.")}:${t.port}:`, "gm"),
      `${DOCKER_HOST}:${t.port}:`,
    );
  const hostTmp = path.join(hostTmpDir, `.ndp_pgpass_${process.pid}`);
  const inTmp = `/tmp/ndp_pgpass_${process.pid}`;
  fs.writeFileSync(hostTmp, rewritten, { mode: 0o600 });
  try {
    if (spawnSync("docker", ["cp", hostTmp, `${PG_CONTAINER}:${inTmp}`]).status)
      throw new Error(`docker cp .pgpass → ${PG_CONTAINER} failed`);
    spawnSync("docker", ["exec", PG_CONTAINER, "chmod", "600", inTmp]);
    return fn(inTmp);
  } finally {
    spawnSync("docker", ["exec", PG_CONTAINER, "rm", "-f", inTmp]);
    fs.rmSync(hostTmp, { force: true });
  }
};

/**
 * pg_dump the whole DB (custom, compressed, restorable) to `file`. `url`
 * defaults to DATABASE_URL; pass an explicit url to dump a specific target (e.g.
 * the local container while restoring elsewhere — see db:sync:cloud).
 */
export const pgDump = (file: string, url: string = DATABASE_URL): void => {
  const t = parseTarget(url);
  const out = fs.openSync(file, "w");
  try {
    if (t.local) {
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
      withContainerPgpass(t, path.dirname(file), (pgpass) => {
        const r = spawnSync(
          "docker",
          [
            "exec",
            "-e",
            `PGPASSFILE=${pgpass}`,
            PG_CONTAINER,
            "pg_dump",
            "-h",
            DOCKER_HOST,
            "-p",
            t.port,
            "-U",
            t.user,
            "-Fc",
            t.db,
          ],
          { stdio: ["ignore", out, "inherit"], maxBuffer: 1 << 30 },
        );
        if (r.status !== 0)
          throw new Error(
            `pg_dump (via ${PG_CONTAINER}) failed (status ${r.status}) — is the container up and the proxy listening on ${redactUrl(url)}?`,
          );
      });
    }
  } finally {
    fs.closeSync(out);
  }
};

/**
 * pg_restore `file` into the DB (drops + recreates objects). `url` defaults to
 * DATABASE_URL; pass an explicit url to restore into a specific target (e.g.
 * Cloud SQL — see db:sync:cloud / db:restore:cloud). A remote restore is
 * DESTRUCTIVE: --clean drops + recreates every object in the target.
 */
export const pgRestore = (file: string, url: string = DATABASE_URL): void => {
  const t = parseTarget(url);
  const input = fs.readFileSync(file);
  const run = (extraArgs: string[]): number | null => {
    const r = spawnSync(
      "docker",
      [
        "exec",
        "-i",
        ...extraArgs,
        PG_CONTAINER,
        "pg_restore",
        "-U",
        t.user,
        "-d",
        t.db,
        "--clean",
        "--if-exists",
        "--no-owner",
        ...(t.local ? [] : ["-h", DOCKER_HOST, "-p", t.port]),
      ],
      { input, stdio: ["pipe", "inherit", "inherit"], maxBuffer: 1 << 30 },
    );
    return r.status;
  };
  // pg_restore exits non-zero on ignorable "does not exist" notices under
  // --clean; surface real failures via the post-restore identity check instead.
  const status = t.local
    ? run([])
    : withContainerPgpass(t, path.dirname(file), (pgpass) =>
        run(["-e", `PGPASSFILE=${pgpass}`]),
      );
  if (status !== 0)
    console.warn(
      `  pg_restore exited ${status} (often benign --clean notices)`,
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
