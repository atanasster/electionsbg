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
    { corpus: "agriPayments", dateBasis: "start" },
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
test("DFZ pushes both explicit years into the indexed source predicate", () => {
  const q = compileFundingQuery({
    corpus: "agriPayments",
    operation: "compare",
    financialYears: ["2025"],
    compareFinancialYears: ["2026"],
  });
  assert.match(q.sql, /c\.year=ANY\(\$\d+::int\[\]\)/);
  assert(q.params.some((x) => Array.isArray(x) && x.join(",") === "2025,2026"));
});
test("Interreg capability arms are independently visible", async () => {
  const { fundingCapabilities } = require("./funding_query");
  const r = await fundingCapabilities(async (sql) => {
    if (sql.startsWith("WITH")) {
      if (sql.includes("JOIN interreg_partners p ON"))
        throw Object.assign(new Error(), { code: "42P01" });
      return [
        {
          result: {
            catalogValid: true,
            catalogVersion: "1.0.0",
            revision: "r",
            identityValid: true,
            totals: {
              records: 1,
              known_amount: 1,
              known_paid: 0,
              beneficiaries: 0,
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
    }
    return [{ ready: true }];
  });
  assert.equal(r.body.corpora.interregOperations.ready, true);
  assert(r.body.corpora.interregOperations.dates.includes("overlap"));
  assert(r.body.corpora.interregOperations.amounts.includes("operationBudget"));
  assert.equal(r.body.corpora.interregPartners.ready, false);
  assert.deepEqual(r.body.corpora.interregPartners.dates, []);
});
test('I09 disable rollback exposes no ready analytics and never broadens scope',async()=>{
 const before=process.env.FUNDING_QUERY_DISABLED;process.env.FUNDING_QUERY_DISABLED='1';
 try{let calls=0;const db=()=>{calls++;throw Error('must not query disabled analytics')};const r=await runFundingQuery(db,{corpus:'isunProjects',themeIds:['health']});assert.equal(r.body.status,'unavailable');const caps=await require('./funding_query').fundingCapabilities(db);assert(Object.values(caps.body.corpora).every(c=>!c.ready));assert.equal(calls,0);}finally{if(before===undefined)delete process.env.FUNDING_QUERY_DISABLED;else process.env.FUNDING_QUERY_DISABLED=before;}
});
