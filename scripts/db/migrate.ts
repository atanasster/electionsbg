// Applies the numbered DDL migrations in scripts/db/schema/ in filename order,
// recording each in a schema_migrations table so re-runs are idempotent. The
// procurement DB is rebuilt from scratch on every load (it's a derived cache),
// so in practice this just stamps 001 onto a fresh file — but the tracking
// table + ordering give us real schema versioning as more migrations land.
//
// See docs/plans/sql-migration-v1.md (Phase 0).

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { SCHEMA_DIR } from "./lib/paths";

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);`;

/** Apply all pending migrations to an open (writable) database. Returns the
 *  names applied this run. The latest migration name is the schema version. */
export const applyMigrations = (
  db: DatabaseSync,
  schemaDir: string = SCHEMA_DIR,
): string[] => {
  db.exec(MIGRATIONS_TABLE);
  const applied = new Set(
    (
      db.prepare("SELECT name FROM schema_migrations").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name),
  );
  const record = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );

  const files = readdirSync(schemaDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const ran: string[] = [];
  for (const name of files) {
    if (applied.has(name)) continue;
    db.exec(readFileSync(path.join(schemaDir, name), "utf8"));
    record.run(name, new Date().toISOString());
    ran.push(name);
  }
  return ran;
};

/** Latest applied migration name = schema version (e.g. "001_procurement.sql"). */
export const schemaVersion = (db: DatabaseSync): string | null => {
  const row = db
    .prepare("SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1")
    .get() as { name: string } | undefined;
  return row?.name ?? null;
};
