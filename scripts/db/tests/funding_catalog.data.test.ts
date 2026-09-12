import { readFileSync } from "node:fs";
import { afterAll, expect, test } from "vitest";
import { pinLocalDatabase, allRows, withClient, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
pinLocalDatabase();
const connectionFailure = (e: unknown): boolean =>
  Array.isArray((e as { errors?: unknown[] })?.errors)
    ? (e as { errors: unknown[] }).errors.every(connectionFailure)
    : ["ECONNREFUSED", "EPERM", "EACCES", "ETIMEDOUT", "ENOTFOUND"].includes(
        String((e as { code?: string })?.code),
      );
let skip = false;
try {
  await allRows("SELECT 1");
} catch (e) {
  if (!connectionFailure(e)) throw e;
  skip = true;
}
reportSkip(import.meta.url, skip ? "Local PostgreSQL unavailable" : false);
afterAll(end);
test.skipIf(skip)(
  "funding catalogs publish revision and political evidence atomically with read-only grants",
  async () => {
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(`CREATE SCHEMA funding_catalog_fixture; SET LOCAL search_path=funding_catalog_fixture;
CREATE TABLE fund_projects(contract_number text PRIMARY KEY);
CREATE TABLE agri_subsidies(id int PRIMARY KEY);
CREATE TABLE interreg_operations(keep_id int PRIMARY KEY);
CREATE TABLE interreg_partners(keep_id int,partner_seq int);
CREATE TABLE interreg_programmes(code text PRIMARY KEY);
CREATE TABLE contracts(key text);
CREATE TABLE ingest_first_seen(source text,key text,first_seen_at timestamptz);
CREATE TABLE person(person_id text PRIMARY KEY,status text,is_public_figure bool);
CREATE TABLE person_role(ref text,person_id text,source text,confidence text,role text);
INSERT INTO person VALUES('p1','active',true),('p2','active',false),('p3','inactive',true);
INSERT INTO person_role VALUES('111111111','p1','tr','high','owner'),('222222222','p2','tr','high','owner'),('333333333','p3','ngo','manual','board'),('444444444','p1','tr','low','owner');`);
        const sql = readFileSync(
          new URL(
            "../schema/pg/198_funding_query_catalogs.sql",
            import.meta.url,
          ),
          "utf8",
        );
        await c.query(sql);
        expect(
          (await c.query("SELECT eik FROM funding_political_eiks")).rows,
        ).toEqual([{ eik: "111111111" }]);
        await c.query("INSERT INTO fund_projects VALUES('I1'),('I2')");
        expect(
          (
            await c.query(
              "SELECT generation::int AS n FROM funding_query_revisions WHERE resource='fund_projects'",
            )
          ).rows[0].n,
        ).toBe(1);
        await c.query("SAVEPOINT refresh");
        await c.query("DELETE FROM fund_projects");
        await c.query("ROLLBACK TO SAVEPOINT refresh");
        expect(
          (await c.query("SELECT count(*)::int AS n FROM fund_projects"))
            .rows[0].n,
        ).toBe(2);
        expect(
          (
            await c.query(
              "SELECT generation::int AS n FROM funding_query_revisions WHERE resource='fund_projects'",
            )
          ).rows[0].n,
        ).toBe(1);
        await c.query(sql); // idempotent trigger installation doesn't reset generation.
        expect(
          (
            await c.query(
              "SELECT generation::int AS n FROM funding_query_revisions WHERE resource='fund_projects'",
            )
          ).rows[0].n,
        ).toBe(1);
        await c.query(
          "GRANT USAGE ON SCHEMA funding_catalog_fixture TO app_readonly; SET LOCAL ROLE app_readonly",
        );
        expect(
          (
            await c.query(
              "SELECT count(*)::int AS n FROM funding_query_revisions",
            )
          ).rows[0].n,
        ).toBeGreaterThan(4);
        await c.query("RESET ROLE");
      } finally {
        await c.query("ROLLBACK");
      }
    });
  },
);
