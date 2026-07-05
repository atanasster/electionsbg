// Load the tenders (procedures) corpus into Postgres — the tender-stage sibling
// of load_pg.ts. Full rebuild from the month shards (data/procurement/tenders/
// YYYY/YYYY-MM.json), which stay the ingest artifact; PG becomes the queryable +
// joinable store and (next) the source the derived tenders JSON is generated
// from. Reuses the shared column⇄field map (lib/tenders_schema).
//
//   npm run db:load:tenders:pg     (needs `npm run db:pg:up` first)
//
// See docs/plans/pg-datasets-roadmap.md §0 (Tenders).

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROC_DIR } from "./lib/paths";
import { getPool, exec, withClient, end } from "./lib/pg";
import { COLUMN_NAMES, columnCast, tenderToRow } from "./lib/tenders_schema";
import { recordIngestBatch } from "./lib/ingest_changelog";
import type { Tender } from "../../src/lib/tenderTypes";

const SCHEMA_DIR = path.join(
  PROC_DIR,
  "..",
  "..",
  "scripts",
  "db",
  "schema",
  "pg",
);
const FN_FILE = path.join(SCHEMA_DIR, "000_search_fns.sql");
const SCHEMA_FILE = path.join(SCHEMA_DIR, "009_tenders.sql");
const TRACKING_FILE = path.join(SCHEMA_DIR, "005_ingest_tracking.sql");
const API_FILE = path.join(SCHEMA_DIR, "010_tenders_api.sql");
// КЗК appeals schema (table + tender_appeals / kzk_recent_appeals) — joins
// tenders by УНП; created here so db:push ships it. Data comes from the separate
// headed-Playwright ingest (scripts/procurement/kzk_appeals.ts --apply).
const KZK_FILE = path.join(SCHEMA_DIR, "042_kzk_appeals.sql");
// AI-chat serving fns over the tenders + kzk_appeals tables (tender_corpus_search
// for openTenders' corpus path, kzk_appeals_summary for procurementAppeals) —
// applied after KZK_FILE since both read those tables.
const AI_FILE = path.join(SCHEMA_DIR, "044_procurement_ai.sql");
const tendersDir = path.join(PROC_DIR, "tenders");
const N = COLUMN_NAMES.length;
const BATCH = 1000; // 1000 × 33 cols = 33k params (< PG's 65535 cap)

const gitSha = (): string => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

/** Walk only the YYYY/ month-shard dirs (skip by-ocid / by-tender / by_year and
 *  the top-level index / recent files — those are derived, not source rows). */
const readShards = (): { rows: Tender[]; years: Set<string> } => {
  const rows: Tender[] = [];
  const years = new Set<string>();
  for (const year of readdirSync(tendersDir).sort()) {
    if (!/^\d{4}$/.test(year)) continue;
    const dir = path.join(tendersDir, year);
    if (!statSync(dir).isDirectory()) continue;
    years.add(year);
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith(".json")) continue;
      for (const t of JSON.parse(
        readFileSync(path.join(dir, f), "utf8"),
      ) as Tender[])
        rows.push(t);
    }
  }
  return { rows, years };
};

const waitForPg = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) {
    try {
      await getPool().query("SELECT 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("Postgres not reachable — run `npm run db:pg:up`.");
};

// Placeholder row template with per-column casts (jsonb needs ::jsonb).
const rowPlaceholders = (r: number): string =>
  `(${COLUMN_NAMES.map((col, c) => `$${r * N + c + 1}${columnCast(col)}`).join(
    ",",
  )})`;

export const loadTendersPg = async (): Promise<{
  rows: number;
  years: string[];
}> => {
  await waitForPg();
  await exec(readFileSync(FN_FILE, "utf8"));
  await exec(readFileSync(SCHEMA_FILE, "utf8"));
  // Changelog tracking tables (ingest_batches + ingest_first_seen). Idempotent;
  // ensures they exist even when the tenders loader runs standalone (not via the
  // full db:refresh where load_pg applies 005 first).
  await exec(readFileSync(TRACKING_FILE, "utf8"));

  const { rows, years } = readShards();
  const insertCols = COLUMN_NAMES.join(", ");

  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE tenders");
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch.map((_, r) => rowPlaceholders(r)).join(",");
      const params = batch.flatMap((row) => tenderToRow(row));
      await c.query(
        `INSERT INTO tenders (${insertCols}) VALUES ${values}`,
        params,
      );
    }

    const sorted = [...years].sort();
    for (const [k, v] of [
      ["tenders_schema_version", "pg/009_tenders.sql"],
      ["tenders_generated_at", new Date().toISOString()],
      ["tenders_code_git_sha", gitSha()],
      ["tenders", String(rows.length)],
      ["tenders_coverage", `${sorted[0]}..${sorted.at(-1)}`],
    ])
      await c.query(
        "INSERT INTO meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [k, v],
      );
    // "What changed" changelog — atomic with the tender load (same txn). Small
    // daily deltas surface per-row in recent_updates; a bulk backfill summarises.
    await recordIngestBatch(c, {
      source: "tender",
      table: "tenders",
      keyExpr: "t.unp",
      nameExpr: "t.buyer_name",
      detailExpr: "t.subject",
      rowsTotal: rows.length,
    });
    await c.query("COMMIT");
  });

  // API functions last (post-commit) — they reference contracts, so validation
  // is deferred (SET check_function_bodies=off in the file) and a contracts-less
  // DB still gets a durable data load.
  await exec(readFileSync(API_FILE, "utf8"));
  // КЗК appeals table + serving fns (idempotent; preserves any ingested rows —
  // CREATE TABLE IF NOT EXISTS, functions replaced).
  await exec(readFileSync(KZK_FILE, "utf8"));
  // AI-chat serving fns (functions only; replaced each run).
  await exec(readFileSync(AI_FILE, "utf8"));

  return { rows: rows.length, years: [...years].sort() };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!existsSync(tendersDir)) {
    console.error(`No tenders data at ${tendersDir} — run the ingest first.`);
    process.exit(1);
  }
  const t0 = Date.now();
  loadTendersPg()
    .then(async ({ rows, years }) => {
      console.log(
        `loaded ${rows} tenders → Postgres (${years[0]}..${years.at(-1)}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
