import { afterAll, expect, test } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { allRows, pinLocalDatabase, withClient, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import { computeTenderRisk } from "../../../src/data/procurement/computeTenderRisk";
import fixture from "../../../ai/tests/fixtures/procurement-query.json";
const require = createRequire(import.meta.url);
const {
  validateProcurementQuery,
} = require("../../../functions/generated/procurement_query");
const {
  compileOtherQuery,
} = require("../../../functions/procurement_query_corpora");
pinLocalDatabase();
afterAll(end);
let skip: string | false = false;
try {
  await allRows("SELECT 1");
} catch (error) {
  const e = error as { code?: string; errors?: { code?: string }[] };
  if (
    ![e, ...(e.errors || [])].some((x) =>
      ["ECONNREFUSED", "EPERM", "EACCES", "ETIMEDOUT", "ENOTFOUND"].includes(
        x.code || "",
      ),
    )
  )
    throw error;
  skip =
    "local PostgreSQL unavailable; tender/KZK SQL fixtures require a permitted local connection";
}
reportSkip(import.meta.url, skip);
test.skipIf(Boolean(skip))(
  "tender scorer parity, distinct KZK units, independent periods and protected outcomes",
  async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(`CREATE SCHEMA procurement_fixture_${process.pid}; SET LOCAL search_path=procurement_fixture_${process.pid},public;
 CREATE TABLE contracts(unp text,tag text,consortium_role text,amount_eur numeric,date_signed text,date text);
 CREATE TABLE tenders(unp text PRIMARY KEY,subject text,publication_date text,submission_deadline text,buyer_eik text,buyer_name text,cpv text,procedure_type text,estimated_value_eur numeric,is_eu_funded bool,is_framework_agreement bool,is_cancelled bool);
 CREATE TABLE kzk_appeals(complaint_no text,complaint_date text,decision_date text,decision_act_no text,unp text,buyer_eik text,subject text,respondent text,outcome text,status text,suspension bool,vm_requested bool,source_url text);
 CREATE TABLE kzk_decisions(act_no text,decision_date text,kind text,pronouncement text,respondent text,source_url text);
 CREATE TABLE procurement_query_revisions(resource text,generation bigint);
 CREATE FUNCTION kzk_effective_outcome(raw text,status text) RETURNS text LANGUAGE sql AS $$ SELECT COALESCE(raw,CASE WHEN status ~* 'отказано' THEN 'отказана' END) $$;
 CREATE FUNCTION kzk_effective_suspension(raw bool,status text) RETURNS bool LANGUAGE sql AS $$ SELECT COALESCE(raw,status ~* 'спрян') $$;
 INSERT INTO tenders VALUES ('t1','Medical','2026-01-01','2026-01-12','123456789','H','33100000','Открита процедура',100,false,false,false),('t2','Road','2026-01-01','2026-01-13','987654321','R','45233100','Открита процедура',100,false,false,true),('t3','Other','2026-01-01','2027-01-01','123456789','H','15800000','Пряко договаряне',NULL,NULL,NULL,false);
 INSERT INTO contracts VALUES ('t1','contract',NULL,110,'2026-01-13','2026-01-14'),('t1','contract','member',999,'2026-01-13','2026-01-14'),('t2','contract',NULL,110.01,'2026-01-18','2026-01-19');`);
        await client.query(
          readFileSync(
            new URL(
              "../schema/pg/197_procurement_tender_analytics.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        await client.query("SELECT rebuild_procurement_tender_risk()");
        await client.query(
          "UPDATE contracts SET amount_eur=120 WHERE unp='t1' AND consortium_role IS NULL; INSERT INTO procurement_query_revisions VALUES('contracts',2)",
        );
        await client.query("SELECT rebuild_procurement_tender_risk()");
        expect(
          (
            await client.query(
              "SELECT fired_mask FROM procurement_tender_risk_cache WHERE unp='t1'",
            )
          ).rows[0].fired_mask,
        ).toBe(14);
        expect(
          (
            await client.query(
              "SELECT revision FROM procurement_tender_risk_meta",
            )
          ).rows[0].revision,
        ).toEqual({ contracts: "2" });
        expect(
          (
            await client.query(
              "SELECT n.nspname=current_schema() AS local FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid='rebuild_procurement_tender_risk()'::regprocedure",
            )
          ).rows[0].local,
        ).toBe(true);
        await client.query(
          "UPDATE contracts SET amount_eur=110 WHERE unp='t1' AND consortium_role IS NULL; UPDATE procurement_query_revisions SET generation=3",
        );
        await client.query("SELECT rebuild_procurement_tender_risk()");
        for (const a of fixture.appeals) {
          const d = fixture.decisions.find((d) => d.id === a.act);
          await client.query(
            `INSERT INTO kzk_appeals VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'https://example.test')`,
            [
              a.id,
              a.date,
              d?.date || null,
              a.act,
              a.unp,
              a.unp === "t1"
                ? "123456789"
                : a.unp === "t2"
                  ? "987654321"
                  : null,
              "subject",
              "buyer",
              a.outcome,
              "status" in a ? a.status : null,
              a.suspended,
              a.requested,
            ],
          );
        }
        for (const d of fixture.decisions)
          await client.query(
            `INSERT INTO kzk_decisions VALUES($1,$2,$3,'act','buyer','https://example.test')`,
            [d.id, d.date, d.kind],
          );
        expect(
          (
            await client.query(
              "SELECT procurement_query_instant('2026-02-30') AS invalid",
            )
          ).rows[0].invalid,
        ).toBeNull();
        const before = (
          await client.query("SELECT * FROM kzk_appeals ORDER BY complaint_no")
        ).rows;
        const run = async (query: object) => {
          const parsed = validateProcurementQuery(query);
          expect(parsed.ok).toBe(true);
          const built = compileOtherQuery(parsed.query);
          return (
            await client.query<{
              result: {
                totals: Record<string, number | string | null>;
                rows: Record<string, unknown>[];
                groups: unknown[];
              };
            }>(built.sql, built.params)
          ).rows[0].result;
        };
        const masks = (
          await client.query<{
            unp: string;
            fired_mask: number;
            available_mask: number;
          }>("SELECT * FROM procurement_tender_risk_live ORDER BY unp")
        ).rows;
        expect(masks.map((m) => [m.fired_mask, m.available_mask])).toEqual([
          [6, 15],
          [8, 15],
          [1, 1],
        ]);
        const scorer = computeTenderRisk(
          {
            procedureType: "Открита процедура",
            publicationDate: "2026-01-01",
            submissionDeadline: "2026-01-12",
            estimatedValueEur: 100,
          },
          [
            {
              key: "award",
              contractorEik: null,
              contractorName: "supplier",
              title: "award",
              tag: "contract",
              amountEur: 110,
              dateSigned: "2026-01-13",
              date: "2026-01-14",
            },
          ],
        );
        for (const [signed, expected] of [
          ["2026-01-12", false],
          ["2026-01-13", true],
          ["2026-01-16", true],
          ["2026-01-17", false],
        ] as const) {
          await client.query(
            "UPDATE contracts SET date_signed=$1,date='2026-01-30' WHERE unp='t1' AND consortium_role IS NULL",
            [signed],
          );
          const [risk] = (
            await client.query<{ fired_mask: number }>(
              "SELECT fired_mask FROM procurement_tender_risk_live WHERE unp='t1'",
            )
          ).rows;
          expect(Boolean(risk.fired_mask & 4)).toBe(expected);
        }
        await client.query(
          "UPDATE contracts SET date_signed='2026-01-13',date='2026-01-14' WHERE unp='t1' AND consortium_role IS NULL",
        );
        expect(
          scorer.components.filter((c) => c.fired).map((c) => c.key),
        ).toEqual(["rushedDeadline", "shortDecisionPeriod"]);
        expect(
          (
            await run({
              corpus: "tenders",
              metric: "risk",
              operation: "share",
              numeratorPredicates: ["risk:rushedDeadline"],
            })
          ).totals,
        ).toMatchObject({ records: 3, numerator: 1, evaluable: 2 });
        expect(
          (
            await run({
              corpus: "tenders",
              metric: "appealed",
              operation: "count",
            })
          ).totals,
        ).toMatchObject({ records: 3, numerator: 2 });
        expect(
          (await run({ corpus: "tenders", status: "open", asOf: fixture.asOf }))
            .totals.records,
        ).toBe(1);
        expect(
          (await run({ corpus: "tenders", status: "cancelled" })).totals
            .records,
        ).toBe(1);
        expect((await run({ corpus: "appeals" })).totals).toMatchObject({
          records: 4,
          linked_procedures: 2,
          unlinked: 1,
          upheld: 1,
          rejected: 1,
          refused: 1,
          unknown_outcome: 1,
          interim_requested: 2,
        });
        expect(
          (
            await run({
              corpus: "appeals",
              operation: "share",
              metric: "upheld",
              denominator: "merits",
            })
          ).totals,
        ).toMatchObject({ numerator: 1, merits: 2 });
        expect(
          (
            await run({
              corpus: "appeals",
              from: "2026-01-01",
              toExclusive: "2027-01-01",
            })
          ).totals.records,
        ).toBe(3);
        expect(
          (
            await run({
              corpus: "appeals",
              dateBasis: "decision",
              from: "2026-01-01",
              toExclusive: "2027-01-01",
            })
          ).totals.records,
        ).toBe(3);
        expect((await run({ corpus: "decisions" })).totals).toMatchObject({
          records: 3,
          unlinked: 1,
          linked_procedures: 2,
        });
        expect(
          (await run({ corpus: "decisions", buyerIds: ["123456789"] })).totals
            .records,
        ).toBe(1);
        expect(
          (await run({ corpus: "appeals", cpvPrefixes: ["33"] })).totals
            .records,
        ).toBe(2);
        expect(
          (
            await run({
              corpus: "tenders",
              relatedCorpus: "appeals",
              relatedFrom: "2026-01-01",
              relatedToExclusive: "2027-01-01",
            })
          ).totals.records,
        ).toBe(2);
        expect(
          (
            await client.query(
              "SELECT * FROM kzk_appeals ORDER BY complaint_no",
            )
          ).rows,
        ).toEqual(before);
        const relatedWindow = {
          corpus: "tenders",
          metric: "upheld",
          operation: "share",
          relatedCorpus: "appeals",
          relatedFrom: "2026-01-01",
          relatedToExclusive: "2027-01-01",
        };
        const relatedResult = await run(relatedWindow);
        expect(relatedResult.totals.numerator).toBe(0);
        expect(relatedResult.rows).toEqual([]);
        expect(
          (await run({ ...relatedWindow, numeratorPredicates: ["!upheld"] }))
            .totals.numerator,
        ).toBe(2);
        expect(
          (await run({ ...relatedWindow, relatedCorpus: "decisions" })).totals
            .numerator,
        ).toBe(1);
        expect(
          (
            await run({
              corpus: "tenders",
              status: "open",
              asOf: "2025-12-31T23:59:59Z",
            })
          ).totals.records,
        ).toBe(0);
        expect(
          (
            await run({
              corpus: "tenders",
              status: "open",
              asOf: "2026-01-01T00:00:00Z",
            })
          ).totals.records,
        ).toBe(2);
        expect(
          (
            await run({
              corpus: "tenders",
              status: "open",
              asOf: "2026-01-12T00:00:00Z",
            })
          ).totals.records,
        ).toBe(1);
        await client.query(
          "UPDATE tenders SET publication_date=NULL WHERE unp='t3'",
        );
        expect(
          (await run({ corpus: "tenders", status: "open", asOf: fixture.asOf }))
            .totals.records,
        ).toBe(0);
      } finally {
        await client.query("ROLLBACK");
      }
    });
  },
);
