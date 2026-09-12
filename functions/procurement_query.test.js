const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  compileContractQuery,
  runProcurementQuery,
} = require("./procurement_query");
const query = {
  corpus: "contracts",
  operation: "share",
  metric: "oneBid",
  from: "2026-01-01",
  toExclusive: "2027-01-01",
};
test("rejects invalid constraints before executing", async () => {
  for (const bad of [
    { ...query, imaginary: true },
    { ...query, from: "2026-02-30" },
    { ...query, corpus: "tenders" },
  ]) {
    const result = await runProcurementQuery(() => {
      throw Error("must not execute");
    }, bad);
    assert.equal(result.body.status, "unsupported");
  }
});
test("one snapshot, bound values, literal keywords and stable page order", () => {
  const built = compileContractQuery({
    ...query,
    keyword: "x%' OR TRUE --",
    buyerIds: ["123456789"],
    limit: 1,
  });
  assert(!built.sql.includes("x%"));
  assert(built.params.includes("%x\\%' OR TRUE --%"));
  assert.match(built.sql, /IS DISTINCT FROM 'member'/);
  assert.match(built.sql, /totals AS/);
  assert.match(built.sql, /ORDER BY date DESC NULLS LAST, key/);
  const numbers = [...built.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  assert.equal(Math.max(...numbers), built.params.length);
  assert.equal(new Set(numbers).size, built.params.length);
});
test("all contract risks check availability before the fired mask", () => {
  const { PROCUREMENT_RISKS } = require("./generated/procurement_query");
  for (const [bit, id] of PROCUREMENT_RISKS.contracts.entries()) {
    const built = compileContractQuery({
      ...query,
      metric: "risk",
      numeratorPredicates: ["risk:" + id],
    });
    assert.match(built.sql, new RegExp(`available_mask & ${1 << bit}\\)`));
    assert.match(built.sql, /ELSE NULL END/);
  }
});
test("empty differs from unavailable, and timeout never retries", async () => {
  let calls = 0;
  let result = await runProcurementQuery(async () => {
    calls++;
    return [{ result: { totals: { records: 0 }, rows: [] } }];
  }, query);
  assert.equal(result.body.status, "empty");
  assert.equal(calls, 1);
  for (const code of ["57014", "42P01", "42883", "42501"]) {
    calls = 0;
    result = await runProcurementQuery(async () => {
      calls++;
      throw Object.assign(Error("db"), { code });
    }, query);
    assert.equal(result.body.status, "unavailable");
    assert.equal(calls, 1);
  }
});
test("risk catalog mismatch never returns numbers", async () => {
  const result = await runProcurementQuery(
    async () => [{ result: { totals: { records: 4 }, riskCatalog: "old" } }],
    { ...query, metric: "risk", numeratorPredicates: ["risk:weakCompetition"] },
  );
  assert.equal(result.body.status, "unavailable");
  assert.equal(result.body.totals, undefined);
});
test("registered endpoint rejects missing, oversized and malformed JSON", async () => {
  const { DB_ROUTES } = require("./db_routes");
  for (const q of [{}, { query: "x".repeat(16001) }, { query: "{" }]) {
    const result = await DB_ROUTES["procurement-query"](() => {
      throw Error("must not execute");
    }, q);
    assert.equal(result.status, 400);
  }
});
