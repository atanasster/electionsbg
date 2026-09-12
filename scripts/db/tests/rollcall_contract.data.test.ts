import { afterAll, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pinLocalDatabase, withClient, end } from "../lib/pg";
pinLocalDatabase();
afterAll(end);
it("revisions are transactional, idempotent and readable without writes", async () => {
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(
        "CREATE SCHEMA rollcall_contract_fixture;SET LOCAL search_path=rollcall_contract_fixture;CREATE TABLE vote_item(id int);CREATE TABLE person(id int)",
      );
      const sql = readFileSync(
        new URL("../schema/pg/199_rollcall_query.sql", import.meta.url),
        "utf8",
      );
      await c.query(sql);
      await c.query(sql);
      await c.query("INSERT INTO vote_item VALUES(1),(2)");
      expect(
        (
          await c.query(
            "SELECT generation::int FROM rollcall_query_revisions WHERE resource='vote_item'",
          )
        ).rows[0].generation,
      ).toBe(1);
      await c.query(
        "SAVEPOINT source_write;UPDATE vote_item SET id=id+1;ROLLBACK TO source_write",
      );
      expect(
        (
          await c.query(
            "SELECT generation::int FROM rollcall_query_revisions WHERE resource='vote_item'",
          )
        ).rows[0].generation,
      ).toBe(1);
      await c.query("DELETE FROM person");
      expect(
        (
          await c.query(
            "SELECT generation::int FROM rollcall_query_revisions WHERE resource='person'",
          )
        ).rows[0].generation,
      ).toBe(1);
      await c.query(
        "GRANT USAGE ON SCHEMA rollcall_contract_fixture TO app_readonly;SET LOCAL ROLE app_readonly",
      );
      expect(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM rollcall_query_revisions",
          )
        ).rows[0].n,
      ).toBeGreaterThan(1);
    } finally {
      await c.query("RESET ROLE;ROLLBACK");
    }
  });
});
