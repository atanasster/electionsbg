import { readFileSync } from "node:fs";
import { exec, allRows } from "./pg";
/** Additive, idempotent installation; source-table triggers survive ordinary reloads. */
export async function installProcurementQuery(): Promise<void> {
  await exec(
    readFileSync(
      new URL(
        "../schema/pg/196_procurement_query_revisions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const [tables] = await allRows<{ ready: boolean }>(
    "SELECT to_regclass('contracts') IS NOT NULL AND to_regclass('tenders') IS NOT NULL AS ready",
  );
  if (tables.ready) {
    await exec(
      readFileSync(
        new URL(
          "../schema/pg/197_procurement_tender_analytics.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const [fresh] = await allRows<{ ready: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM procurement_tender_risk_meta WHERE only_row AND catalog_version='1.0.0' AND revision=(SELECT COALESCE(jsonb_object_agg(resource,generation::text),'{}'::jsonb) FROM procurement_query_revisions WHERE resource IN ('contracts','tenders'))) AS ready`,
    );
    if (!fresh.ready) await allRows("SELECT rebuild_procurement_tender_risk()");
  }
}
