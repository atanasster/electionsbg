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
const BY_EIK_DIR = path.join(PROC_DIR, "..", "funds", "beneficiaries-by-eik");

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

export const loadFundsPg = async (): Promise<{ rows: number }> => {
  await waitForPg();
  await exec(readFileSync(SCHEMA_FILE, "utf8"));

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

  return { rows: rows.length };
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
    .then(async ({ rows }) => {
      console.log(
        `loaded ${rows} fund beneficiaries → Postgres in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
