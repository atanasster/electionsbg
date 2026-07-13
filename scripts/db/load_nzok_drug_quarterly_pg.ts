// Load the per-INN quarterly drug-reimbursement series into Postgres so the health
// pack can serve the multi-quarter drug TREND DB-side (national curve + top-molecule
// series + a searchable per-INN drill-down).
//
//   npm run db:load:nzok-drug-quarterly:pg          (needs `npm run db:pg:up`)
//   npm run db:load:nzok-drug-quarterly:pg:cloud     (Cloud SQL proxy :5434)
//
// Source = data/budget/nzok/drug_quarterly.json (scripts/nzok/write_drug_quarterly.ts).
// Wires into recent_updates via recordIngestBatch, per [[pg-changelog-required]].

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, withClient, end } from "./lib/pg";
import { recordIngestBatch } from "./lib/ingest_changelog";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const SCHEMA_FILE = path.join(
  REPO,
  "scripts/db/schema/pg/066_nzok_drug_quarterly.sql",
);
const DATA_FILE = path.join(REPO, "data/budget/nzok/drug_quarterly.json");

interface Row {
  inn: string;
  atc: string;
  quarter: string;
  eur: number;
}
const COLS = ["inn", "atc", "quarter", "eur"] as const;

const main = async (): Promise<void> => {
  if (!existsSync(DATA_FILE))
    throw new Error(
      `${DATA_FILE} missing — regenerate with: npx tsx scripts/nzok/write_drug_quarterly.ts`,
    );
  const j = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  if (!Array.isArray(j.rows) || j.rows.length === 0)
    throw new Error(`${DATA_FILE} has no rows[] — shape changed?`);
  const rows: Row[] = j.rows.map((r: Record<string, unknown>) => ({
    inn: String(r.inn),
    atc: r.atc == null ? "" : String(r.atc),
    quarter: String(r.quarter),
    eur: Number(r.eur),
  }));
  const eurSum = Math.round(rows.reduce((a, r) => a + r.eur, 0));

  await exec(readFileSync(SCHEMA_FILE, "utf8"));

  const N = COLS.length;
  const BATCH = Math.max(1, Math.floor(60000 / N));
  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE nzok_drug_quarterly");
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch
        .map(
          (_, r) =>
            `(${COLS.map((_, col) => `$${r * N + col + 1}`).join(",")})`,
        )
        .join(",");
      await c.query(
        `INSERT INTO nzok_drug_quarterly (${COLS.join(",")}) VALUES ${values}
         ON CONFLICT (inn, quarter) DO NOTHING`,
        batch.flatMap((row) => COLS.map((col) => row[col])),
      );
    }
    // Post-load reconciliation — a same-(inn,quarter) dup (ON CONFLICT DO NOTHING)
    // or a dropped row would silently shrink the corpus.
    const { rows: chk } = await c.query<{ n: number; s: string }>(
      `SELECT count(*)::int AS n, round(sum(eur))::bigint AS s FROM nzok_drug_quarterly`,
    );
    if (chk[0].n !== rows.length || Number(chk[0].s) !== eurSum)
      throw new Error(
        `post-load mismatch: db ${chk[0].n}/${chk[0].s} vs collected ${rows.length}/${eurSum}`,
      );
    // "What changed" changelog — natural key (inn, quarter) so a reload dedups.
    await recordIngestBatch(c, {
      source: "nzok_drug_quarterly",
      table: "nzok_drug_quarterly",
      keyExpr: "t.inn || '|' || t.quarter",
      nameExpr: "t.inn",
      detailExpr: "t.quarter",
      amountExpr: "t.eur::double precision",
      rowsTotal: rows.length,
    });
    await c.query("COMMIT");
  });

  const quarters = new Set(rows.map((r) => r.quarter)).size;
  const inns = new Set(rows.map((r) => r.inn)).size;
  console.log(
    `Loaded ${rows.length} (inn×quarter) rows · ${quarters} quarters · ${inns} INN · €${eurSum.toLocaleString("en")} total`,
  );
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
