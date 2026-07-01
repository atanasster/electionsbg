// Phase 3 — restore the procurement .sqlite from the GCS snapshot recorded in
// the committed lockfile. For a fresh clone / CI / a second machine that has the
// repo but not the (gitignored) DB.
//
//   npm run db:restore                 → download from lockfile.snapshot.gcs
//   npm run db:restore -- --local <dir> → read from a local dir (round-trip test)
//
// Verifies the download against the lockfile sha256, gunzips into place, then
// sanity-checks the restored DB's meta (schema version + contract count) against
// the lockfile. See docs/plans/sql-migration-v1.md (Phase 3).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { PROC_DB } from "./lib/paths";
import {
  LATEST_NAME,
  readIdentity,
  readLockfile,
  sha256File,
} from "./lib/snapshot";

const argFlag = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const main = (): void => {
  const lock = readLockfile();
  if (!lock) {
    console.error(
      "No data/db/procurement.lock.json — run npm run db:push first.",
    );
    process.exit(1);
  }
  if (!lock.snapshot) {
    console.error(
      "lockfile has no snapshot (dry-run only) — run a real npm run db:push first.",
    );
    process.exit(1);
  }
  const localDir = argFlag("--local");

  // Fetch the gz next to the DB.
  const gzPath = `${PROC_DB}.gz`;
  fs.mkdirSync(path.dirname(PROC_DB), { recursive: true });
  if (localDir) {
    fs.copyFileSync(path.join(localDir, LATEST_NAME), gzPath);
    console.log(`copied from ${localDir}`);
  } else {
    const r = spawnSync("gsutil", ["cp", lock.snapshot.gcs, gzPath], {
      stdio: "inherit",
    });
    if (r.status !== 0) {
      console.error(`gsutil cp ${lock.snapshot.gcs} failed`);
      process.exit(1);
    }
  }

  // Download integrity.
  const sha = sha256File(gzPath);
  if (sha !== lock.snapshot.sha256) {
    console.error(
      `sha256 mismatch: got ${sha.slice(0, 16)}, lockfile ${lock.snapshot.sha256.slice(0, 16)} — corrupt download.`,
    );
    process.exit(1);
  }

  // Gunzip into place (WAL/shm sidecars from a previous open would shadow it).
  for (const ext of ["-wal", "-shm", "-journal"])
    fs.rmSync(PROC_DB + ext, { force: true });
  fs.writeFileSync(PROC_DB, zlib.gunzipSync(fs.readFileSync(gzPath)));
  fs.rmSync(gzPath, { force: true });

  // Sanity-check the restored DB against the lockfile identity.
  const got = readIdentity(PROC_DB);
  const ok =
    got.schemaVersion === lock.schemaVersion &&
    got.rowCounts.contracts === lock.rowCounts.contracts;
  console.log(
    `restored ${path.basename(PROC_DB)} — schema ${got.schemaVersion}, ` +
      `${got.rowCounts.contracts.toLocaleString()} contracts, coverage ${got.coverage}`,
  );
  if (!ok) {
    console.error(
      `restored DB does not match lockfile (schema ${got.schemaVersion} vs ${lock.schemaVersion}, ` +
        `contracts ${got.rowCounts.contracts} vs ${lock.rowCounts.contracts}).`,
    );
    process.exit(1);
  }
  console.log("✓ verified against lockfile");
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
