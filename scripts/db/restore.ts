// DB versioning — restore the Postgres store from the GCS pg_dump snapshot
// recorded in the committed lockfile. For a fresh clone / CI / a second machine
// that has the repo but not the (regenerable) DB.
//
//   npm run db:restore                 → download from lockfile.snapshot.gcs
//   npm run db:restore -- --local <dir> → read from a local dir (round-trip test)
//
// Verifies the download against the lockfile sha256, pg_restores into the DB,
// then sanity-checks the restored DB's identity against the lockfile.
// See docs/plans/postgres-migration-v1.md.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { PG_DUMP_FILE } from "./lib/paths";
import {
  LATEST_NAME,
  readIdentity,
  readLockfile,
  sha256File,
  pgRestore,
} from "./lib/snapshot";
import { end } from "./lib/pg";

const argFlag = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const main = async (): Promise<void> => {
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

  fs.mkdirSync(path.dirname(PG_DUMP_FILE), { recursive: true });
  if (localDir) {
    fs.copyFileSync(path.join(localDir, LATEST_NAME), PG_DUMP_FILE);
    console.log(`copied from ${localDir}`);
  } else {
    const r = spawnSync("gsutil", ["cp", lock.snapshot.gcs, PG_DUMP_FILE], {
      stdio: "inherit",
    });
    if (r.status !== 0) {
      console.error(`gsutil cp ${lock.snapshot.gcs} failed`);
      process.exit(1);
    }
  }

  // Download integrity.
  const sha = sha256File(PG_DUMP_FILE);
  if (sha !== lock.snapshot.sha256) {
    console.error(
      `sha256 mismatch: got ${sha.slice(0, 16)}, lockfile ${lock.snapshot.sha256.slice(0, 16)} — corrupt download.`,
    );
    process.exit(1);
  }

  console.log("pg_restore …");
  pgRestore(PG_DUMP_FILE);
  fs.rmSync(PG_DUMP_FILE, { force: true });

  // Sanity-check the restored DB against the lockfile identity.
  const got = await readIdentity();
  const ok =
    got.schemaVersion === lock.schemaVersion &&
    got.rowCounts.contracts === lock.rowCounts.contracts;
  console.log(
    `restored ${got.db} — schema ${got.schemaVersion}, ` +
      `${got.rowCounts.contracts.toLocaleString()} contracts, ` +
      `${got.rowCounts.trCompanies.toLocaleString()} TR companies, coverage ${got.coverage}`,
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main()
    .then(() => end())
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
