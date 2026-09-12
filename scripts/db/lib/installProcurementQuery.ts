import { readFileSync } from "node:fs";
import { exec } from "./pg";
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
}
