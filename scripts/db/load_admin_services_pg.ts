// Load the Административен регистър (ИИСДА) services catalogue into Postgres
// (schema: 068_admin_services.sql). SERVING loader — reads the scraped
// data/administration/services_catalog.json (written by
// scripts/administration/fetch_services.ts) and COPYs it into admin_services;
// never writes JSON back. Served by the DbDataTable engine as resource
// `admin_services`.
//
// Run: `npm run db:load:admin-services:pg` (local) / `:cloud` (Cloud SQL proxy).

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
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/068_admin_services.sql");
const INGEST_TRACKING = path.join(
  ROOT,
  "scripts/db/schema/pg/005_ingest_tracking.sql",
);
const CATALOG = path.join(ROOT, "data/administration/services_catalog.json");

interface Svc {
  id: string;
  name: string;
  tier: string;
}

const run = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA, "utf8"));
  await exec(readFileSync(INGEST_TRACKING, "utf8"));

  const cat = JSON.parse(readFileSync(CATALOG, "utf8")) as { services: Svc[] };
  const rows = cat.services;

  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE admin_services RESTART IDENTITY");
    await copyRows(
      c,
      "admin_services",
      ["service_id", "name", "tier"],
      (function* () {
        for (const s of rows) yield [s.id, s.name, s.tier];
      })(),
    );
    // recent_updates changelog.
    await recordIngestBatch(c, {
      source: "admin_services",
      table: "admin_services",
      keyExpr: "t.service_id || ':' || t.tier",
      nameExpr: "t.name",
      detailExpr: "t.tier",
      amountExpr: "NULL::double precision",
      rowsTotal: rows.length,
    });
    await c.query("COMMIT");
    console.log(`admin_services→PG: ${rows.length} rows`);
  });
  await end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
