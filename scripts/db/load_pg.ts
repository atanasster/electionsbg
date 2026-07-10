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
import { getPool, exec, withClient, withTx, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { rebuildRiskGradeScoped } from "./lib/riskGradeScoped";
import { COLUMN_NAMES, contractToRow } from "./lib/procurement_schema";
import {
  INGEST_SUMMARY_THRESHOLD,
  upsertChangelogDay,
} from "./lib/ingest_changelog";
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
const PROC_SCANNER_FILE = path.join(SCHEMA_DIR, "028_procurement_scanner.sql");
const PROC_RISK_FEED_FILE = path.join(
  SCHEMA_DIR,
  "029_procurement_risk_feed.sql",
);
const PROC_BY_SETTLEMENT_FILE = path.join(
  SCHEMA_DIR,
  "030_procurement_by_settlement.sql",
);
const PROC_RANKINGS_FILE = path.join(
  SCHEMA_DIR,
  "031_procurement_rankings.sql",
);
const TENDER_DETAIL_FILE = path.join(SCHEMA_DIR, "032_tender_detail.sql");
const PROC_RISK_INDEXES_FILE = path.join(
  SCHEMA_DIR,
  "033_procurement_risk_indexes.sql",
);
const REF_PROCUREMENT_FILE = path.join(SCHEMA_DIR, "034_ref_procurement.sql");
const PROC_SEARCH_FILE = path.join(SCHEMA_DIR, "035_procurement_search.sql");
const PROC_SECTORS_FILE = path.join(SCHEMA_DIR, "036_procurement_sectors.sql");
const PROC_BENCHMARKS_FILE = path.join(
  SCHEMA_DIR,
  "037_procurement_benchmarks.sql",
);
const SECTOR_PEERS_WINDOW_FILE = path.join(
  SCHEMA_DIR,
  "038_sector_peers_window.sql",
);
const GOVERNMENTS_FILE = path.join(PROC_DIR, "..", "governments.json");
const DEBARRED_FILE = path.join(PROC_DIR, "debarred.json");
const monthShardDir = path.join(PROC_DIR, "contracts");

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
  await exec(readFileSync(PROC_SCANNER_FILE, "utf8"));
  await exec(readFileSync(PROC_RISK_FEED_FILE, "utf8"));
  await exec(readFileSync(PROC_BY_SETTLEMENT_FILE, "utf8"));
  await exec(readFileSync(PROC_RANKINGS_FILE, "utf8"));
  await exec(readFileSync(TENDER_DETAIL_FILE, "utf8"));
  await exec(readFileSync(PROC_RISK_INDEXES_FILE, "utf8"));
  await exec(readFileSync(REF_PROCUREMENT_FILE, "utf8"));
  await exec(readFileSync(PROC_SEARCH_FILE, "utf8"));
  await exec(readFileSync(PROC_SECTORS_FILE, "utf8"));
  await exec(readFileSync(PROC_BENCHMARKS_FILE, "utf8"));
  await exec(readFileSync(SECTOR_PEERS_WINDOW_FILE, "utf8"));

  const { rows, years } = readShards();
  let batchId = 0;
  let rowsNew = 0;

  await withTx(async (c) => {
    await c.query("TRUNCATE contracts");
    // Streamed COPY rather than batched multi-row INSERT — 301k rows / 754 MB is
    // what made db:load:pg:cloud slow over the proxy. Encoder round-trip-verified
    // in tests/copy.data.test.ts (contracts carries double precision + integer cols).
    // The generator keeps this lazy: `rows` is already the whole corpus in memory,
    // so materializing `rows.map(contractToRow)` would hold a second copy of it for
    // the duration of the COPY.
    await copyRows(
      c,
      "contracts",
      COLUMN_NAMES,
      (function* () {
        for (const row of rows) yield contractToRow(row);
      })(),
    );

    // Contract-name search index — distinct contractor as they appear in the
    // corpus (covers contractors absent from TR). Rebuilt each load.
    await c.query("TRUNCATE contractor_search");
    await c.query(
      `INSERT INTO contractor_search (eik, name)
       SELECT DISTINCT contractor_eik, contractor_name
       FROM contracts WHERE contractor_eik <> ''`,
    );

    // Buyer-name search index (combined procurement search) — same treatment
    // for the awarder side, plus the per-eik volume precomputed here so
    // search_awarders never touches contracts at query time. Alias rows of
    // the same eik carry the same totals. Rebuilt each load.
    await c.query("TRUNCATE awarder_search");
    await c.query(
      `WITH agg AS (
         SELECT awarder_eik AS eik, count(*) AS contracts,
                coalesce(sum(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS contracts_eur
         FROM contracts WHERE awarder_eik <> '' GROUP BY awarder_eik
       ),
       names AS (
         SELECT DISTINCT awarder_eik AS eik, awarder_name AS name
         FROM contracts WHERE awarder_eik <> '' AND awarder_name <> ''
       )
       INSERT INTO awarder_search (eik, name, contracts, contracts_eur)
       SELECT n.eik, n.name, a.contracts, a.contracts_eur
       FROM names n JOIN agg a USING (eik)`,
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
    // Same detail/summary gate as the other datasets: a normal daily delta is
    // itemised per-contract in recent_updates; a bulk backfill / cold load above
    // the threshold collapses to one summary line instead of 100k+ feed rows.
    const mode = rowsNew > INGEST_SUMMARY_THRESHOLD ? "summary" : "detail";
    await c.query(
      "UPDATE ingest_batches SET rows_new = $1, mode = $2 WHERE id = $3",
      [rowsNew, mode, batchId],
    );
    // Roll into the day-coalesced changelog history (same-day loads accumulate).
    await upsertChangelogDay(c, "shards", rowsNew, rows.length);

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
  });

  // Refresh planner statistics immediately — a freshly TRUNCATE+INSERT'd table
  // carries reltuples=0 and no column histograms until autovacuum happens to
  // run, so the FIRST queries after a load plan blind. (Harmless for correctness
  // — every plan still sorts globally — but it removes the "was it stale stats?"
  // variable and keeps first-hit /api/db/table + search plans honest.)
  await exec("ANALYZE contracts, contractor_search, awarder_search");

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
    await withTx(async (c) => {
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
    await withTx(async (c) => {
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
    });
  }

  // Precomputed aggregates over the freshly-loaded contracts (buyer grand-totals
  // for capture share; sector rank stats; the risk-indexes payload — a
  // full-corpus aggregate too slow to compute per request on Cloud SQL).
  // Refreshed here so they never go stale.
  await exec("REFRESH MATERIALIZED VIEW awarder_totals");
  await exec("REFRESH MATERIALIZED VIEW sector_contractor_stats");
  await exec("REFRESH MATERIALIZED VIEW procurement_risk_indexes_cache");
  // Full-corpus (all-years) caches for the overview / rankings / by-settlement
  // payloads — too slow (~330-530ms) to compute per request; the routes serve
  // these when from/to are both absent (025/031/030).
  await exec("REFRESH MATERIALIZED VIEW procurement_overview_cache");
  await exec("REFRESH MATERIALIZED VIEW procurement_rankings_cache");
  await exec("REFRESH MATERIALIZED VIEW procurement_by_settlement_cache");
  // The awarder K-Index ranking (built by migration 039 in load_tr_pg) is
  // computed FROM this contract corpus, so it must track a contract reload too —
  // otherwise a procurement-only re-ingest leaves the ranking (and the AI
  // summary's topKindexAwarders) reflecting the previous corpus. Guarded on the
  // view existing (a contracts-first load may run before the TR load creates it).
  const hasKindexRanking = await getPool()
    .query("SELECT to_regclass('public.awarder_kindex_ranking') AS t")
    .then((r) => r.rows[0]?.t != null);
  if (hasKindexRanking)
    await exec("REFRESH MATERIALIZED VIEW awarder_kindex_ranking");

  // The buyer risk-grade leaderboard (migration 041) is likewise computed FROM
  // this corpus and must track a contract reload. Same existence guard.
  const hasGradeRanking = await getPool()
    .query("SELECT to_regclass('public.awarder_risk_grade_ranking') AS t")
    .then((r) => r.rows[0]?.t != null);
  if (hasGradeRanking)
    await exec("REFRESH MATERIALIZED VIEW awarder_risk_grade_ranking");

  // Per-scope risk-grade leaderboards (awarder_risk_grade_scoped, migration 041):
  // one ranking per pscope window the UI can request. Shared helper (also called
  // by load_tr_pg + kzk_appeals.ts --apply) so the served leaderboard tracks
  // every ingest that changes its inputs. Guarded on the 041 schema.
  const hasScoped = await getPool()
    .query("SELECT to_regclass('public.awarder_risk_grade_scoped') AS t")
    .then((r) => r.rows[0]?.t != null);
  if (hasScoped && hasGradeRanking) {
    const n = await withClient((c) => rebuildRiskGradeScoped(c));
    console.log(`  risk-grade scoped: ${n} scopes precomputed`);
  }

  // NOTE: appealed_ocids / upheld_ocids (042) are NOT refreshed here — they are
  // defined over tenders × kzk_appeals (not contracts), so a contract reload
  // cannot change their contents. They're kept fresh by load_tenders_pg (which
  // re-runs 042's DROP+CREATE) and kzk_appeals.ts --apply. The contracts_list
  // VIEW that joins them picks up new contracts automatically (it's a view).

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
