// Load the ИСУН EU-funds corpus into Postgres so the whole /funds surface is
// DB-served (no GCS static-JSON fetch) — mirrors the procurement PG migration.
//
//   npm run db:load:funds:pg           (needs `npm run db:pg:up` first)
//   npm run db:load:funds:pg:cloud     (targets the Cloud SQL proxy on :5434)
//
// Three targets, all rebuilt from the on-disk data/funds/ shards the ingest
// writes (JSON → PG; never the reverse — see [[feedback_no_json_from_pg]]):
//   • fund_beneficiaries — per-EIK rollup (beneficiaries-by-eik/*.json)
//   • fund_projects      — per-project rows (projects/by-contract/*.json), now
//                          incl. the by-contract DETAIL columns
//   • fund_payloads      — every precomputed page payload verbatim (043 header)
//
// See docs/plans/pg-datasets-roadmap.md §1 (ИСУН EU funds).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROC_DIR } from "./lib/paths";
import {
  exec,
  getPool,
  withClient,
  withTx,
  end,
  isServingDatabase,
  vacuumAfterReload,
} from "./lib/pg";
import { copyRows } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";
import {
  createStageTable,
  addStagePrimaryKey,
  mergeFromStage,
} from "./lib/stage_merge";

const SCHEMA_DIR = path.join(
  PROC_DIR,
  "..",
  "..",
  "scripts",
  "db",
  "schema",
  "pg",
);
const SCHEMA_FILE = path.join(SCHEMA_DIR, "015_funds.sql");
const PROJECTS_SCHEMA_FILE = path.join(SCHEMA_DIR, "016_fund_projects.sql");
const SERVING_SCHEMA_FILE = path.join(SCHEMA_DIR, "043_funds_serving.sql");
// The ЕВРОФОНДОВЕ combined-search fn (§4.1) — depends on fund_projects.
const SEARCH_SCHEMA_FILE = path.join(
  SCHEMA_DIR,
  "086_search_fund_projects.sql",
);
/** `--allow-shrink` — the escape hatch for a corpus that genuinely got smaller. */
const ALLOW_SHRINK = process.argv.includes("--allow-shrink");
const SHRINK_FLOOR = 0.95;

const FUNDS_DIR = path.join(PROC_DIR, "..", "funds");
const BY_EIK_DIR = path.join(FUNDS_DIR, "beneficiaries-by-eik");
const PROJECTS_DIR = path.join(FUNDS_DIR, "projects");
const DERIVED_DIR = path.join(FUNDS_DIR, "derived");
const BY_CONTRACT_DIR = path.join(PROJECTS_DIR, "by-contract");

interface FundLocation {
  kind?: string;
  raw?: string;
  ekatte?: string;
  munis?: string[];
  oblasts?: string[];
  nutsCodes?: string[];
  ambiguousCandidates?: string[];
}

interface FundProject {
  contractNumber: string;
  beneficiaryEik?: string | null;
  beneficiaryName?: string;
  programCode?: string;
  programName?: string;
  title?: string;
  totalEur?: number;
  grantEur?: number;
  ownCofinanceEur?: number;
  paidEur?: number;
  durationMonths?: number;
  status?: string;
  orgType?: string;
  orgKind?: string;
  orgForm?: string;
  hqAddress?: string;
  locationRaw?: string;
  location?: FundLocation;
}

const PROJ_COLS = [
  "contract_number",
  "beneficiary_eik",
  "beneficiary_name",
  "program_code",
  "program_name",
  "title",
  "total_eur",
  "grant_eur",
  "own_cofinance_eur",
  "paid_eur",
  "duration_months",
  "status",
  "org_type",
  "location_raw",
  "ekatte",
  "oblast",
  "org_kind",
  "org_form",
  "hq_address",
  "location_json",
];
const PN = PROJ_COLS.length;

const projRow = (p: FundProject) => [
  p.contractNumber,
  p.beneficiaryEik ?? null,
  p.beneficiaryName ?? null,
  p.programCode ?? null,
  p.programName ?? null,
  p.title ?? null,
  p.totalEur ?? null,
  p.grantEur ?? null,
  p.ownCofinanceEur ?? null,
  p.paidEur ?? null,
  p.durationMonths ?? null,
  p.status ?? null,
  p.orgType ?? null,
  p.locationRaw ?? null,
  p.location?.ekatte ?? null,
  p.location?.oblasts?.[0] ?? null,
  p.orgKind ?? null,
  p.orgForm ?? null,
  p.hqAddress ?? null,
  // Full resolved location object → jsonb, so fund_contract_detail() reproduces
  // the by-contract payload byte-for-content. Verbatim from the source, so the
  // optional sub-fields stay omitted-when-absent exactly as written.
  p.location ? JSON.stringify(p.location) : null,
];

