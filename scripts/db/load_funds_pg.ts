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
import { exec, getPool, withClient, end } from "./lib/pg";
import { recordIngestBatch } from "./lib/ingest_changelog";

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
const N = COLS.length;
const BATCH = 1000; // 1000 × 9 cols = 9k params (< 65535)

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

export const loadFundsPg = async (): Promise<{
  rows: number;
  projects: number;
  payloads: number;
}> => {
  await waitForPg();
  await exec(readFileSync(SCHEMA_FILE, "utf8"));
  await exec(readFileSync(PROJECTS_SCHEMA_FILE, "utf8"));
  await exec(readFileSync(SERVING_SCHEMA_FILE, "utf8"));
  // Changelog tracking tables (idempotent; also present via load_pg's 005).
  await exec(
    readFileSync(path.join(SCHEMA_DIR, "005_ingest_tracking.sql"), "utf8"),
  );

  const files = readdirSync(BY_EIK_DIR).filter((f) => f.endsWith(".json"));
  const rows: Beneficiary[] = [];
  for (const f of files) {
    const b = JSON.parse(
      readFileSync(path.join(BY_EIK_DIR, f), "utf8"),
    ) as Beneficiary;
    if (b?.eik) rows.push(b);
  }

  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE fund_beneficiaries");
    const insertCols = COLS.join(", ");
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch
        .map(
          (_, r) =>
            `(${COLS.map((_, col) => `$${r * N + col + 1}`).join(",")})`,
        )
        .join(",");
      await c.query(
        `INSERT INTO fund_beneficiaries (${insertCols}) VALUES ${values}
         ON CONFLICT (eik) DO NOTHING`,
        batch.flatMap(toRow),
      );
    }
    await c.query("COMMIT");
  });

  // Per-project table (by-contract shards — one project per file).
  let projects = 0;
  if (existsSync(BY_CONTRACT_DIR)) {
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
  }

  // Precomputed page payloads (verbatim, keyed by kind+key).
  const payloadRows = collectPayloads();
  const PLBATCH = 200; // payloads can be tens of KB — keep the query modest
  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE fund_payloads");
    for (let i = 0; i < payloadRows.length; i += PLBATCH) {
      const batch = payloadRows.slice(i, i + PLBATCH);
      const values = batch
        .map((_, r) => `($${r * 3 + 1},$${r * 3 + 2},$${r * 3 + 3}::jsonb)`)
        .join(",");
      await c.query(
        `INSERT INTO fund_payloads (kind, key, payload) VALUES ${values}
         ON CONFLICT (kind, key) DO NOTHING`,
        batch.flatMap((p) => [p.kind, p.key, p.text]),
      );
    }
    await c.query("COMMIT");
  });

  // Refresh the cross-corpus (ЗОП × ИСУН) leaderboard cache (migration 077,
  // created + applied by load_pg). The funds side just changed, so the cache
  // must track this reload — otherwise the /funds "договори и грантове" tile
  // reflects the previous beneficiary corpus. Guarded on the matview + the
  // procurement `contracts` relation both existing (a funds-only load against a
  // DB where load_pg never ran has neither).
  const canRefreshDual = await getPool()
    .query(
      `SELECT to_regclass('public.dual_corpus_rankings_cache') AS mv,
              to_regclass('public.contracts') AS c`,
    )
    .then((r) => r.rows[0]?.mv != null && r.rows[0]?.c != null);
  if (canRefreshDual)
    await exec("REFRESH MATERIALIZED VIEW dual_corpus_rankings_cache");

  return { rows: rows.length, projects, payloads: payloadRows.length };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!existsSync(BY_EIK_DIR)) {
    console.error(
      `No funds data at ${BY_EIK_DIR} — run the ИСУН ingest first.`,
    );
    process.exit(1);
  }
  const t0 = Date.now();
  loadFundsPg()
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
