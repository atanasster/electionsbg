// DB versioning — snapshot the Postgres store to GCS + update the committed
// lockfile. The store is regenerable, so this ships a pg_dump artifact so a fresh
// clone / CI / a second machine can `db:restore` instead of re-running the full
// ingest.
//
//   npm run db:push               → pg_dump + gsutil cp to gs://…/db + lockfile
//   npm run db:push -- --dry-run  → pg_dump + hash + lockfile (snapshot=null),
//                                   print the gsutil commands; no upload
//   npm run db:push -- --local <dir> → transport to a local dir (round-trip test)
//
// See docs/plans/postgres-migration-v1.md.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { PG_DUMP_FILE } from "./lib/paths";
import {
  GCS_DB_DIR,
  LATEST_NAME,
  readIdentity,
  writeLockfile,
  sha256File,
  pgDump,
  type SnapshotRef,
} from "./lib/snapshot";
import { end } from "./lib/pg";

const argFlag = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes("--dry-run");
  const localDir = argFlag("--local");

  const identity = await readIdentity();
  const stamp = new Date().toISOString();
  const day = stamp.slice(0, 10);

  console.log(`pg_dump ${identity.db} …`);
  fs.mkdirSync(path.dirname(PG_DUMP_FILE), { recursive: true });
  pgDump(PG_DUMP_FILE);
  const sha = sha256File(PG_DUMP_FILE);
  const bytes = fs.statSync(PG_DUMP_FILE).size;
  const datedName = `electionsbg-${day}-${sha.slice(0, 8)}.dump`;
  console.log(
    `  ${(bytes / 1e6).toFixed(1)}MB, sha256 ${sha.slice(0, 16)} → ${datedName}`,
  );

  let snapshot: SnapshotRef | null = null;
  if (dryRun) {
    console.log("--dry-run: skipping upload. Would run:");
    console.log(`  gsutil cp ${PG_DUMP_FILE} ${GCS_DB_DIR}/${datedName}`);
    console.log(`  gsutil cp ${PG_DUMP_FILE} ${GCS_DB_DIR}/${LATEST_NAME}`);
  } else if (localDir) {
    fs.mkdirSync(localDir, { recursive: true });
    fs.copyFileSync(PG_DUMP_FILE, path.join(localDir, datedName));
    fs.copyFileSync(PG_DUMP_FILE, path.join(localDir, LATEST_NAME));
    snapshot = {
      gcs: pathToFileURL(path.join(localDir, LATEST_NAME)).href,
      sha256: sha,
      bytes,
      pushedAt: stamp,
    };
    console.log(`copied to ${localDir}`);
  } else {
    for (const name of [datedName, LATEST_NAME]) {
      const dest = `${GCS_DB_DIR}/${name}`;
      const r = spawnSync(
        "gsutil",
        [
          "-h",
          "Content-Type:application/octet-stream",
          "cp",
          PG_DUMP_FILE,
          dest,
        ],
        { stdio: "inherit" },
      );
      if (r.status !== 0) {
        console.error(`gsutil cp → ${dest} failed`);
        process.exit(1);
      }
    }
    snapshot = {
      gcs: `${GCS_DB_DIR}/${LATEST_NAME}`,
      sha256: sha,
      bytes,
      pushedAt: stamp,
    };
    console.log(`uploaded to ${GCS_DB_DIR}/`);
  }

  fs.rmSync(PG_DUMP_FILE, { force: true });
  writeLockfile({ ...identity, snapshot });
  console.log(
    `lockfile → data/db/procurement.lock.json (snapshot: ${snapshot ? "set" : "null — dry-run"})`,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main()
    .then(() => end())
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
