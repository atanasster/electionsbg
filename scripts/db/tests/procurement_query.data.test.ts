import { reportSkip } from "../../lib/report_skip";
import { afterAll, test, expect } from "vitest";
import { createRequire } from "node:module";
import fixture from "../../../ai/tests/fixtures/procurement-query.json";
import { pinLocalDatabase, withClient, end, allRows } from "../lib/pg";
const require = createRequire(import.meta.url);
const {
  compileContractQuery,
} = require("../../../functions/procurement_query.js");
pinLocalDatabase();
const connectionFailure = (error: unknown): boolean => {
  if (
    error instanceof Error &&
    "errors" in error &&
    Array.isArray(error.errors)
  )
    return error.errors.every(connectionFailure);
  return ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EPERM", "EACCES"].includes(
    String((error as { code?: string })?.code),
  );
};
let skipReason: string | false = false;
try {
  await allRows("SELECT 1");
} catch (error) {
  if (!connectionFailure(error)) throw error;
  skipReason =
    "local Postgres is unreachable; SQL fixtures require a permitted local connection";
}
reportSkip(import.meta.url, skipReason);
afterAll(end);
test.skipIf(Boolean(skipReason))(
  "SQL reconciles independent contract populations, money, periods and three-valued risks",
  async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(`CREATE TEMP TABLE contracts (key text,title text,date text,date_signed text,awarder_eik text,awarder_name text,contractor_eik text,contractor_name text,cpv text,unp text,number_of_tenderers int,amount_eur numeric,signing_amount_eur numeric,joint_kind text,consortium_role text,tag text,eu_funded int,procurement_method text);
    CREATE TEMP TABLE contract_risk_cache(key text,fired int,available int,cri int,fired_mask int,available_mask int);
    CREATE TEMP TABLE contract_risk_meta(only_row bool,catalog_version text,rebuilt_at timestamptz DEFAULT now());
    INSERT INTO contract_risk_meta(only_row,catalog_version) VALUES(true,'1.0.0');
    CREATE TEMP TABLE procurement_query_revisions(resource text,generation bigint,changed_at timestamptz);`);
        for (const row of fixture.contracts) {
          await client.query(
            `INSERT INTO contracts(key,title,date,date_signed,awarder_eik,cpv,number_of_tenderers,amount_eur,signing_amount_eur,consortium_role,tag) VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              row.key,
              row.date,
              row.signed,
              row.buyer === "H" ? "123456789" : "987654321",
              row.cpv,
              row.bids,
              row.amount,
              row.signingAmount,
              row.role,
              row.tag,
            ],
          );
          const flags = [
            { value: row.pep, bit: 2 },
            { value: row.weak, bit: 9 },
            { value: row.direct, bit: 10 },
          ];
          const fired = flags.filter((f) => f.value === true);
          const available = flags.filter((f) => f.value !== null);
          await client.query(
            `INSERT INTO contract_risk_cache VALUES($1,$2,$3,0,$4,$5)`,
            [
              row.key,
              fired.length,
              available.length,
              fired.reduce((n, f) => n + (1 << f.bit), 0),
              available.reduce((n, f) => n + (1 << f.bit), 0),
            ],
          );
        }
        const base = {
          corpus: "contracts",
          operation: "share",
          metric: "oneBid",
          from: "2026-01-01",
          toExclusive: "2027-01-01",
        };
        const run = async (patch: object = {}) => {
          const built = compileContractQuery({ ...base, ...patch });
          return (
            await client.query<{
              result: {
                totals: Record<string, number | string | null>;
                comparison: { records: number };
                groups: Record<string, string | number>[];
                rows: unknown[];
              };
            }>(built.sql, built.params)
          ).rows[0].result;
        };
        const all = await run({ limit: 1 });
        expect(all.totals).toMatchObject({
          records: 6,
          numerator: 3,
          positive_known: 4,
          zero_bids: 1,
          missing_bids: 1,
          missing_value: 1,
          value_eur: "1050",
        });
        expect(all.rows).toHaveLength(1);
        expect((await run({ buyerIds: ["123456789"] })).totals).toMatchObject({
          records: 4,
          value_eur: "750",
        });
        expect((await run({ cpvPrefixes: ["33"] })).totals).toMatchObject({
          records: 3,
          value_eur: "700",
        });
        expect((await run({ valueBasis: "signing" })).totals.value_eur).toBe(
          "1030",
        );
        expect((await run({ dateBasis: "signed" })).totals.records).toBe(1);
        expect((await run({ corpus: "amendments" })).totals).toMatchObject({
          records: 1,
          value_eur: "1000",
        });
        for (const [mode, n, e] of [
          ["any", 3, 5],
          ["all", 1, 5],
        ] as const) {
          expect(
            (
              await run({
                metric: "risk",
                numeratorPredicates: [
                  "risk:weakCompetition",
                  "risk:pepConnected",
                ],
                numeratorMode: mode,
              })
            ).totals,
          ).toMatchObject({ records: 6, numerator: n, evaluable: e });
        }
        expect(
          (
            await run({
              metric: "risk",
              numeratorPredicates: ["!risk:weakCompetition"],
            })
          ).totals,
        ).toMatchObject({ numerator: 2, evaluable: 4 });
        expect(
          (
            await run({
              operation: "compare",
              compareFrom: "2025-01-01",
              compareToExclusive: "2026-01-01",
            })
          ).comparison.records,
        ).toBe(1);
        expect(
          (await run({ operation: "rank", metric: "value", groupBy: "buyer" }))
            .groups[0],
        ).toMatchObject({ group_key: "123456789", value_eur: "750" });
        expect(
          (await run({ from: "2026-02-01", toExclusive: "2026-03-01" })).totals
            .records,
        ).toBe(1);
        const riskKnown = await run({
          metric: "risk",
          numeratorPredicates: ["risk:pepConnected"],
          denominator: "positiveKnown",
        });
        expect(riskKnown.totals).toMatchObject({
          numerator: 1,
          positive_known: 4,
        });
        const secondGroup = await run({
          operation: "rank",
          metric: "value",
          groupBy: "buyer",
          limit: 1,
          offset: 1,
        });
        expect(secondGroup.groups[0].group_key).toBe("987654321");
        await client.query("DELETE FROM contract_risk_cache WHERE key <> 'a1'");
        expect(
          (
            await run({
              operation: "rank",
              metric: "cri",
              groupBy: "buyer",
              minGroupCount: 2,
              minGroupCountBasis: "evaluable",
            })
          ).groups,
        ).toEqual([]);
      } finally {
        await client.query("ROLLBACK");
      }
    });
  },
);
