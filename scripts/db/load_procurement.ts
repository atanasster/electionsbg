// Phase 2b — load the contract corpus into the procurement source-of-truth
// SQLite. Reads the month shards (the canonical normalized Contract rows) and
// inserts them into the `contracts` table in one WAL transaction, then stamps
// the `meta` table for traceability/versioning.
//
// The DB is rebuilt from scratch each run (it's a derived cache, distributed
// via GCS in Phase 3). Once the Phase 2c generators exist, the *raw* loader
// input shifts to normalize.ts output; for now the shards are the source.
//
//   npm run db:load
//
// See docs/plans/sql-migration-v1.md.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { PROC_DIR, PROC_DB } from "./lib/paths";
import { openDb, checkpointAndClose } from "./lib/open";
import { applyMigrations, schemaVersion } from "./migrate";
import { INSERT_SQL, contractToRow } from "./lib/procurement_schema";
import type { Contract } from "../procurement/types";

const monthShardDir = path.join(PROC_DIR, "contracts");

const gitSha = (): string => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

export const loadProcurement = (): {
  rows: number;
  years: string[];
} => {
  const db = openDb(PROC_DB, { fresh: true });
  applyMigrations(db);

  const insert = db.prepare(INSERT_SQL);
  const years = new Set<string>();
  let rows = 0;

  db.exec("BEGIN");
  try {
    for (const year of readdirSync(monthShardDir).sort()) {
      const dir = path.join(monthShardDir, year);
      if (year === "by-id" || !statSync(dir).isDirectory()) continue;
      years.add(year);
      for (const f of readdirSync(dir).sort()) {
        if (!f.endsWith(".json")) continue;
        const arr: Contract[] = JSON.parse(
          readFileSync(path.join(dir, f), "utf8"),
        );
        for (const c of arr) {
          insert.run(...contractToRow(c));
          rows++;
        }
      }
    }

    const setMeta = db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
    );
    setMeta.run("schema_version", schemaVersion(db) ?? "unknown");
    setMeta.run("generated_at", new Date().toISOString());
    setMeta.run("code_git_sha", gitSha());
    setMeta.run("source", "month-shards");
    setMeta.run("contracts", String(rows));
    setMeta.run(
      "coverage",
      `${[...years].sort()[0]}..${[...years].sort().at(-1)}`,
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    db.close();
    throw err;
  }

  checkpointAndClose(db);
  return { rows, years: [...years].sort() };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!existsSync(path.join(PROC_DIR, "index.json"))) {
    console.error(
      `No procurement data at ${PROC_DIR} — run the procurement ingest first.`,
    );
    process.exit(1);
  }
  const t0 = Date.now();
  const { rows, years } = loadProcurement();
  const mb = (statSync(PROC_DB).size / 1e6).toFixed(1);
  console.log(
    `loaded ${rows} contracts → ${path.relative(process.cwd(), PROC_DB)} ` +
      `(${mb}MB, ${years[0]}..${years.at(-1)}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}
