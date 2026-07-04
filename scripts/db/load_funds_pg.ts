// Load the ИСУН EU-funds per-beneficiary aggregates into Postgres so the DB
// company page's "EU grants" section is DB-only. Full rebuild from the per-EIK
// shards (data/funds/beneficiaries-by-eik/<eik>.json).
//
//   npm run db:load:funds:pg     (needs `npm run db:pg:up` first)
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
const BY_EIK_DIR = path.join(PROC_DIR, "..", "funds", "beneficiaries-by-eik");
const BY_CONTRACT_DIR = path.join(
  PROC_DIR,
  "..",
  "funds",
  "projects",
  "by-contract",
);

interface FundProject {
  contractNumber: string;
  beneficiaryEik?: string;
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
  locationRaw?: string;
  location?: { ekatte?: string; oblasts?: string[] };
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
];
const N = COLS.length;
const BATCH = 1000; // 1000 × 8 cols = 8k params (< 65535)

const toRow = (b: Beneficiary) => [
  b.eik,
  b.name ?? null,
  b.orgType ?? null,
  b.orgKind ?? null,
  b.orgForm ?? null,
  b.contractCount ?? null,
  b.contractedEur ?? null,
  b.paidEur ?? null,
];

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
}> => {
  await waitForPg();
  await exec(readFileSync(SCHEMA_FILE, "utf8"));
  await exec(readFileSync(PROJECTS_SCHEMA_FILE, "utf8"));
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
    await withClient(async (c) => {
      await c.query("BEGIN");
      await c.query("TRUNCATE fund_projects");
      const insertCols = PROJ_COLS.join(", ");
      for (let i = 0; i < projRows.length; i += BATCH) {
        const batch = projRows.slice(i, i + BATCH);
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

  return { rows: rows.length, projects };
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
    .then(async ({ rows, projects }) => {
      console.log(
        `loaded ${rows} fund beneficiaries + ${projects} projects → Postgres in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
