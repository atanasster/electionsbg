const test = require("node:test");
const assert = require("node:assert/strict");
const { compileFundingQuery, runFundingQuery } = require("./funding_query");
test("malicious text stays bound and canonical scope survives", () => {
  const q = compileFundingQuery({
    corpus: "isunProjects",
    keyword: "x%' OR TRUE --",
    themeIds: ["health"],
    amountMin: 100,
  });
  assert(!q.sql.includes("x%'"));
  assert(q.params.includes("%x\\%' OR TRUE --%"));
  assert.equal(q.query.amountMin, 100);
});
test("unsupported dates and unimplemented corpora cannot run a broad fallback", async () => {
  let calls = 0;
  for (const raw of [
    { corpus: "isunProjects", dateBasis: "signed" },
    { corpus: "agriPayments" },
  ]) {
    assert.equal(
      (
        await runFundingQuery(() => {
          calls++;
        }, raw)
      ).body.status,
      "unsupported",
    );
  }
  assert.equal(calls, 0);
});
test("missing projection and timeout remain unavailable", async () => {
  for (const code of ["42P01", "57014", "42501"])
    assert.equal(
      (
        await runFundingQuery(
          () => {
            throw Object.assign(new Error(), { code });
          },
          { corpus: "isunProjects" },
        )
      ).body.status,
      "unavailable",
    );
});
test("capabilities suppress missing optional evidence while basic counts stay ready", async () => {
  const { fundingCapabilities } = require("./funding_query");
  const r = await fundingCapabilities(async (sql) => {
    if (sql.startsWith("WITH"))
      return [
        {
          result: {
            catalogValid: true,
            catalogVersion: "1.0.0",
            revision: "r",
            totals: {
              records: 1,
              known_amount: 1,
              known_paid: 0,
              beneficiaries: 1,
            },
            candidateRecords: 1,
            dateUnknown: 0,
            amountUnknown: 0,
            scopeRecords: 1,
            baseEvaluable: 1,
            numeratorScope: 1,
            numeratorEvaluable: 1,
          },
        },
      ];
    throw Object.assign(new Error(), { code: "42P01" });
  });
  assert.equal(r.body.corpora.isunProjects.ready, true);
  assert.deepEqual(r.body.corpora.isunProjects.dates, ["none"]);
  assert.deepEqual(r.body.corpora.isunProjects.predicates, [
    "unidentified",
    "serialWinner",
  ]);
});
