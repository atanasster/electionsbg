// Shared node:sqlite open helper for the SQL-migration tooling. One place for
// the pragmas + read-only convention so every domain build (procurement now,
// TR folded in later) opens databases the same way. Matches the existing TR
// pattern (scripts/declarations/tr/sqlite_writer.ts) — node:sqlite is
// experimental in Node 22 but stable enough for single-writer batch imports.
//
// See docs/plans/sql-migration-v1.md (Phase 0).

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

export interface OpenOpts {
  /** Open read-only (consumers/generators). Writers omit this. */
  readOnly?: boolean;
  /** Delete any existing file (+ WAL/shm sidecars) first — full rebuild. */
  fresh?: boolean;
}

export const openDb = (file: string, opts: OpenOpts = {}): DatabaseSync => {
  if (opts.fresh) {
    for (const ext of ["", "-wal", "-shm", "-journal"]) {
      const p = file + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
  const db = new DatabaseSync(file, opts.readOnly ? { readOnly: true } : {});
  if (!opts.readOnly) {
    db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY; PRAGMA foreign_keys = ON;",
    );
  }
  return db;
};

/** Flush the WAL into the main file and close — call after a write batch so the
 *  on-disk .sqlite is self-contained (no dangling -wal) for snapshotting. */
export const checkpointAndClose = (db: DatabaseSync): void => {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
};
