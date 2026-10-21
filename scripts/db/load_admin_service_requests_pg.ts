// Load МЕУ's еФорми request volumes (migration 201) from the COMMITTED
// data/administration/eforms_requests.json (scripts/administration/fetch_eforms.ts). Pure
// load: no network, so it runs on a fresh clone.
//
//   npm run db:load:admin-service-requests:pg          # local
//   npm run db:load:admin-service-requests:pg:cloud    # Cloud SQL proxy
//
// The tables are small (~3k rows) and nothing serves them yet, so the reload is TRUNCATE + COPY
// in one transaction, followed by the VACUUM every truncate-reload needs for its visibility map.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEformsSnapshot } from "../administration/eforms";
import { copyRows } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";
import { end, exec, vacuumAfterReload, withTx } from "./lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA_DIR = path.join(ROOT, "scripts/db/schema/pg");
const SNAPSHOT = path.join(ROOT, "data/administration/eforms_requests.json");

const run = async (): Promise<void> => {
  await exec(
    readFileSync(path.join(SCHEMA_DIR, "005_ingest_tracking.sql"), "utf8"),
  );
  await exec(
    readFileSync(
      path.join(SCHEMA_DIR, "201_admin_service_requests.sql"),
      "utf8",
    ),
  );

  const snap = parseEformsSnapshot(readFileSync(SNAPSHOT, "utf8"));
  if (!snap.months.length)
    throw new Error(
      `${SNAPSHOT} holds no months — refusing to empty the table`,
    );
  const rowCount = snap.months.reduce((n, m) => n + m.rows.length, 0);

  await withTx(async (c) => {
    await c.query(
      "TRUNCATE admin_service_requests, admin_service_requests_month",
    );
    await copyRows(
      c,
      "admin_service_requests_month",
      [
        "period",
        "resource_uri",
        "published_at",
        "service_count",
        "request_total",
      ],
      (function* () {
        for (const m of snap.months)
          yield [
            `${m.period}-01`,
            m.resourceUri,
            m.updatedAt,
            m.rows.length,
            m.rows.reduce((s, r) => s + r.requests, 0),
          ];
      })(),
    );
    await copyRows(
      c,
      "admin_service_requests",
      ["period", "service_id", "service_name", "requests"],
      (function* () {
        for (const m of snap.months)
          for (const r of m.rows)
            yield [`${m.period}-01`, r.serviceId, r.name, r.requests];
      })(),
    );
    await recordIngestBatch(c, {
      source: "admin_service_requests",
      table: "admin_service_requests",
      keyExpr: "to_char(t.period, 'YYYY-MM') || ':' || t.service_id",
      nameExpr: "t.service_name",
      // A request COUNT, never an amount: recent_updates exposes amountExpr as amount_eur.
      detailExpr:
        "to_char(t.period, 'YYYY-MM') || ' · ' || t.requests || ' заявки'",
      amountExpr: "NULL::double precision",
      rowsTotal: rowCount,
    });
  });
  await vacuumAfterReload(
    "admin_service_requests",
    "admin_service_requests_month",
  );
  console.log(
    `admin_service_requests→PG: ${snap.months.length} month(s), ${rowCount} row(s)`,
  );
  await end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
