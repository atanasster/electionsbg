// Phase 3 — snapshot the procurement .sqlite to GCS + update the committed
// lockfile. The .sqlite is gitignored (a regenerable cache); this ships it as a
// distributable artifact so a fresh clone / CI / a second machine can `db:restore`
// instead of re-running the full ingest.
//
//   npm run db:push               → gzip + gsutil cp to gs://…/db + write lockfile
//   npm run db:push -- --dry-run  → gzip + hash + write lockfile (snapshot=null),
//                                   print the gsutil commands; no upload
//   npm run db:push -- --local <dir> → transport to a local dir (round-trip test)
//
// See docs/plans/sql-migration-v1.md (Phase 3).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { PROC_DB } from "./lib/paths";
import {
  GCS_DB_DIR,
  LATEST_NAME,
  readIdentity,
  writeLockfile,
  sha256File,
  type SnapshotRef,
} from "./lib/snapshot";

const argFlag = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const main = (): void => {
  if (!fs.existsSync(PROC_DB)) {
    console.error(`No ${PROC_DB} — run npm run db:load first.`);
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  const localDir = argFlag("--local");

  const identity = readIdentity(PROC_DB);
  const stamp = new Date().toISOString();
  const day = stamp.slice(0, 10);

  // Gzip alongside the DB.
  const gzPath = `${PROC_DB}.gz`;
  console.log(`gzipping ${path.basename(PROC_DB)} …`);
  fs.writeFileSync(gzPath, zlib.gzipSync(fs.readFileSync(PROC_DB)));
  const sha = sha256File(gzPath);
  const bytes = fs.statSync(gzPath).size;
  const datedName = `procurement-${day}-${sha.slice(0, 8)}.sqlite.gz`;
  console.log(
    `  ${(bytes / 1e6).toFixed(1)}MB gz, sha256 ${sha.slice(0, 16)} → ${datedName}`,
  );

  let snapshot: SnapshotRef | null = null;
  if (dryRun) {
    console.log("--dry-run: skipping upload. Would run:");
    console.log(`  gsutil cp ${gzPath} ${GCS_DB_DIR}/${datedName}`);
    console.log(`  gsutil cp ${gzPath} ${GCS_DB_DIR}/${LATEST_NAME}`);
  } else if (localDir) {
    fs.mkdirSync(localDir, { recursive: true });
    fs.copyFileSync(gzPath, path.join(localDir, datedName));
    fs.copyFileSync(gzPath, path.join(localDir, LATEST_NAME));
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
        ["-h", "Content-Type:application/gzip", "cp", gzPath, dest],
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

  fs.rmSync(gzPath, { force: true });
  writeLockfile({ ...identity, snapshot });
  console.log(
    `lockfile → data/db/procurement.lock.json (snapshot: ${snapshot ? "set" : "null — dry-run"})`,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
