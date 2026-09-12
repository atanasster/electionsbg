import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, expect, test } from "vitest";
import { pinLocalDatabase, withClient, end } from "../lib/pg";
const { runFundingQuery } = createRequire(import.meta.url)(
  "../../../functions/funding_query.js",
);
pinLocalDatabase();
afterAll(end);
test("DFZ financial years, recipient scopes, corrections and payer population reconcile", async () => {
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`CREATE SCHEMA funding_agri_fixture;SET LOCAL search_path=funding_agri_fixture;
CREATE TABLE agri_subsidies(id int PRIMARY KEY,year int,eik text,name text,oblast text,scheme text,scheme_desc text,dp_eur float8,market_eur float8,rural_eur float8,total_eur float8);
CREATE TABLE fund_projects(beneficiary_eik text);CREATE TABLE interreg_partners(eik text);CREATE TABLE interreg_operations(keep_id int);CREATE TABLE interreg_programmes(code text);CREATE TABLE contracts(key text);CREATE TABLE ingest_first_seen(source text,key text,first_seen_at timestamptz);
CREATE TABLE person(person_id text,status text,is_public_figure bool);CREATE TABLE person_role(person_id text,ref text,source text,confidence text);
INSERT INTO agri_subsidies VALUES
(1,2025,'111111111','A','Бургас','S1','Direct',100,0,0,100),
(2,2025,'111111111','A','Бургас','S2','Rural',0,0,50,50),
(3,2025,'222222222','B','Варна','S1','Direct',25,0,0,25),
(4,2025,null,'A','Бургас','S1','Direct',20,0,0,20),
(5,2025,'121100421','Payer','София (столица)','S1','Direct',500,0,0,500),
(6,2026,'111111111','A','Бургас','S1','Direct',40,0,0,40),
(7,2026,'111111111','A','Бургас','S1','Direct',-5,0,0,-5);
INSERT INTO person VALUES('p','active',true);INSERT INTO person_role VALUES('p','111111111','tr','high');`);
      await c.query(
        readFileSync(
          new URL(
            "../schema/pg/198_funding_query_catalogs.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await c.query(
        `INSERT INTO funding_query_meta VALUES('catalog','{"version":"1.0.0"}');`,
      );
      const run = async (args: Record<string, unknown> = {}) =>
        (
          await runFundingQuery(
            async (sql: string, params: unknown[]) =>
              (await c.query(sql, params)).rows,
            { corpus: "agriPayments", financialYears: ["2025"], ...args },
          )
        ).body;
      const all = await run();
      expect((await run({ amountBasis: "direct" })).totals.amount).toBe(145);
      expect((await run({ amountBasis: "market" })).totals.amount).toBe(0);
      expect((await run({ amountBasis: "rural" })).totals.amount).toBe(50);
      expect(all.totals).toMatchObject({
        records: 4,
        amount: 195,
        beneficiaries: 2,
      });
      expect((await run({ population: "gross" })).totals.amount).toBe(695);
      expect((await run({ entityClass: "legal" })).totals).toMatchObject({
        records: 3,
        amount: 175,
      });
      expect((await run({ entityIds: ["111111111"] })).totals.amount).toBe(150);
      expect(
        (await run({ entityIds: ["111111111"], schemeIds: ["S1"] })).totals
          .amount,
      ).toBe(100);
      expect((await run({ financialYears: ["2026"] })).totals).toMatchObject({
        records: 2,
        amount: 35,
      });
      expect((await run({ financialYears: ["2024"] })).reason).toBe(
        "financial_year_unavailable",
      );
      expect((await run({ financialYears: ["2025", "2024"] })).reason).toBe(
        "financial_year_unavailable",
      );
      expect((await run({ schemeIds: ["S1"] })).totals.amount).toBe(145);
      expect((await run({ schemeIds: ["missing"] })).reason).toBe(
        "unknown_catalog_id",
      );
      expect((await run({ amountBasis: "rural" })).totals.amount).toBe(50);
      expect(
        (await run({ placeIds: ["BGS"], placeBasis: "recipient" })).totals
          .amount,
      ).toBe(170);
      expect(
        (await run({ placeIds: ["BGS01"], placeBasis: "recipient" })).status,
      ).toBe("unsupported");
      expect(
        (await run({ operation: "share", numeratorPredicates: ["political"] }))
          .totals.share,
      ).toBe(50);
      expect(
        (await run({ operation: "share", numeratorPredicates: ["political"] }))
          .status,
      ).toBe("partial");
      expect(
        (await run({ basePredicates: ["!political"] })).totals.records,
      ).toBe(1);
      expect((await run({ entityClass: "individual" })).totals).toMatchObject({
        records: 1,
        beneficiaries: 0,
      });
      const compare = await run({
        operation: "compare",
        compareFinancialYears: ["2026"],
        limit: 1,
      });
      expect(compare.comparisons).toHaveLength(2);
      expect(
        compare.comparisons
          .map((x: { amount: number }) => x.amount)
          .sort((a: number, b: number) => a - b),
      ).toEqual([35, 195]);
      expect((await run({ operation: "detail", key: "1" })).reason).toBe(
        "annual_record_requires_revision",
      );
      expect(
        (
          await run({
            operation: "detail",
            key: "1",
            expectedRevision: all.revision,
          })
        ).rows[0].key,
      ).toBe("1");
      expect((await run({ operation: "trend" })).groups[0].group_key).toBe(
        "2025",
      );
      expect(
        (await run({ operation: "rank", groupBy: "entity", metric: "amount" }))
          .groups[0],
      ).toMatchObject({ group_key: "111111111", amount: 150 });
      await c.query("UPDATE agri_subsidies SET total_eur=NULL WHERE year=2026");
      expect((await run({ amountMin: 0 })).status).toBe("success");
      expect(
        (
          await run({
            amountMin: 0,
            operation: "compare",
            compareFinancialYears: ["2026"],
          })
        ).status,
      ).toBe("partial");
    } finally {
      await c.query("ROLLBACK");
    }
  });
}, 30000);
test("populated DFZ executes financial scope under app_readonly", async () => {
  await withClient(async (c) => {
    await c.query("BEGIN READ ONLY");
    try {
      await c.query(
        "SET LOCAL ROLE app_readonly; SET LOCAL statement_timeout='20s'",
      );
      const r = await runFundingQuery(
        async (sql: string, params: unknown[]) =>
          (await c.query(sql, params)).rows,
        { corpus: "agriPayments", financialYears: ["2025"], limit: 1 },
      );
      expect(["success", "partial"]).toContain(r.body.status);
      expect(r.body.totals.records).toBeGreaterThan(0);
      expect(r.body.rows).toHaveLength(1);
    } finally {
      await c.query("ROLLBACK");
    }
  });
}, 30000);