interface Beneficiary {
  eik: string;
  name?: string;
  orgType?: string;
  orgKind?: string;
  orgForm?: string;
  contractCount?: number;
  contractedEur?: number;
  paidEur?: number;
  subUnits?: string[];
}

const COLS = [
  "eik",
  "name",
  "org_type",
  "org_kind",
  "org_form",
  "contract_count",
  "contracted_eur",
  "paid_eur",
  "sub_units",
];
const toRow = (b: Beneficiary) => [
  b.eik,
  b.name ?? null,
  b.orgType ?? null,
  b.orgKind ?? null,
  b.orgForm ?? null,
  b.contractCount ?? null,
  b.contractedEur ?? null,
  b.paidEur ?? null,
  // Sub-unit list → jsonb (text param, implicit assignment cast); null omits it.
  b.subUnits ? JSON.stringify(b.subUnits) : null,
];

// ── fund_payloads sources ─────────────────────────────────────────────────────
// Each precomputed page payload, stored verbatim keyed by (kind, key). Loaded
// straight from the on-disk shards the ingest writes.
interface PayloadRow {
  kind: string;
  key: string;
  text: string; // raw file JSON → cast to jsonb on insert
}

const rd = (abs: string): string | null =>
  existsSync(abs) ? readFileSync(abs, "utf8") : null;

const collectPayloads = (): PayloadRow[] => {
  const rows: PayloadRow[] = [];

  // Singleton payloads (key = '').
  const singles: [string, string][] = [
    ["index", path.join(FUNDS_DIR, "index.json")],
    ["projects-index", path.join(PROJECTS_DIR, "index.json")],
    ["muni-map", path.join(PROJECTS_DIR, "muni-map.json")],
    ["taxonomy", path.join(FUNDS_DIR, "taxonomy.json")],
    ["absorption", path.join(DERIVED_DIR, "absorption.json")],
    ["sankey", path.join(DERIVED_DIR, "sankey.json")],
    ["integrity", path.join(DERIVED_DIR, "integrity.json")],
    ["mp-connected", path.join(DERIVED_DIR, "mp_connected.json")],
    ["political-links", path.join(DERIVED_DIR, "political_links.json")],
    ["confirmed", path.join(FUNDS_DIR, "confirmed.json")],
    ["rrf-context", path.join(FUNDS_DIR, "rrf_context.json")],
    ["themes-index", path.join(DERIVED_DIR, "themes", "index.json")],
    ["procedure-index", path.join(PROJECTS_DIR, "by-procedure", "index.json")],
    ["by-eik-index", path.join(DERIVED_DIR, "by-eik", "index.json")],
    ["per-mp-index", path.join(DERIVED_DIR, "per-mp", "index.json")],
    [
      "political-by-eik-index",
      path.join(DERIVED_DIR, "political-by-eik", "index.json"),
    ],
  ];
  for (const [kind, abs] of singles) {
    const text = rd(abs);
    if (text !== null) rows.push({ kind, key: "", text });
  }

  // Keyed shard dirs: (kind, dir, predicate, key-from-filename).
  const dirs: [
    string,
    string,
    (f: string) => boolean,
    (f: string) => string,
  ][] = [
    [
      "muni-summary",
      path.join(PROJECTS_DIR, "by-muni"),
      (f) => f.endsWith("-summary.json"),
      (f) => f.slice(0, -"-summary.json".length),
    ],
    [
      "program-summary",
      path.join(PROJECTS_DIR, "by-program"),
      (f) => f.endsWith("-summary.json"),
      (f) => f.slice(0, -"-summary.json".length),
    ],
    // One per ИСУН procedure — the grain /funds/procedure/{code} serves. A
    // shard exists for every procedure (2,137), not just the ~985 indexable
    // ones, so the route resolves for any code a contract page links to.
    [
      "procedure",
      path.join(PROJECTS_DIR, "by-procedure"),
      (f) => f.endsWith(".json") && f !== "index.json",
      (f) => f.slice(0, -".json".length),
    ],
    // The procedures under one programme, for the tile on the programme page.
    [
      "procedure-by-program",
      path.join(PROJECTS_DIR, "by-program-procedures"),
      (f) => f.endsWith(".json"),
      (f) => f.slice(0, -".json".length),
    ],
    [
      "geo",
      path.join(PROJECTS_DIR, "by-muni-geo"),
      (f) => f.endsWith(".json"),
      (f) => f.slice(0, -".json".length),
    ],
    // Per-муни "what changed" feed — the last shard still read as static JSON by
    // ai/tools/profile.ts (placeEuProjects). Nothing may read the funds tree off the
    // bucket: bucket:sync EXCLUDES ^funds/.*, so those copies go stale.
    [
      "changes",
      path.join(PROJECTS_DIR, "changes"),
      (f) => f.endsWith(".json") && f !== "index.json",
      (f) => f.slice(0, -".json".length),
    ],
    [
      "integrity-program",
      path.join(DERIVED_DIR, "integrity-by-program"),
      (f) => f.endsWith(".json") && f !== "index.json",
      (f) => f.slice(0, -".json".length),
    ],
    [
      "political-by-eik",
      path.join(DERIVED_DIR, "political-by-eik"),
      (f) => f.endsWith(".json") && f !== "index.json",
      (f) => f.slice(0, -".json".length),
    ],
    [
      "by-eik",
      path.join(DERIVED_DIR, "by-eik"),
      (f) => f.endsWith(".json") && f !== "index.json",
      (f) => f.slice(0, -".json".length),
    ],
    [
      "per-mp",
      path.join(DERIVED_DIR, "per-mp"),
      (f) => f.endsWith(".json") && f !== "index.json",
      (f) => f.slice(0, -".json".length),
    ],
    [
      "theme",
      path.join(DERIVED_DIR, "themes"),
      (f) => f.endsWith(".json") && f !== "index.json",
      (f) => f.slice(0, -".json".length),
    ],
  ];
  for (const [kind, dir, pred, keyFn] of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!pred(f)) continue;
      rows.push({
        kind,
        key: keyFn(f),
        text: readFileSync(path.join(dir, f), "utf8"),
      });
    }
  }

  return rows;
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

