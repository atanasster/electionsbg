// Load the contract corpus into Postgres — the PG port of load_procurement.ts.
// Reuses the shared column⇄field map (lib/procurement_schema) so the loaded rows
// are identical to the SQLite loader's; the generators (source-agnostic) then
// read from PG instead of node:sqlite. Full rebuild from the month shards.
//
//   npm run db:load:pg          (needs `npm run db:pg:up` first)
//
// See docs/plans/postgres-migration-v1.md.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROC_DIR } from "./lib/paths";
import { getPool, exec, withClient, end } from "./lib/pg";
import { COLUMN_NAMES, contractToRow } from "./lib/procurement_schema";
import type { Contract } from "../procurement/types";

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
const SCHEMA_FILE = path.join(SCHEMA_DIR, "001_procurement.sql");
const TRACKING_FILE = path.join(SCHEMA_DIR, "005_ingest_tracking.sql");
const CONTRACTOR_SEARCH_FILE = path.join(
  SCHEMA_DIR,
  "006_contractor_search.sql",
);
const COMPANY_API_FILE = path.join(SCHEMA_DIR, "011_company_api.sql");
const CABINETS_FILE = path.join(SCHEMA_DIR, "013_cabinets.sql");
const DEBARRED_SCHEMA_FILE = path.join(SCHEMA_DIR, "014_debarred.sql");
const RELATIONSHIPS_FILE = path.join(
  SCHEMA_DIR,
  "017_company_relationships.sql",
);
const SECTOR_STATS_FILE = path.join(SCHEMA_DIR, "018_sector_stats.sql");
const FUNDS_SCHEMA_FILE = path.join(SCHEMA_DIR, "015_funds.sql");
const FUND_PROJECTS_SCHEMA_FILE = path.join(
  SCHEMA_DIR,
  "016_fund_projects.sql",
);
const INSTITUTION_FILE = path.join(SCHEMA_DIR, "020_institution.sql");
const AWARDER_SEATS_FILE = path.join(SCHEMA_DIR, "021_awarder_seats.sql");
const AWARDER_API_FILE = path.join(SCHEMA_DIR, "023_awarder_api.sql");
const PROC_OVERVIEW_FILE = path.join(
  SCHEMA_DIR,
  "025_procurement_overview.sql",
);
const PROC_CONCENTRATION_FILE = path.join(
  SCHEMA_DIR,
  "026_procurement_concentration.sql",
);
const PROC_FLOW_FILE = path.join(SCHEMA_DIR, "027_procurement_flow.sql");
const GOVERNMENTS_FILE = path.join(PROC_DIR, "..", "governments.json");
const DEBARRED_FILE = path.join(PROC_DIR, "debarred.json");
const monthShardDir = path.join(PROC_DIR, "contracts");
const N = COLUMN_NAMES.length;
const BATCH = 1000; // 1000 × 31 cols = 31k params (< PG's 65535 cap)

const gitSha = (): string => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

