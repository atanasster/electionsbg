// Load the geolocated active excise warehouses (data/customs/excise_warehouses.json,
// written by scripts/customs/excise_register.ts) into Postgres (schema:
// 072_excise_warehouses.sql). SERVING loader — never writes JSON back. The
// /customs/warehouses map then fetches excise_warehouses_map() instead of the
// operator register file.
//
// Run: `npm run db:load:excise-warehouses:pg` (local) / `:cloud` (Cloud SQL proxy).

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
const SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/072_excise_warehouses.sql",
);
const INGEST_TRACKING = path.join(
  ROOT,
  "scripts/db/schema/pg/005_ingest_tracking.sql",
);
const SRC = path.join(ROOT, "data/customs/excise_warehouses.json");

interface Warehouse {
  eik: string;
  name: string;
  category: string;
  place: string | null;
  oblast: string | null;
  loc: [number, number] | null;
}

const run = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA, "utf8"));
  await exec(readFileSync(INGEST_TRACKING, "utf8"));

  const file = JSON.parse(readFileSync(SRC, "utf8")) as {
    warehouses: Warehouse[];
  };
  // The serving fn already drops un-geocoded rows; keep them out of the table too
  // so the corpus count == what the map shows.
  const rows = file.warehouses.filter((w) => w.loc);

  await withClient(async (client) => {
    await client.query("BEGIN");
    await client.query("TRUNCATE excise_warehouses RESTART IDENTITY");
    await copyRows(
      client,
      "excise_warehouses",
      ["eik", "name", "category", "place", "oblast", "lng", "lat"],
      (function* () {
        for (const w of rows)
          yield [
            w.eik,
            w.name,
            w.category,
            w.place,
            w.oblast,
            w.loc![0],
            w.loc![1],
          ];
      })(),
    );
    await recordIngestBatch(client, {
      source: "excise_warehouses",
      table: "excise_warehouses",
      // A serial PK can't survive TRUNCATE+reload; key on the row's content.
      keyExpr: "md5(t.eik || ':' || t.place || ':' || t.category)",
      nameExpr: "t.name",
      detailExpr: "t.category || ' · ' || COALESCE(t.place, '—')",
      amountExpr: "NULL::double precision",
      rowsTotal: rows.length,
    });
    await client.query("COMMIT");
  });

  console.log(`excise_warehouses: loaded ${rows.length} geolocated warehouses`);
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
