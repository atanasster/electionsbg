// Load magistrates-with-declared-companies + their informational financials
// (data/judiciary/magistrate_holdings.json, written by
// scripts/judiciary/__write_magistrate_holdings.ts) into Postgres (schema:
// 070_magistrates.sql). SERVING loader — never writes JSON back. The person /
// company / search / judiciary surfaces then query by name / eik instead of
// downloading the whole holdings + company-index + search JSON.
//
// Run: `npm run db:load:magistrates:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, withClient, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";
// Shared with the client hook (usePersonMagistrateHoldings) so the /person lookup key
// can never drift — see the module comment. tsx resolves the @/ alias in scripts.
import { normName } from "@/data/judiciary/normName";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/070_magistrates.sql");
// The magistrate→politician bridge function. Depends on 008 (company_politicians,
// officer_name_counts, tr_officers) — which db:refresh loads before magistrates — and
// on the tables 070 creates just above, so it is applied here after the schema.
const CONNECTIONS_FN = path.join(
  ROOT,
  "scripts/db/schema/pg/071_magistrate_connections.sql",
);
const INGEST_TRACKING = path.join(
  ROOT,
  "scripts/db/schema/pg/005_ingest_tracking.sql",
);
const SRC = path.join(ROOT, "data/judiciary/magistrate_holdings.json");

interface Company {
  name: string;
  stakePct: number | null;
  eik: string | null;
  eikAmbiguous: boolean;
}
interface Financials {
  bankCashLv: number;
  securitiesLv: number;
  realEstateCount: number;
}
interface Magistrate {
  name: string;
  position: string | null;
  court: string | null;
  companies: Company[];
  financials?: Financials;
}

const run = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA, "utf8"));
  await exec(readFileSync(INGEST_TRACKING, "utf8"));
  // Best-effort: the bridge function needs the connections tables (008). In a full
  // db:refresh they exist; on a bare magistrate-only load they may not, so don't let
  // a missing dependency abort the data load — the route degrades to empty.
  try {
    await exec(readFileSync(CONNECTIONS_FN, "utf8"));
    // company_officer_counts is created empty by 071; populate it from the freshly
    // loaded tr_officers so the bridge's hub-company guard has current counts.
    await exec("REFRESH MATERIALIZED VIEW company_officer_counts");
  } catch (e) {
    console.warn(
      `magistrate: skipped 071 bridge fn (connections tables not present yet): ${
        (e as Error).message
      }`,
    );
  }

  const file = JSON.parse(readFileSync(SRC, "utf8")) as {
    year: number;
    stats: { magistratesScanned: number };
    magistrates: Magistrate[];
  };
  const ms = file.magistrates;

  await withClient(async (client) => {
    await client.query("BEGIN");
    await client.query("TRUNCATE magistrate CASCADE");
    await copyRows(
      client,
      "magistrate",
      [
        "name",
        "name_norm",
        "position",
        "court",
        "decl_year",
        "company_count",
        "bank_cash_lv",
        "securities_lv",
        "real_estate_count",
      ],
      (function* () {
        for (const m of ms)
          yield [
            m.name,
            normName(m.name),
            m.position,
            m.court,
            file.year,
            m.companies.length,
            m.financials?.bankCashLv ?? null,
            m.financials?.securitiesLv ?? null,
            m.financials?.realEstateCount ?? null,
          ];
      })(),
    );
    await copyRows(
      client,
      "magistrate_company",
      ["magistrate_name", "name", "stake_pct", "eik", "eik_ambiguous", "ord"],
      (function* () {
        for (const m of ms)
          for (let i = 0; i < m.companies.length; i++) {
            const c = m.companies[i];
            yield [m.name, c.name, c.stakePct, c.eik, c.eikAmbiguous, i];
          }
      })(),
    );
    await recordIngestBatch(client, {
      source: "magistrate",
      table: "magistrate",
      keyExpr: "t.name",
      nameExpr: "t.name",
      detailExpr:
        "coalesce(t.court, '') || ' · ' || t.company_count || ' дружества'",
      amountExpr: "NULL::double precision",
      // rows_total carries the scanned corpus (3.1k) so the tile can show
      // "N of M scanned"; rows_new is the real magistrate delta.
      rowsTotal: file.stats.magistratesScanned,
    });
    await client.query("COMMIT");
  });

  console.log(
    `magistrate: loaded ${ms.length} magistrates, ${ms.reduce(
      (s, m) => s + m.companies.length,
      0,
    )} companies`,
  );
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
