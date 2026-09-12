import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, expect, test } from "vitest";
import { pinLocalDatabase, withClient, end } from "../lib/pg";
import {
  encodeFundingQuery,
  validateFundingQuery,
} from "../../../src/lib/fundingQuery";
const { runFundingQuery } = createRequire(import.meta.url)(
  "../../../functions/funding_query",
);
pinLocalDatabase();
afterAll(end);
test("Interreg operation and partnership units, publication, dates and whole parent cohort", async () => {
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`CREATE SCHEMA funding_interreg_fixture;SET LOCAL search_path=funding_interreg_fixture;
 CREATE TABLE interreg_operations(keep_id int PRIMARY KEY,programme_code text,title_bg text,title_en text,start_date date,end_date date,status text,total_budget_eur float8,eu_funding_eur float8);
 CREATE TABLE interreg_partners(keep_id int,partner_seq int,keep_partnership_id int,keep_partner_id int,partner_name text,eik text,country text,country_department text,is_lead bool,budget_eur float8,eu_funding_eur float8,ekatte text,obshtina text,oblast text);
 CREATE TABLE interreg_programmes(code text);CREATE TABLE fund_projects(beneficiary_eik text);CREATE TABLE agri_subsidies(eik text);CREATE TABLE contracts(key text);CREATE TABLE ingest_first_seen(source text,key text,first_seen_at timestamptz);CREATE TABLE person(person_id text,status text,is_public_figure bool);CREATE TABLE person_role(person_id text,ref text,source text,confidence text);
 INSERT INTO interreg_operations VALUES(1,'P',null,'Health One','2025-01-01','2026-01-31','ongoing',1000,800),(2,'P',null,'Health Two','2026-01-31','2027-12-31','ongoing',500,400),(3,'OLD',null,'Old','2018-01-01','2020-12-31','closed',200,160);
 INSERT INTO interreg_partners VALUES(1,1,11,101,'X','111111111','Bulgaria',null,true,100,80,'07079','BGS01','BGS'),(1,2,12,102,'Y',null,'France','Bulgaria',false,null,null,null,null,null),(1,3,13,103,'Foreign',null,'France',null,false,900,720,null,null,null),(2,1,21,101,'X','111111111','Bulgaria',null,true,0,0,'07079','BGS01','BGS'),(2,2,22,103,'Foreign',null,'France',null,false,500,400,null,null,null),(3,1,31,104,'Q',null,'Bulgaria',null,true,50,null,null,null,null);`);
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
        `INSERT INTO funding_query_meta VALUES('catalog','{"version":"1.0.0"}');INSERT INTO funding_programmes(corpus,code,label_bg,period,mechanism,fund_type,eligible_nuts)VALUES('interregOperations','P','P','2021-2027','EU','Interreg',ARRAY['BG34']),('interregOperations','OLD','OLD','2014-2020','EU','Interreg',null);`,
      );
      const run = async (args: Record<string, unknown> = {}) =>
        (
          await runFundingQuery(
            async (sql: string, params: unknown[]) =>
              (await c.query(sql, params)).rows,
            {
              corpus: "interregOperations",
              programmingPeriods: ["2021-2027"],
              ...args,
            },
          )
        ).body;
      expect((await run()).totals).toMatchObject({ records: 2, amount: 1500 });
      const bg = { corpus: "interregPartners", basePredicates: ["bulgarian"] };
      expect((await run(bg)).totals).toMatchObject({
        records: 3,
        amount: 100,
        known_amount: 2,
        organisations: 2,
      });
      expect((await run(bg)).status).toBe("partial");
      expect(
        (await run({ ...bg, basePredicates: ["bulgarian", "publishedZero"] }))
          .totals.records,
      ).toBe(1);
      expect(
        (
          await run({
            ...bg,
            basePredicates: ["bulgarian", "unpublishedBudget"],
          })
        ).totals,
      ).toMatchObject({ records: 1, amount: null });
      expect(
        (await run({ ...bg, metric: "organisations", operation: "count" }))
          .totals.organisations,
      ).toBe(2);
      expect(
        (
          await run({
            dateBasis: "overlap",
            from: "2026-01-31",
            toExclusive: "2026-02-01",
          })
        ).totals.records,
      ).toBe(2);
      expect(
        (
          await run({
            dateBasis: "start",
            from: "2026-01-31",
            toExclusive: "2026-02-01",
          })
        ).totals.records,
      ).toBe(1);
      expect(
        (
          await run({
            dateBasis: "end",
            from: "2026-01-31",
            toExclusive: "2026-02-01",
          })
        ).totals.records,
      ).toBe(1);
      expect(
        (await run({ placeBasis: "eligible", placeIds: ["BG341"] })).totals
          .amount,
      ).toBe(1500);
      expect(
        (await run({ ...bg, placeBasis: "partner", placeIds: ["BGS01"] }))
          .totals.amount,
      ).toBe(100);
      const parent = validateFundingQuery({
        corpus: "interregOperations",
        programmingPeriods: ["2021-2027"],
        operation: "list",
        limit: 1,
      });
      if (!parent.ok) throw Error("fixture");
      expect(
        (
          await run({
            ...bg,
            parentQuery: encodeFundingQuery(parent.query),
            relationship: "operationsToPartners",
          })
        ).totals.records,
      ).toBe(3);
      const partnerParent = validateFundingQuery({
        ...bg,
        operation: "list",
        limit: 1,
        basePredicates: ["bulgarian", "publishedZero"],
      });
      if (!partnerParent.ok) throw Error("fixture");
      expect(
        (
          await run({
            parentQuery: encodeFundingQuery(partnerParent.query),
            relationship: "partnersToOperations",
          })
        ).totals,
      ).toMatchObject({ records: 1, amount: 500 });
      const emptyParent = validateFundingQuery({
        corpus: "interregOperations",
        keyword: "absent",
      });
      if (!emptyParent.ok) throw Error("fixture");
      expect(
        (
          await run({
            ...bg,
            parentQuery: encodeFundingQuery(emptyParent.query),
            relationship: "operationsToPartners",
          })
        ).totals.records,
      ).toBe(0);
      expect(
        (
          await run({
            corpus: "interregPartners",
            programmingPeriods: ["2014-2020"],
            basePredicates: ["unpublishedBudget"],
            amountBasis: "partnerEu",
          })
        ).totals.records,
      ).toBe(0);
      await c.query(
        "UPDATE interreg_partners SET ekatte=NULL WHERE keep_partnership_id=11",
      );
      expect(
        (await run({ ...bg, basePredicates: ["bulgarian", "unplaced"] })).totals
          .records,
      ).toBe(1);
      await c.query(
        "UPDATE interreg_partners SET keep_partner_id=NULL WHERE keep_partnership_id=11",
      );
      const missingOrg = await run({ ...bg, metric: "organisations" });
      expect(missingOrg.status).toBe("partial");
      expect(missingOrg.totals.known_organisation).toBe(2);
      const missingAll = await run({
        corpus: "interregPartners",
        operation: "count",
        metric: "organisations",
        entityIds: ["111111111"],
        dateBasis: "end",
        from: "2026-01-01",
        toExclusive: "2027-01-01",
      });
      expect(missingAll.status).toBe("unavailable");
      await c.query(
        "UPDATE interreg_partners SET obshtina='S22',oblast='S22' WHERE keep_partnership_id=11",
      );
      expect(
        (await run({ ...bg, placeBasis: "partner", placeIds: ["SFO_CITY"] }))
          .totals.records,
      ).toBe(1);
      const revisionParent = validateFundingQuery({
        corpus: "interregOperations",
        expectedRevision: (await run()).revision,
      });
      if (!revisionParent.ok) throw Error("fixture");
      await c.query(
        "UPDATE interreg_operations SET end_date='2024-01-01' WHERE keep_id=1",
      );
      expect(
        (
          await run({
            ...bg,
            parentQuery: encodeFundingQuery(revisionParent.query),
            relationship: "operationsToPartners",
          })
        ).reason,
      ).toBe("revision_changed");
      const reversed = await run({
        dateBasis: "overlap",
        from: "2025-01-01",
        toExclusive: "2027-01-01",
      });
      expect(reversed.status).toBe("partial");
      expect(reversed.dateUnknown).toBe(1);
      expect(reversed.totals.records).toBe(1);
    } finally {
      await c.query("ROLLBACK");
    }
  });
}, 30000);
test("both populated Interreg corpora reconcile independently under app_readonly", async () => {
  await withClient(async (c) => {
    await c.query("BEGIN READ ONLY");
    try {
      await c.query(
        "SET LOCAL ROLE app_readonly;SET LOCAL statement_timeout='20s'",
      );
      for (const [corpus, table, column] of [
        ["interregOperations", "interreg_operations", "total_budget_eur"],
        ["interregPartners", "interreg_partners", "budget_eur"],
      ]) {
        const result = await runFundingQuery(
          async (sql: string, params: unknown[]) =>
            (await c.query(sql, params)).rows,
          { corpus, limit: 1 },
        );
        expect(["success", "partial"]).toContain(result.body.status);
        const expected = (
          await c.query(
            `SELECT count(*)::int AS records,sum(${column}::numeric)::float8 AS amount FROM ${table}`,
          )
        ).rows[0];
        expect(result.body.totals.records).toBe(expected.records);
        expect(result.body.totals.amount).toBeCloseTo(expected.amount, 2);
      }
    } finally {
      await c.query("ROLLBACK");
    }
  });
}, 30000);
