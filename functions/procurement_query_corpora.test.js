const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateProcurementQuery } = require("./generated/procurement_query");
const { compileOtherQuery } = require("./procurement_query_corpora");
const { runProcurementQuery } = require("./procurement_query");
for (const corpus of ["tenders", "appeals", "decisions"])
  test(`${corpus}: all filters are bound in one snapshot`, () => {
    const parsed = validateProcurementQuery({
      corpus,
      from: "2026-01-01",
      toExclusive: "2027-01-01",
      buyerIds: ["123456789"],
      keyword: "%' OR TRUE --",
      cpvPrefixes: ["33"],
      operation: "rank",
      groupBy: "buyer",
      limit: 1,
      offset: 1,
    });
    assert(parsed.ok);
    const built = compileOtherQuery(parsed.query);
    assert(!built.sql.includes("%' OR TRUE"));
    const indexes = [...built.sql.matchAll(/\$(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    assert.equal(Math.max(...indexes), built.params.length);
    assert.equal(new Set(indexes).size, built.params.length);
    assert.match(built.sql, /EXISTS|buyer_eik/);
    assert.match(built.sql, /ranked_groups/);
    assert.match(built.sql, /OFFSET/);
  });
test("all five corpora execute through the registered service", async () => {
  for (const corpus of [
    "contracts",
    "amendments",
    "tenders",
    "appeals",
    "decisions",
  ]) {
    let calls = 0;
    const response = await runProcurementQuery(
      async () => {
        calls++;
        return [{ result: { totals: { records: 0 }, rows: [] } }];
      },
      { corpus },
    );
    assert.equal(calls, 1);
    assert.equal(response.body.status, "empty");
  }
});
test("missing tender projection and timeout remain unavailable without retry", async () => {
  for (const code of ["42P01", "57014"]) {
    let calls = 0;
    const response = await runProcurementQuery(
      async () => {
        calls++;
        throw Object.assign(Error("database"), { code });
      },
      {
        corpus: "tenders",
        metric: "risk",
        numeratorPredicates: ["risk:rushedDeadline"],
      },
    );
    assert.equal(calls, 1);
    assert.equal(response.body.status, "unavailable");
  }
});
test("tender risk uses the installed version and distinguishes all-unknown observations", async () => {
  const q = {
    corpus: "tenders",
    metric: "risk",
    numeratorPredicates: ["risk:rushedDeadline"],
  };
  for (const [version, evaluable, status] of [
    ["old", 3, "unavailable"],
    [null, 3, "unavailable"],
    ["1.0.0", 0, "partial"],
    ["1.0.0", 3, "success"],
  ]) {
    const r = await runProcurementQuery(
      async () => [
        { result: { totals: { records: 3, evaluable }, riskCatalog: version } },
      ],
      q,
    );
    assert.equal(r.body.status, status);
  }
});
