import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, expect, test } from "vitest";
import { pinLocalDatabase, withClient, end } from "../lib/pg";
const require = createRequire(import.meta.url);
const { runFundingQuery } = require("../../../functions/funding_query.js");
pinLocalDatabase();
afterAll(end);
test("ISUN independent cohort arithmetic, money evidence, themes, dates and revisions", async () => {
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`CREATE SCHEMA funding_isun_fixture;SET LOCAL search_path=funding_isun_fixture;
 CREATE TABLE fund_projects(contract_number text PRIMARY KEY,beneficiary_eik text,beneficiary_name text,title text,program_code text,total_eur float8,grant_eur float8,own_cofinance_eur float8,paid_eur float8,status text,location_json jsonb,ekatte text,oblast text);
 CREATE TABLE ingest_first_seen(source text,key text,first_seen_at timestamptz);
 CREATE TABLE agri_subsidies(eik text);CREATE TABLE interreg_partners(eik text);CREATE TABLE interreg_operations(keep_id int);CREATE TABLE interreg_programmes(code text);CREATE TABLE contracts(key text);
 CREATE TABLE person(person_id text,status text,is_public_figure bool);CREATE TABLE person_role(person_id text,ref text,source text,confidence text);
 INSERT INTO fund_projects VALUES
 ('I1','111111111','A','health','P1',100,80,20,40,'В изпълнение','{"munis":["BGS01","BGS02"]}',null,'BGS'),
 ('I2','111111111','A','roads','P2',200,150,50,150,'Приключен',null,null,'BGS'),
 ('I3','222222222','B','health','P1',0,0,0,0,'Сключен',null,null,'VAR'),
 ('I4',null,'Unknown','unknown',null,0,0,0,0,null,null,null,null);
 INSERT INTO ingest_first_seen VALUES('fund_project','I1','2025-04-01T00:00:00Z'),('fund_project','I2','2026-01-31T00:00:00Z');`);
      await c.query(
        readFileSync(
          new URL(
            "../schema/pg/198_funding_query_catalogs.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await c.query(`INSERT INTO funding_isun_observations SELECT contract_number,total_eur,grant_eur,own_cofinance_eur,paid_eur,15,'fixture' FROM fund_projects WHERE contract_number<>'I4';
 INSERT INTO funding_query_meta VALUES('catalog','{"version":"1.0.0"}');
 INSERT INTO funding_programmes(corpus,code,label_bg,period,mechanism,fund_type) VALUES('isunProjects','P1','P1','2021-2027','EU','ERDF'),('isunProjects','P2','P2','2014-2020','EU','ESF');
 INSERT INTO funding_themes VALUES('health','health','health',ARRAY['health'],ARRAY[]::text[]),('roads','roads','roads',ARRAY['roads'],ARRAY[]::text[]);`);
      const run = async (args: Record<string, unknown> = {}) =>
        (
          await runFundingQuery(
            async (sql: string, params: unknown[]) =>
              (await c.query(sql, params)).rows,
            { corpus: "isunProjects", ...args },
          )
        ).body;
      const all = await run();
      expect(all.status).toBe("partial");
      expect(all.totals).toMatchObject({
        records: 4,
        beneficiaries: 2,
        amount: 230,
        paid: 190,
        known_amount: 3,
      });
      expect(
        (await run({ metric: "paidRatio" })).totals.paid_ratio,
      ).toBeCloseTo((190 / 230) * 100);
      expect((await run({ themeIds: ["health"] })).totals).toMatchObject({
        records: 2,
        amount: 80,
        paid: 40,
      });
      expect(
        (
          await run({
            placeIds: ["BGS01", "BGS02"],
            placeBasis: "implementation",
          })
        ).totals.records,
      ).toBe(1);
      expect(
        (await run({ operation: "share", numeratorPredicates: ["zeroPaid"] }))
          .totals,
      ).toMatchObject({
        records: 4,
        numerator_records: 1,
        evaluable: 3,
        share: 25,
      });
      expect(
        (await run({ basePredicates: ["!zeroPaid"] })).totals.records,
      ).toBe(2);
      expect(
        (
          await run({
            dateBasis: "observed",
            from: "2025-04-01",
            toExclusive: "2026-02-01",
          })
        ).totals.records,
      ).toBe(2);
      expect((await run({ programmeIds: ["absent"] })).reason).toBe(
        "unknown_catalog_id",
      );
      const matching = await run({
        operation: "list",
        numeratorPredicates: ["zeroPaid"],
      });
      expect(matching.rows.map((r: { key: string }) => r.key)).toEqual(["I3"]);
      expect(
        (await run({ operation: "count", numeratorPredicates: ["zeroPaid"] }))
          .totals.records,
      ).toBe(1);
      expect(
        (await run({ operation: "sum", numeratorPredicates: ["zeroPaid"] }))
          .totals.amount,
      ).toBe(0);
      expect(
        (await run({ operation: "share", numeratorPredicates: ["zeroPaid"] }))
          .status,
      ).toBe("partial");
      expect(
        (
          await run({
            operation: "share",
            numeratorPredicates: ["political"],
            entityIds: ["111111111"],
            denominator: "amount",
          })
        ).totals.share,
      ).toBe(0);
      expect((await run({ amountMin: 0 })).amountUnknown).toBe(1);
      expect(
        (
          await run({
            dateBasis: "observed",
            from: "2025-01-01",
            toExclusive: "2027-01-01",
          })
        ).dateUnknown,
      ).toBe(2);
      const compare = await run({
        operation: "compare",
        dateBasis: "observed",
        from: "2025-01-01",
        toExclusive: "2026-01-01",
        compareFrom: "2098-01-01",
        compareToExclusive: "2099-01-01",
        limit: 1,
      });
      expect(compare.comparisons).toHaveLength(2);
      expect(
        compare.comparisons.find(
          (x: { cohort_window: string }) => x.cohort_window === "comparison",
        ).records,
      ).toBe(0);
      expect(
        (
          await run({
            operation: "rank",
            groupBy: "programme",
            minGroupCount: 2,
          })
        ).groups.map((x: { group_key: string }) => x.group_key),
      ).toEqual(["P1"]);
      expect(
        (
          await run({
            operation: "share",
            groupBy: "programme",
            numeratorPredicates: ["zeroPaid"],
          })
        ).groups[0],
      ).toMatchObject({ group_key: "P1", share: 50 });
      const missingAmount = await run({ statusIds: ["unknown"], amountMin: 0 });
      expect(missingAmount.status).toBe("unavailable");
      await c.query(
        "UPDATE funding_isun_observations SET observed_mask=7 WHERE contract_number='I1'",
      );
      const ratioUnknown = await run({
        entityIds: ["111111111"],
        programmeIds: ["P1"],
        metric: "paidRatio",
      });
      expect(ratioUnknown.status).toBe("unavailable");
      expect(ratioUnknown.totals.paid_ratio).toBeNull();
      await c.query(
        "UPDATE funding_isun_observations SET observed_mask=15 WHERE contract_number='I1'",
      );
      const first = await run({ operation: "list", limit: 1 });
      expect(first.rows).toHaveLength(1);
      expect(first.totals.records).toBe(4);
      expect((await run({ expectedRevision: "stale" })).reason).toBe(
        "revision_changed",
      );
      await c.query(
        "UPDATE fund_projects SET paid_eur=60 WHERE contract_number='I1'",
      );
      expect((await run({ themeIds: ["health"] })).totals.known_amount).toBe(1);
      expect((await run()).revision).not.toBe(first.revision);
      await c.query(
        "UPDATE fund_projects SET beneficiary_eik=NULL WHERE contract_number='I3'",
      );
      const unknown = await run({
        themeIds: ["health"],
        statusIds: ["signed"],
        operation: "share",
        numeratorPredicates: ["political"],
      });
      expect(unknown.status).toBe("unavailable");
      expect(unknown.totals.share).toBeNull();
      const noDate = await run({
        statusIds: ["signed"],
        dateBasis: "observed",
        from: "2025-01-01",
        toExclusive: "2026-01-01",
      });
      expect(noDate.status).toBe("unavailable");
      await c.query(
        "UPDATE fund_projects SET beneficiary_eik='222222222',grant_eur=70,paid_eur=10 WHERE contract_number='I3'; UPDATE funding_isun_observations SET grant_eur=70,paid_eur=10 WHERE contract_number='I3'; UPDATE fund_projects SET paid_eur=40 WHERE contract_number='I1'; UPDATE fund_projects SET beneficiary_eik='333333333' WHERE contract_number='I4'",
      );
      const top = await run({ metric: "topShare", topN: 1 });
      expect(top.totals.top_share).toBeCloseTo((230 / 300) * 100);
      expect(top.status).toBe("partial");
    } finally {
      await c.query("ROLLBACK");
    }
  });
}, 30000);
test("populated ISUN query executes under app_readonly", async () => {
  await withClient(async (c) => {
    await c.query("BEGIN READ ONLY");
    try {
      await c.query("SET LOCAL ROLE app_readonly");
      const r = await runFundingQuery(
        async (sql: string, params: unknown[]) =>
          (await c.query(sql, params)).rows,
        { corpus: "isunProjects", limit: 1 },
      );
      expect(["success", "partial"]).toContain(r.body.status);
      expect(r.body.totals.records).toBeGreaterThan(0);
      expect(r.body.rows).toHaveLength(1);
    } finally {
      await c.query("ROLLBACK");
    }
  });
}, 30000);
