// Load НЗОК clinical-pathway tariffs (data/budget/nzok/pathway_tariffs.json,
// written by scripts/nzok/write_pathway_tariffs.ts) into nzok_pathway_tariffs
// (migration 059) — the price factor behind the pathway spend tree and the
// case-mix expected-vs-actual signal.
//
// The JSON — and therefore this table — is EMPTY on any machine where the fetch
// hasn't run from Bulgarian egress (nhif.bg is IP-gated). Migration 059's
// functions all LEFT JOIN / return NULL when empty, so the site degrades to
// volume-only until the tariffs land; this loader is a no-op-safe idempotent
// upsert of whatever the writer produced.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, withClient, end } from "./lib/pg";
import { recordIngestBatch } from "./lib/ingest_changelog";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const SCHEMA_FILE = path.join(
  REPO,
  "scripts/db/schema/pg/059_nzok_pathway_tariffs.sql",
);
const JSON_FILE = path.join(REPO, "data/budget/nzok/pathway_tariffs.json");

interface TariffFile {
  meta: { nrdYear: number; count: number };
  tariffs: Record<string, number>;
}

const main = async (): Promise<void> => {
  // Always apply the migration (creates the table + functions even with no data).
  await exec(readFileSync(SCHEMA_FILE, "utf8"));

  if (!existsSync(JSON_FILE)) {
    console.log(
      `No ${JSON_FILE} — migration 059 applied, table left empty (run --pathway-tariffs from BG egress to populate).`,
    );
    await end();
    return;
  }

  const data = JSON.parse(readFileSync(JSON_FILE, "utf8")) as TariffFile;
  const year = data.meta.nrdYear;
  const rows: unknown[][] = Object.entries(data.tariffs).map(
    ([code, price]) => [code, year, price],
  );

  await withClient(async (c) => {
    await c.query("BEGIN");
    // Replace this NRD year's rows only, so multiple years can coexist.
    await c.query("DELETE FROM nzok_pathway_tariffs WHERE nrd_year = $1", [
      year,
    ]);
    if (rows.length) {
      const values = rows
        .map((_, r) => `($${r * 3 + 1},$${r * 3 + 2},$${r * 3 + 3})`)
        .join(",");
      await c.query(
        `INSERT INTO nzok_pathway_tariffs (procedure, nrd_year, price_eur) VALUES ${values}`,
        rows.flat(),
      );
    }
    const { rows: chk } = await c.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM nzok_pathway_tariffs WHERE nrd_year = $1",
      [year],
    );
    if (chk[0].n !== rows.length)
      throw new Error(`post-load mismatch: ${chk[0].n} vs ${rows.length}`);

    await recordIngestBatch(c, {
      source: "nzok_pathway_tariffs",
      table: "nzok_pathway_tariffs",
      keyExpr: "t.nrd_year::text || '|' || t.procedure",
      nameExpr: "t.procedure",
      detailExpr: "t.procedure",
      amountExpr: "t.price_eur",
      rowsTotal: rows.length,
    });
    await c.query("COMMIT");
  });

  console.log(
    `Loaded nzok_pathway_tariffs: ${rows.length} pathways · НРД ${year}`,
  );
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