const readShards = (): { rows: Contract[]; years: Set<string> } => {
  const rows: Contract[] = [];
  const years = new Set<string>();
  for (const year of readdirSync(monthShardDir).sort()) {
    const dir = path.join(monthShardDir, year);
    if (year === "by-id" || !statSync(dir).isDirectory()) continue;
    years.add(year);
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith(".json")) continue;
      for (const c of JSON.parse(
        readFileSync(path.join(dir, f), "utf8"),
      ) as Contract[])
        rows.push(c);
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

export const loadPg = async (): Promise<{
  rows: number;
  years: string[];
  batchId: number;
  rowsNew: number;
}> => {
  await waitForPg();
  await exec(readFileSync(FN_FILE, "utf8"));
  await exec(readFileSync(SCHEMA_FILE, "utf8"));
  await exec(readFileSync(TRACKING_FILE, "utf8"));
  await exec(readFileSync(CONTRACTOR_SEARCH_FILE, "utf8"));
  await exec(readFileSync(COMPANY_API_FILE, "utf8"));
  await exec(readFileSync(CABINETS_FILE, "utf8"));
  await exec(readFileSync(DEBARRED_SCHEMA_FILE, "utf8"));
  await exec(readFileSync(RELATIONSHIPS_FILE, "utf8"));
  await exec(readFileSync(SECTOR_STATS_FILE, "utf8"));
  // Ensure the funds tables exist (data loaded by load_funds_pg) so
  // institution_identity / company_geography can reference them even on a
  // contracts-only load. awarder_seats data is loaded by load_awarder_seats_pg.
  await exec(readFileSync(FUNDS_SCHEMA_FILE, "utf8"));
  await exec(readFileSync(FUND_PROJECTS_SCHEMA_FILE, "utf8"));
  await exec(readFileSync(INSTITUTION_FILE, "utf8"));
  await exec(readFileSync(AWARDER_SEATS_FILE, "utf8"));
  await exec(readFileSync(AWARDER_API_FILE, "utf8"));
  await exec(readFileSync(PROC_OVERVIEW_FILE, "utf8"));
  await exec(readFileSync(PROC_CONCENTRATION_FILE, "utf8"));
  await exec(readFileSync(PROC_FLOW_FILE, "utf8"));

  const { rows, years } = readShards();
  let batchId = 0;
  let rowsNew = 0;

  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE contracts");
    const insertCols = COLUMN_NAMES.join(", ");
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch
        .map(
          (_, r) =>
            `(${COLUMN_NAMES.map((_, col) => `$${r * N + col + 1}`).join(",")})`,
        )
        .join(",");
      const params = batch.flatMap((row) => contractToRow(row));
      await c.query(
        `INSERT INTO contracts (${insertCols}) VALUES ${values}`,
        params,
      );
    }

    // Contract-name search index — distinct contractor as they appear in the
    // corpus (covers contractors absent from TR). Rebuilt each load.
    await c.query("TRUNCATE contractor_search");
    await c.query(
      `INSERT INTO contractor_search (eik, name)
       SELECT DISTINCT contractor_eik, contractor_name
       FROM contracts WHERE contractor_eik <> ''`,
    );

    // Feature 2: open a batch, then record first-seen for any key not already
    // known (existing keys keep their original batch). rows_new = the delta.
    const b = await c.query(
      "INSERT INTO ingest_batches (source, rows_total) VALUES ('shards', $1) RETURNING id",
      [rows.length],
    );
    batchId = b.rows[0].id as number;
    const ins = await c.query(
      `INSERT INTO contract_first_seen (key, batch_id)
       SELECT key, $1 FROM contracts
       ON CONFLICT (key) DO NOTHING`,
      [batchId],
    );
    rowsNew = ins.rowCount ?? 0;
    await c.query("UPDATE ingest_batches SET rows_new = $1 WHERE id = $2", [
      rowsNew,
      batchId,
    ]);

    // Upsert (not TRUNCATE) so the TR loader's meta stamps survive re-loads.
    const sorted = [...years].sort();
    for (const [k, v] of [
      ["schema_version", "pg/001_procurement.sql"],
      ["generated_at", new Date().toISOString()],
      ["code_git_sha", gitSha()],
      ["contracts", String(rows.length)],
      ["coverage", `${sorted[0]}..${sorted.at(-1)}`],
    ])
      await c.query(
        "INSERT INTO meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [k, v],
      );
    await c.query("COMMIT");
  });

  // Cabinet timeline (governments.json → cabinets) for the government-correlation
  // view. Tiny (~18 rows); the /db pages read it from PG, not JSON.
  if (existsSync(GOVERNMENTS_FILE)) {
    const govs = (
      JSON.parse(readFileSync(GOVERNMENTS_FILE, "utf8")) as {
        governments: Array<{
          id: string;
          pmBg?: string;
          pmEn?: string;
          startDate: string;
          endDate?: string | null;
          type?: string;
          parties?: string[];
          partiesEn?: string[];
        }>;
      }
    ).governments;
    await withClient(async (c) => {
      await c.query("BEGIN");
      await c.query("TRUNCATE cabinets");
      for (const g of govs)
        await c.query(
          `INSERT INTO cabinets (id, pm_bg, pm_en, start_date, end_date, type, parties, parties_en)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
          [
            g.id,
            g.pmBg ?? null,
            g.pmEn ?? null,
            g.startDate,
            g.endDate ?? null,
            g.type ?? null,
            g.parties ?? null,
            g.partiesEn ?? null,
          ],
        );
      await c.query("COMMIT");
    });
  }

  // АОП debarred-suppliers register (name-only) → debarred table; name_norm
  // computed via debar_norm() so the /db company page can flag it from PG.
  if (existsSync(DEBARRED_FILE)) {
    const deb =
      (
        JSON.parse(readFileSync(DEBARRED_FILE, "utf8")) as {
          entries?: Array<{
            name: string;
            publishedAt?: string;
            debarredUntil?: string;
            detailsUrl?: string;
          }>;
        }
      ).entries ?? [];
    await withClient(async (c) => {
      await c.query("BEGIN");
      await c.query("TRUNCATE debarred");
      for (const d of deb)
        await c.query(
          `INSERT INTO debarred (name, name_norm, published_at, debarred_until, details_url)
           VALUES ($1, debar_norm($1), $2, $3, $4)`,
          [
            d.name,
            d.publishedAt ?? null,
            d.debarredUntil ?? null,
            d.detailsUrl ?? null,
          ],
        );
      await c.query("COMMIT");
    });
  }

  // Precomputed aggregates over the freshly-loaded contracts (buyer grand-totals
  // for capture share; sector rank stats). Refreshed here so they never go stale.
  await exec("REFRESH MATERIALIZED VIEW awarder_totals");
  await exec("REFRESH MATERIALIZED VIEW sector_contractor_stats");

  return { rows: rows.length, years: [...years].sort(), batchId, rowsNew };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!existsSync(path.join(PROC_DIR, "index.json"))) {
    console.error(`No procurement data at ${PROC_DIR} — run the ingest first.`);
    process.exit(1);
  }
  const t0 = Date.now();
  loadPg()
    .then(async ({ rows, years, batchId, rowsNew }) => {
      console.log(
        `loaded ${rows} contracts → Postgres (${years[0]}..${years.at(-1)}) in ${((Date.now() - t0) / 1000).toFixed(1)}s` +
          `  [batch ${batchId}: ${rowsNew} new]`,
      );
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
