// Load the per-court натовареност (data/judiciary/court_load.json, written by
// scripts/judiciary/__write_court_load.ts) into Postgres (schema:
// 069_court_load.sql). SERVING loader — never writes JSON back. The /judiciary map
// then fetches one year at a time from court_load_year() instead of the 531 KB
// all-years JSON.
//
// Run: `npm run db:load:court-load:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, withClient, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/069_court_load.sql");
const INGEST_TRACKING = path.join(
  ROOT,
  "scripts/db/schema/pg/005_ingest_tracking.sql",
);
const SRC = path.join(ROOT, "data/judiciary/court_load.json");

interface Court {
  name: string;
  tier: string;
  place: string | null;
  loc: [number, number] | null;
  judges: number;
  personMonths: number;
  filedPerMonth: number;
  considerPerMonth: number;
  resolvedPerMonth: number;
}
interface Year {
  year: number;
  courts: Court[];
}

const run = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA, "utf8"));
  await exec(readFileSync(INGEST_TRACKING, "utf8"));

  const file = JSON.parse(readFileSync(SRC, "utf8")) as { years: Year[] };
  const rows: Array<[number, Court]> = [];
  for (const y of file.years) for (const c of y.courts) rows.push([y.year, c]);

  await withClient(async (client) => {
    await client.query("BEGIN");
    await client.query("TRUNCATE court_load");
    await copyRows(
      client,
      "court_load",
      [
        "year",
        "name",
        "tier",
        "place",
        "lng",
        "lat",
        "judges",
        "person_months",
        "filed_per_month",
        "consider_per_month",
        "resolved_per_month",
      ],
      (function* () {
        for (const [year, c] of rows)
          yield [
            year,
            c.name,
            c.tier,
            c.place,
            c.loc ? c.loc[0] : null,
            c.loc ? c.loc[1] : null,
            c.judges,
            c.personMonths,
            c.filedPerMonth,
            c.considerPerMonth,
            c.resolvedPerMonth,
          ];
      })(),
    );
    await recordIngestBatch(client, {
      source: "court_load",
      table: "court_load",
      keyExpr: "t.year || ':' || t.name",
      nameExpr: "t.name",
      detailExpr: "t.tier || ' · ' || t.year",
      amountExpr: "NULL::double precision",
      rowsTotal: rows.length,
    });
    await client.query("COMMIT");
  });

  console.log(`court_load: loaded ${rows.length} court-year rows`);
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