/**
 * @param payloadsOnly Skip the beneficiary and project tables and rebuild only
 *   `fund_payloads`.
 *
 *   `fund_beneficiaries` is stage-merged since 2026-08-21 and no longer blocks a
 *   reader, so the flag is NOT about its lock any more. What a `--full` run still
 *   costs is real work for data that may not have moved: it reads ~128k shard
 *   files off disk, and `fund_projects` is still reloaded with `TRUNCATE` +
 *   insert inside one transaction — an AccessExclusiveLock held for the whole
 *   load, against a SERVED table (`fund_contract_detail()` backs
 *   /api/db/fund-contract and the /funds/contract page handler), so the serving
 *   pool's 2 s `lock_timeout` turns every reader in that window into a
 *   55P03 → 500.
 *
 *   So when a change adds only precomputed page payloads — a new
 *   fund_payloads kind, a re-derived shard — and the corpus itself is
 *   untouched, this publishes it without paying either cost. `fund_payloads` is
 *   stage-merged and never blocks a reader.
 *
 *   It is NOT a substitute for the full load after an ИСУН re-ingest: those two
 *   tables would silently keep the previous vintage.
 */
export const loadFundsPg = async (
  payloadsOnly = false,
): Promise<{
  rows: number;
  projects: number;
  payloads: number;
}> => {
  await waitForPg();
  await exec(readFileSync(SCHEMA_FILE, "utf8"));
  await exec(readFileSync(PROJECTS_SCHEMA_FILE, "utf8"));
  await exec(readFileSync(SERVING_SCHEMA_FILE, "utf8"));
  await exec(readFileSync(SEARCH_SCHEMA_FILE, "utf8"));
  // Changelog tracking tables (idempotent; also present via load_pg's 005).
  await exec(
    readFileSync(path.join(SCHEMA_DIR, "005_ingest_tracking.sql"), "utf8"),
  );

  const files = payloadsOnly
    ? []
    : readdirSync(BY_EIK_DIR).filter((f) => f.endsWith(".json"));
  const rows: Beneficiary[] = [];
  for (const f of files) {
    const b = JSON.parse(
      readFileSync(path.join(BY_EIK_DIR, f), "utf8"),
    ) as Beneficiary;
    if (b?.eik) rows.push(b);
  }

  // Stage-merged, NOT `TRUNCATE` + insert. This table is SERVED —
  // `fund_beneficiary_detail()` backs /api/db/fund-beneficiary — and TRUNCATE
  // holds an AccessExclusiveLock until COMMIT, i.e. for the whole reload, so the
  // serving pool's 2 s `lock_timeout` (functions/index.js) turned every reader in
  // that window into a 55P03 → 500. (The 250 s measured on prod 2026-08-21 is the
  // WHOLE `--full` step — beneficiaries, projects and payloads — so this table's
  // share of it was never isolated; the lock was real, its duration is unmeasured.)
  // The merge takes RowExclusiveLock only, which does not conflict with the
  // AccessShare a SELECT needs, so readers serve the previous vintage throughout
  // the build and flip at the merge COMMIT. Same pattern `fund_payloads` below
  // has always used, and the one stage_merge.ts exists for.
  //
  // `addStagePrimaryKey` REPLACES the old `ON CONFLICT (eik) DO NOTHING`, and the
  // change of behaviour is deliberate: a duplicate EIK now fails the load loudly
  // instead of being silently dropped. `eik` is read from each shard's CONTENT,
  // not its filename, so a mis-written shard could collide — which is a corpus
  // defect worth stopping for, not one to publish a short table over.
  const beneficiarySpec = {
    table: "fund_beneficiaries",
    source: "fund_beneficiaries_stage",
    keys: ["eik"],
    cols: COLS,
  };
  if (!payloadsOnly)
    await withTx(async (c) => {
      // A shrink guard the TRUNCATE form never needed a NAME for, because it
      // failed the same way: BY_EIK_DIR is gitignored host state republished by
      // an rmSync + re-write, so a half-written tree is a normal accident. The
      // merge's own parity check cannot catch it — after upsert-all +
      // delete-absent, live equals staged, so an empty stage passes `0 == 0`
      // having just deleted the served corpus. Same 0.95 floor and same escape
      // hatch as load_budget_pg / load_budget_muni_pg / load_adfi_pg.
      const live = Number(
        (
          await c.query<{ n: string }>(
            "SELECT count(*) AS n FROM fund_beneficiaries",
          )
        ).rows[0].n,
      );
      if (!ALLOW_SHRINK && live > 0 && rows.length < live * SHRINK_FLOOR)
        throw new Error(
          `fund_beneficiaries: refusing to shrink ${live} → ${rows.length} row(s) ` +
            `(floor ${SHRINK_FLOOR * 100}%). Usually a partial ${BY_EIK_DIR} tree; ` +
            "pass --allow-shrink if the corpus really did shrink.",
        );
      await createStageTable(c, beneficiarySpec);
      // Lazy — copyRows consumes the iterable in order, so the corpus is never
      // materialized a second time as rendered rows.
      await copyRows(
        c,
        beneficiarySpec.source,
        beneficiarySpec.cols,
        (function* () {
          for (const b of rows) yield toRow(b);
        })(),
      );
      await addStagePrimaryKey(c, beneficiarySpec);
      await mergeFromStage(c, beneficiarySpec);
      await c.query(`DROP TABLE IF EXISTS ${beneficiarySpec.source}`);
    });

  // Still vacuumed after a stage MERGE, not only after a TRUNCATE: the merge's
  // upsert and anti-join delete leave dead tuples that neither autovacuum
  // threshold reaches (the 20% dead-tuple fraction is never crossed, and the
  // insert-threshold pass fires mid-chain under a held-back xmin horizon, marks
  // nothing and resets its counter). `interreg_partners` is the worked example
  // in CLAUDE.md — 130 of 474 pages all-visible after an ordinary stage-merged
  // load, which broke funds_fit.data.test.ts's buffer ceiling. Vacuumed HERE, under the guard
  // that actually reloaded it, rather than down in the projects block below: that
  // block additionally requires `existsSync(BY_CONTRACT_DIR)`, and by-contract is
  // gitignored — so on a fresh clone this table was emptied and never vacuumed, with
  // its own gate then blaming a `vacuumAfterReload` call that was already there.
  // A table's vacuum must not be conditioned on a different table's input existing.
  if (!payloadsOnly) await vacuumAfterReload("fund_beneficiaries");

  // Per-project table (by-contract shards — one project per file).
  let projects = 0;
  if (!payloadsOnly && existsSync(BY_CONTRACT_DIR)) {
    const pfiles = readdirSync(BY_CONTRACT_DIR).filter((f) =>
      f.endsWith(".json"),
    );
    const projRows: FundProject[] = [];
    for (const f of pfiles) {
      const p = JSON.parse(
        readFileSync(path.join(BY_CONTRACT_DIR, f), "utf8"),
      ) as FundProject;
      if (p?.contractNumber) projRows.push(p);
    }
    projects = projRows.length;
    const PBATCH = 500; // 500 × 20 cols = 10k params (< 65535)
    await withClient(async (c) => {
      await c.query("BEGIN");
      await c.query("TRUNCATE fund_projects");
      const insertCols = PROJ_COLS.join(", ");
      for (let i = 0; i < projRows.length; i += PBATCH) {
        const batch = projRows.slice(i, i + PBATCH);
        const values = batch
          .map(
            (_, r) =>
              `(${PROJ_COLS.map((_, col) => `$${r * PN + col + 1}`).join(",")})`,
          )
          .join(",");
        await c.query(
          `INSERT INTO fund_projects (${insertCols}) VALUES ${values}
           ON CONFLICT (contract_number) DO NOTHING`,
          batch.flatMap(projRow),
        );
      }
      // "What changed" changelog for EU-fund projects — atomic with the load.
      await recordIngestBatch(c, {
        source: "fund_project",
        table: "fund_projects",
        keyExpr: "t.contract_number",
        nameExpr: "t.beneficiary_name",
        detailExpr: "t.title",
        amountExpr: "t.total_eur::double precision",
        rowsTotal: projRows.length,
      });
      await c.query("COMMIT");
    });

    // Rebuilt by TRUNCATE + insert inside ONE transaction, which leaves an EMPTY
    // visibility map that autovacuum will never fill (see `vacuumAfterReload`).
    // Without this, `funds_fit_basis()` — called on every /funds view — plans its
    // `count(*) FROM fund_projects` as a Seq Scan over all 8,780 pages instead
    // of a 78-page index-only scan, and the funds-fit buffer ceiling fails.
    // Outside the transactions above: VACUUM cannot run in a transaction block.
    // (fund_beneficiaries is vacuumed at its own reload above, not here.)
    await vacuumAfterReload("fund_projects");
  }

  // Precomputed page payloads (verbatim, keyed by kind+key).
  //
  // Built into an UNLOGGED stage twin and merged, NOT `TRUNCATE` + insert:
  // every /funds page reads this table, and TRUNCATE holds an
  // AccessExclusiveLock for the whole rebuild, so the serving pool's 2 s
  // `lock_timeout` turns every concurrent reader into a 55P03 → 500. That is
  // the exact failure documented in scripts/db/lib/stage_merge.ts. The procedure
  // grain roughly doubled this load (2,181 → 4,318 payloads, 22 → 36 MB), which
  // doubles a window that should not exist at all.
  //
  // This block keeps a batched INSERT rather than the `copyRows` the
  // beneficiaries block above uses, and the difference is deliberate: payloads
  // are FEW and LARGE (≈3.6k rows, ~36 MB of jsonb) where beneficiaries are many
  // and small, so the per-row framing COPY saves buys little here while a modest
  // batch keeps any single query's parameter payload bounded.
  const payloadRows = collectPayloads();
  const PLBATCH = 200; // payloads can be tens of KB — keep the query modest
  const payloadSpec = {
    table: "fund_payloads",
    source: "fund_payloads_stage",
    keys: ["kind", "key"],
    cols: ["kind", "key", "payload"],
  };
  await withClient(async (c) => {
    await c.query("BEGIN");
    await createStageTable(c, payloadSpec);
    for (let i = 0; i < payloadRows.length; i += PLBATCH) {
      const batch = payloadRows.slice(i, i + PLBATCH);
      const values = batch
        .map((_, r) => `($${r * 3 + 1},$${r * 3 + 2},$${r * 3 + 3}::jsonb)`)
        .join(",");
      // No `ON CONFLICT DO NOTHING`: createStageTable copies no constraints, so
      // the stage has no unique index at insert time and the clause could never
      // fire — it read as a duplicate-tolerance guarantee it did not provide.
      // addStagePrimaryKey below is the real (and loud) duplicate check.
      await c.query(
        `INSERT INTO fund_payloads_stage (kind, key, payload) VALUES ${values}`,
        batch.flatMap((p) => [p.kind, p.key, p.text]),
      );
    }
    await addStagePrimaryKey(c, payloadSpec);
    await mergeFromStage(c, payloadSpec);
    await c.query("DROP TABLE IF EXISTS fund_payloads_stage");
    await c.query("COMMIT");
  });

  // Refresh the cross-corpus (ЗОП × ИСУН) leaderboard cache (migration 077,
  // created + applied by load_pg). The funds side just changed, so the cache
  // must track this reload — otherwise the /funds "договори и грантове" tile
  // reflects the previous beneficiary corpus. Guarded on the matview + the
  // procurement `contracts` relation both existing (a funds-only load against a
  // DB where load_pg never ran has neither).
  // Reads fund_projects, which --payloads-only did not touch.
  const canRefreshDual =
    !payloadsOnly &&
    (await getPool()
      .query(
        `SELECT to_regclass('public.dual_corpus_rankings_cache') AS mv,
              to_regclass('public.contracts') AS c`,
      )
      .then((r) => r.rows[0]?.mv != null && r.rows[0]?.c != null));
  if (canRefreshDual)
    await exec("REFRESH MATERIALIZED VIEW dual_corpus_rankings_cache");

  // The /funds hub's stat cache (145) is deliberately NOT applied here, though this loader
  // rebuilds its primary input. `CREATE MATERIALIZED VIEW` resolves its query at creation, and
  // 145 needs `canon_oblast` (143) — which lands one step LATER in `db:refresh`, so applying it
  // here failed with `function canon_oblast(text) does not exist` and rolled back a 57-step
  // chain at step 10. Its applier is `load_funds_fit_pg.ts`; see 145's header for the cycle.

  return { rows: rows.length, projects, payloads: payloadRows.length };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!existsSync(BY_EIK_DIR)) {
    console.error(
      `No funds data at ${BY_EIK_DIR} — run the ИСУН ingest first.`,
    );
    process.exit(1);
  }
  const payloadsOnly = process.argv.includes("--payloads-only");
  // On Cloud SQL, refuse to GUESS the scope.
  //
  // A full load re-reads ~128k shard files and still TRUNCATEs fund_projects
  // inside one transaction — an AccessExclusiveLock held for the whole load,
  // against a served table, so every reader in that window gets a 55P03 and a
  // 500. (fund_beneficiaries is stage-merged since 2026-08-21 and no longer
  // blocks; only the projects half of the old outage is left.) Defaulting to it
  // is how an unnoticed flag becomes an outage: `npm run
  // db:load:funds:pg:cloud -- --payloads-only` used to nest a second `npm run`,
  // which swallows `--` args, so the flag vanished and the full load ran
  // anyway. The script now demands the intent in writing.
  if (
    isServingDatabase() &&
    !payloadsOnly &&
    !process.argv.includes("--full")
  ) {
    console.error(
      "Refusing to guess the scope of a Cloud SQL load.\n\n" +
        "  --payloads-only   rebuild fund_payloads only (stage-merged, seconds,\n" +
        "                    never blocks a reader). Correct when only precomputed\n" +
        "                    page payloads changed.\n" +
        "  --full            also reload fund_beneficiaries + fund_projects.\n" +
        "                    Minutes of shard reads; /api/db/fund-contract returns\n" +
        "                    500 while fund_projects reloads (still TRUNCATE-based).\n" +
        "                    fund_beneficiaries is stage-merged and does NOT block.\n" +
        "                    Required after an ИСУН re-ingest, when those tables\n" +
        "                    actually moved.",
    );
    process.exit(1);
  }
  const t0 = Date.now();
  loadFundsPg(payloadsOnly)
    .then(async ({ rows, projects, payloads }) => {
      console.log(
        `loaded ${rows} fund beneficiaries + ${projects} projects + ${payloads} payloads → Postgres in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
