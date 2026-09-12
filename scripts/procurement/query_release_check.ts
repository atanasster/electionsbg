import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { pinLocalDatabase, allRows, end } from "../db/lib/pg";
const require = createRequire(import.meta.url);
const { runProcurementQuery } = require("../../functions/procurement_query");
pinLocalDatabase();
const cases = [
  {
    name: "contracts-one-bid",
    query: { corpus: "contracts", operation: "share", metric: "oneBid" },
  },
  {
    name: "contracts-direct",
    query: {
      corpus: "contracts",
      operation: "share",
      metric: "risk",
      numeratorPredicates: ["risk:directAward"],
    },
  },
  { name: "tenders", query: { corpus: "tenders", operation: "count" } },
  {
    name: "tenders-risk",
    query: {
      corpus: "tenders",
      operation: "count",
      metric: "risk",
      numeratorPredicates: ["risk:rushedDeadline"],
    },
  },
  {
    name: "complaints",
    query: {
      corpus: "appeals",
      operation: "share",
      metric: "upheld",
      denominator: "merits",
    },
  },
  { name: "decisions", query: { corpus: "decisions", operation: "count" } },
];
const timed = async (query: object) => {
  const started = performance.now();
  const r = await runProcurementQuery(allRows, {
    from: "2026-01-01",
    toExclusive: "2027-01-01",
    limit: 1,
    ...query,
  });
  if (!["success", "partial", "empty"].includes(r.body.status))
    throw Error("Required local query unavailable: " + JSON.stringify(r.body));
  return {
    ms: Math.round(performance.now() - started),
    status: r.body.status,
    totals: r.body.totals,
    revision: r.body.revision,
  };
};
try {
  const results = [];
  for (const c of cases) {
    const first = await timed(c.query);
    const warm = [];
    for (let i = 0; i < 10; i++) warm.push((await timed(c.query)).ms);
    const sorted = [...warm].sort((a, b) => a - b);
    results.push({
      name: c.name,
      firstMs: first.ms,
      warmMs: warm,
      warmP95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      totals: first.totals,
      revision: first.revision,
    });
  }
  const started = performance.now();
  await Promise.all(cases.slice(0, 3).map((c) => timed(c.query)));
  const report = {
    environment:
      "Local PostgreSQL, current working database; warm cache measurements, not production p95",
    targetMs: 2000,
    results,
    concurrentThreeMs: Math.round(performance.now() - started),
  };
  writeFileSync(
    "docs/plans/ai-procurement-chat-release-metrics.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await end();
}
