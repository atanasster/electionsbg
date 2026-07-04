// Direct local → Cloud SQL sync (Method B, full parity): pg_dump the local
// container and pg_restore straight into the Cloud SQL proxy — no GCS round-trip
// and no lockfile mutation. Both run through the local postgres:16 container
// (the host pg client is older than the v16 server and would refuse); auth to
// the proxy is file→file via PGPASSFILE (never a plaintext password).
//
//   npm run db:sync:cloud -- --yes
//
// DESTRUCTIVE on Cloud SQL: pg_restore --clean drops + recreates every object,
// so the LOCAL db must be the source of truth first — including the unregenerable
// КЗК tier-2 rows (run the kzk --apply locally before syncing). For a targeted,
// non-destructive single-dataset sync use the db:load:*:cloud wrappers instead.
//
// After a full restore, re-apply any Cloud SQL session GUCs the app relies on
// (e.g. pg_trgm.similarity_threshold) — a --clean restore can reset them.

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { PG_DUMP_FILE } from "./lib/paths";
import { pgDump, pgRestore } from "./lib/snapshot";
import { end } from "./lib/pg";

const LOCAL_URL = "postgres://postgres:postgres@localhost:5433/electionsbg";
const CLOUD_URL =
  process.env.CLOUD_DATABASE_URL ??
  "postgres://postgres@127.0.0.1:5434/electionsbg";

const main = async (): Promise<void> => {
  if (!process.argv.includes("--yes")) {
    console.error(
      [
        "Refusing to sync without --yes.",
        "",
        "This OVERWRITES Cloud SQL from the local DB (pg_restore --clean drops +",
        "recreates every object). Ensure local is the source of truth — including",
        "the unregenerable КЗК tier-2 rows — then re-run:",
        "",
        "  npm run db:sync:cloud -- --yes",
      ].join("\n"),
    );
    process.exit(1);
  }

  fs.mkdirSync(PG_DUMP_FILE.replace(/\/[^/]+$/, ""), { recursive: true });
  console.log("pg_dump (local container) …");
  pgDump(PG_DUMP_FILE, LOCAL_URL);
  console.log(`  ${(fs.statSync(PG_DUMP_FILE).size / 1e6).toFixed(1)}MB`);

  console.log("pg_restore → Cloud SQL …");
  pgRestore(PG_DUMP_FILE, CLOUD_URL);
  fs.rmSync(PG_DUMP_FILE, { force: true });

  console.log("✓ local → Cloud SQL sync complete");
  console.log(
    "  reminder: re-apply any Cloud SQL session GUCs (e.g. pg_trgm) if the app relies on them.",
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
