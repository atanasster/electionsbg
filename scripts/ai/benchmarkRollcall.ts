import {
  capabilityGate,
  warmP95,
  CAPABILITY_WARM_TARGET_MS,
} from "./rollcallBenchmarkGate";
/** Local populated-data performance gate; never follows ambient DATABASE_URL. */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { pinLocalDatabase, withClient, end } from "../db/lib/pg";
import {
  encodeRollcallQuery,
  validateRollcallQuery,
} from "../../src/lib/rollcallQuery";
const {
  compileRollcallQuery,
  runRollcallQuery,
  rollcallEntities,
  rollcallCapabilities,
} = createRequire(import.meta.url)("../../functions/rollcall_query.js");
pinLocalDatabase();
const output = process.argv[2] || "/tmp/rollcall-benchmark.json";
const round = (n: number) => Math.round(n * 10) / 10;
const role = async <T>(
  fn: (c: import("pg").PoolClient) => Promise<T>,
): Promise<T> =>
  withClient(async (c) => {
    await c.query("BEGIN READ ONLY");
    try {
      await c.query(
        "SET LOCAL ROLE app_readonly; SET LOCAL statement_timeout='10s'",
      );
      return await fn(c);
    } finally {
      await c.query("ROLLBACK");
    }
  });
const literal = (v: unknown): string =>
  Array.isArray(v)
    ? `ARRAY[${v.map(literal).join(",")}]`
    : typeof v === "number"
      ? String(v)
      : "'" + String(v).replace(/'/g, "''") + "'";
const results: Record<string, unknown>[] = [];
try {
  const seats = await role(async (c) => {
    const r = await rollcallEntities(
      async (s: string, p: unknown[]) => (await c.query(s, p)).rows,
      { corpus: "parliamentCasts", name: "Бойко Рашков" },
    );
    if (r.body.candidates?.length !== 1 || !r.body.candidates[0].verified)
      throw Error("Rashkov identity is not uniquely verified in this snapshot");
    return r.body.candidates[0].seatIds as string[];
  });
  const latestSeat = seats
    .slice()
    .sort((a, b) => +b.split(":")[0] - +a.split(":")[0])[0];
  const peer = await role(
    async (c) =>
      (
        await c.query(
          "SELECT ns::text||':'||mp_id::text AS key FROM mp_seat WHERE ns=$1 AND mp_id<>$2 ORDER BY mp_id LIMIT 1",
          latestSeat.split(":"),
        )
      ).rows[0].key,
  );
  const parentScope = validateRollcallQuery({
    corpus: "parliamentVotes",
    from: "2026-01-01",
    toExclusive: "2027-01-01",
    topicIds: ["budget"],
    limit: 1,
  });
  if (!parentScope.ok) throw Error(parentScope.errors.join(","));
  const parent = encodeRollcallQuery(parentScope.query);
  const cases: [string, Record<string, unknown>][] = [
    ["latest_sessions", { corpus: "parliamentSessions" }],
    [
      "latest_person_casts",
      { corpus: "parliamentCasts", seatIds: [latestSeat], latestN: 10 },
    ],
    [
      "cross_term_person",
      { corpus: "parliamentCasts", seatIds: seats, latestN: 10 },
    ],
    [
      "topic_date_range",
      {
        corpus: "parliamentVotes",
        topicIds: ["budget"],
        from: "2025-04-01",
        toExclusive: "2026-02-01",
      },
    ],
    [
      "council_named",
      { corpus: "councilCasts", councilIds: ["SOF"], latestN: 10 },
    ],
    [
      "monthly_groups",
      {
        corpus: "parliamentCasts",
        seatIds: [latestSeat],
        operation: "trend",
        groupBy: "month",
      },
    ],
    [
      "pair_agreement",
      {
        corpus: "parliamentCasts",
        seatIds: [latestSeat],
        comparatorSeatIds: [peer],
        metric: "agreement",
      },
    ],
    [
      "full_parent_casts",
      {
        corpus: "parliamentCasts",
        parentQuery: parent,
        relationship: "voteCasts",
      },
    ],
  ];
  for (const [name, q] of cases) {
    const row = await role(async (c) => {
      const db = async (s: string, p: unknown[]) => (await c.query(s, p)).rows;
      const samples: number[] = [];
      let status = "";
      for (let i = 0; i < 7; i++) {
        const start = performance.now();
        const response = await runRollcallQuery(db, q);
        samples.push(round(performance.now() - start));
        status = response.body.status;
        if (!["success", "partial", "empty"].includes(status))
          throw Error(name + ": " + JSON.stringify(response.body));
      }
      const compiled = compileRollcallQuery(q);
      const plans: Record<string, unknown> = {};
      for (const mode of ["force_custom_plan", "force_generic_plan"]) {
        await c.query("SET LOCAL plan_cache_mode=" + mode);
        const prepared = "rollcall_" + name + "_" + mode;
        await c.query({
          name: prepared,
          text: compiled.sql,
          values: compiled.params,
        });
        const args = compiled.params.length
          ? "(" + compiled.params.map(literal).join(",") + ")"
          : "";
        const plan = (
          await c.query(
            `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) EXECUTE ${prepared}${args}`,
          )
        ).rows[0]["QUERY PLAN"][0];
        plans[mode] = plan;
      }
      const warm = samples.slice(1).sort((a, b) => a - b);
      return {
        name,
        query: q,
        status,
        firstMs: samples[0],
        warmMs: samples.slice(1),
        warmP95Ms: warm[Math.ceil(warm.length * 0.95) - 1],
        plans,
      };
    });
    results.push(row);
    writeFileSync(
      output,
      JSON.stringify({ incomplete: true, results }, null, 2) + "\n",
    );
    console.log(name, row.firstMs, row.warmP95Ms);
  }
  const concurrent = await Promise.all(
    cases.slice(0, 4).map(async ([name, q]) =>
      role(async (c) => {
        const start = performance.now();
        const r = await runRollcallQuery(
          async (s: string, p: unknown[]) => (await c.query(s, p)).rows,
          q,
        );
        return {
          name,
          ms: round(performance.now() - start),
          status: r.body.status,
        };
      }),
    ),
  );
  const capability = await role(async (c) => {
    const samples: number[] = [];
    const responses: unknown[] = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      const response = await rollcallCapabilities(
        async (s: string, p: unknown[]) => (await c.query(s, p)).rows,
      );
      responses.push(response.body);
      samples.push(round(performance.now() - start));
    }
    return {
      samples,
      pass: capabilityGate(responses, samples),
      warmP95Ms: warmP95(samples),
      warmTargetMs: CAPABILITY_WARM_TARGET_MS,
    };
  });
  const pass =
    capability.pass &&
    results.every((r) => Number(r.warmP95Ms) < 2000) &&
    concurrent.every((r) => ["success", "partial", "empty"].includes(r.status));
  writeFileSync(
    output,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        target: "local Docker PostgreSQL",
        role: "app_readonly",
        timeoutMs: 10000,
        warmTargetMs: 2000,
        pass,
        results,
        concurrent,
        capability,
      },
      null,
      2,
    ) + "\n",
  );
  if (!pass) process.exitCode = 1;
} finally {
  await end();
}
