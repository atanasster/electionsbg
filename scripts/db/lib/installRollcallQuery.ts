import { readFileSync } from "node:fs";
import { withClient } from "./pg";
import {
  ROLLCALL_TOPICS,
  ROLLCALL_VERSION,
} from "../../../src/lib/rollcallQuery";
export async function installRollcallQuery(): Promise<void> {
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(
        readFileSync(
          new URL("../schema/pg/199_rollcall_query.sql", import.meta.url),
          "utf8",
        ),
      );
      const value = JSON.stringify({
        version: ROLLCALL_VERSION,
        topics: ROLLCALL_TOPICS,
        yearOnlyCouncils: ["HKV34"],
      });
      await c.query(
        "INSERT INTO rollcall_query_meta VALUES('catalog',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE rollcall_query_meta.value IS DISTINCT FROM excluded.value",
        [value],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
}
