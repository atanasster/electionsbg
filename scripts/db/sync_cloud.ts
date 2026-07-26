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
import { spawnSync } from "node:child_process";
import { PG_DUMP_FILE } from "./lib/paths";
import { pgDump, pgRestore, PG_CONTAINER, PG_DB } from "./lib/snapshot";
import { end } from "./lib/pg";

const LOCAL_URL = "postgres://postgres:postgres@localhost:5433/electionsbg";
const CLOUD_URL =
  process.env.CLOUD_DATABASE_URL ??
  "postgres://postgres@127.0.0.1:5434/electionsbg";

// The tables a full restore MUST land intact. A --clean pg_restore silently
// drops-not-recreates any object whose CREATE fails, and exits 0 — the exact
// failure that dropped the whole tr_* subgraph in the 2026-07 incident (a
// generated-column table created before its function: pg_dump's dependency
// sorter misses that edge). These are the largest / most load-bearing tables,
// so a shortfall here means the restore is incomplete. Kept small and explicit
// rather than "every table" so the gate stays fast and its failure is legible.
const CRITICAL_TABLES = [
  "contracts",
  "tenders",
  "tr_companies",
  "tr_officers",
  "tr_person_roles",
  "price_facts",
  "person",
  "person_role",
];

export interface TableCount {
  table: string;
  src: number;
  tgt: number;
}

// Pure so it can be unit-tested without a DB. A table is a shortfall when the
// source has rows but the target holds under 90% of them — 90% (not 100%) so a
// live-write race on a churning table doesn't false-alarm, while a
// silently-dropped table (target 0, or a tiny fraction) always trips. Tables
// absent from the source (src 0) are skipped, not asserted.
export const parityShortfalls = (counts: TableCount[]): TableCount[] =>
  counts.filter((c) => c.src > 0 && c.tgt < 0.9 * c.src);

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

  // Parity gate — the restore above exits 0 even when --clean silently drops a
  // table it could not recreate, so verify the load actually landed before
  // anyone treats this target as deployable. Without this, corruption surfaces
  // only hours later via a downstream loader (the 2026-07 incident).
  console.log("verifying parity (source → target row counts) …");
  const counts: TableCount[] = CRITICAL_TABLES.map((table) => ({
    table,
    src: localCount(table),
    tgt: cloudCount(table),
  }));
  const short = parityShortfalls(counts);
  if (short.length) {
    throw new Error(
      [
        "PARITY CHECK FAILED — the Cloud SQL restore is INCOMPLETE:",
        ...short.map(
          (c) =>
            `  ${c.table}: source ${c.src.toLocaleString()} → target ${c.tgt.toLocaleString()}` +
            ` (${c.src ? ((c.tgt / c.src) * 100).toFixed(1) : "0"}%)`,
        ),
        "",
        "A --clean pg_restore drops-not-recreates any object whose CREATE fails",
        "(e.g. a generated-column table restored before its function — pg_dump's",
        "dependency sorter misses that edge), yet still exits 0. The target is now",
        "missing rows. Recover the affected tables with the targeted loaders, e.g.:",
        "  npm run db:load:tr:pg:cloud        # tr_companies / tr_officers / tr_person_roles",
        "then re-run this verify. Do NOT deploy against this target until it passes.",
      ].join("\n"),
    );
  }
  console.log(`✓ parity OK (${counts.length} critical tables within 90%)`);

  console.log("✓ local → Cloud SQL sync complete");
  console.log(
    "  reminder: re-apply any Cloud SQL session GUCs (e.g. pg_trgm) if the app relies on them.",
  );
};

// Row count from the local container (source of truth). psql -tA → a bare
// number; any failure (missing table) reads as 0 and the gate skips it.
const localCount = (table: string): number => {
  const r = spawnSync(
    "docker",
    [
      "exec",
      PG_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-tA",
      "-d",
      PG_DB,
      "-c",
      `SELECT count(*) FROM ${table}`,
    ],
    { encoding: "utf8" },
  );
  return Number((r.stdout ?? "").trim()) || 0;
};

// Row count from the Cloud SQL proxy (target). Uses the host psql — a plain
// count(*) is version-agnostic — with PGPASSFILE (set by ./lib/pg on import)
// supplying the proxy password file→file.
const cloudCount = (table: string): number => {
  const r = spawnSync(
    "psql",
    [CLOUD_URL, "-tA", "-c", `SELECT count(*) FROM ${table}`],
    { encoding: "utf8", env: process.env },
  );
  return Number((r.stdout ?? "").trim()) || 0;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main()
    .then(() => end())
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
