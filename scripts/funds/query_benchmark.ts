/** Local read-only release probe. Never substitutes synthetic data for a missing corpus. */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { pinLocalDatabase, withClient, end } from "../db/lib/pg";
const { runFundingQuery } = createRequire(import.meta.url)(
  "../../functions/funding_query.js",
);
pinLocalDatabase();
const queries = [
  ["isun-count", { corpus: "isunProjects", operation: "count" }],
  [
    "isun-health",
    { corpus: "isunProjects", operation: "sum", themeIds: ["health"] },
  ],
  [
    "isun-place",
    {
      corpus: "isunProjects",
      operation: "sum",
      placeIds: ["RSE27"],
      placeBasis: "implementation",
    },
  ],
  [
    "isun-concentration",
    {
      corpus: "isunProjects",
      metric: "hhi",
      groupBy: "programme",
      minGroupCount: 5,
    },
  ],
  [
    "dfz-year",
    { corpus: "agriPayments", financialYears: ["2025"], operation: "sum" },
  ],
  [
    "dfz-schemes",
    {
      corpus: "agriPayments",
      financialYears: ["2025"],
      operation: "rank",
      metric: "amount",
      groupBy: "scheme",
    },
  ],
  [
    "interreg-operations",
    {
      corpus: "interregOperations",
      operation: "sum",
      programmingPeriods: ["2021-2027"],
    },
  ],
  [
    "interreg-overlap",
    {
      corpus: "interregOperations",
      operation: "count",
      dateBasis: "overlap",
      from: "2026-01-01",
      toExclusive: "2027-01-01",
    },
  ],
  [
    "interreg-bg-partners",
    {
      corpus: "interregPartners",
      operation: "sum",
      basePredicates: ["bulgarian"],
    },
  ],
] as const;
const results: Record<string, unknown>[] = [];
try {
  await withClient(async (c) => {
    await c.query("SET ROLE app_readonly");
    await c.query("SET statement_timeout='20s'");
    try {
      // Exercise the most frequent observed entity/programme rather than an
      // invented identifier or a uniformly selective synthetic filter.
      const entity = (
        await c.query(
          "SELECT beneficiary_eik FROM fund_projects WHERE beneficiary_eik ~ '^([0-9]{9}|[0-9]{13})$' GROUP BY beneficiary_eik ORDER BY count(*) DESC,beneficiary_eik LIMIT 1",
        )
      ).rows[0]?.beneficiary_eik;
      const programme = (
        await c.query(
          "SELECT program_code FROM fund_projects WHERE program_code IS NOT NULL GROUP BY program_code ORDER BY count(*) DESC,program_code LIMIT 1",
        )
      ).rows[0]?.program_code;
      if (!entity || !programme)
        throw Error("Missing populated entity/programme benchmark cohort");
      const measuredQueries: readonly (readonly [
        string,
        Record<string, unknown>,
      ])[] = [
        ...queries,
        [
          "isun-skewed-entity",
          { corpus: "isunProjects", operation: "sum", entityIds: [entity] },
        ],
        [
          "isun-skewed-programme",
          {
            corpus: "isunProjects",
            operation: "sum",
            programmeIds: [programme],
          },
        ],
      ];
      for (const [label, q] of measuredQueries) {
        const timings: number[] = [];
        let result!: {
          status: string;
          reason?: string;
          revision: string;
          totals: { records: number };
        };
        for (let i = 0; i < 6; i++) {
          const start = performance.now();
          result = (
            await runFundingQuery(
              async (sql: string, params: unknown[]) =>
                (await c.query(sql, params)).rows,
              q,
            )
          ).body;
          timings.push(Math.round(performance.now() - start));
          if (!["success", "partial", "empty"].includes(result.status))
            throw Error(`${label}: ${result.status} ${result.reason}`);
        }
        const sorted = timings.slice(1).sort((a, b) => a - b);
        results.push({
          label,
          firstMs: timings[0],
          warmMs: timings.slice(1),
          warmP95Ms: sorted.at(-1),
          status: result.status,
          revision: result.revision,
          records: result.totals.records,
        });
      }
      // Named prepared statements exercise PostgreSQL's custom and generic plan paths.
      for (const mode of ["force_custom_plan", "force_generic_plan"]) {
        await c.query(`SET plan_cache_mode='${mode}'`);
        const start = performance.now();
        const q = queries[4][1];
        const r = (
          await runFundingQuery(
            async (sql: string, values: unknown[]) =>
              (
                await c.query({
                  name: "funding-release-dfz-" + mode,
                  text: sql,
                  values,
                })
              ).rows,
            q,
          )
        ).body;
        results.push({
          label: mode,
          elapsedMs: Math.round(performance.now() - start),
          status: r.status,
          revision: r.revision,
        });
        if (!["success", "partial", "empty"].includes(r.status))
          throw Error(mode + ":" + r.status);
      }
    } finally {
      await c.query("RESET ROLE");
    }
  });
  const concurrent = await Promise.all(
    [queries[0], queries[4]].map(async ([label, q]) =>
      withClient(async (c) => {
        await c.query("SET ROLE app_readonly");
        await c.query("SET statement_timeout='20s'");
        try {
          const start = performance.now();
          const r = (
            await runFundingQuery(
              async (sql: string, params: unknown[]) =>
                (await c.query(sql, params)).rows,
              q,
            )
          ).body;
          if (!["success", "partial", "empty"].includes(r.status))
            throw Error("concurrent " + label + ":" + r.status);
          return {
            label,
            elapsedMs: Math.round(performance.now() - start),
            status: r.status,
          };
        } finally {
          await c.query("RESET ROLE");
        }
      }),
    ),
  );
  writeFileSync(
    "docs/plans/ai-funding-chat-performance-v1.json",
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        environment: "local PostgreSQL, app_readonly; shared developer machine",
        statementTimeoutMs: 20000,
        warmTargetMs: 2000,
        samplesPerQuery: 6,
        firstRequestIsNotColdDatabaseCache: true,
        results,
        concurrent,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await end();
}
