// Route-level tests for /api/db/company-filings — the JS layer over 205's
// company_announced_acts(). The SQL is covered by
// scripts/db/tests/tr_announced_act.data.test.ts.
//
// No DB: the handler is (dbRows, query) => Promise<{ body }>. Run: cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES } = require("./db_routes.js");

const route = DB_ROUTES["company-filings"];

const stubDb = (payload) => {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    return [{ r: payload }];
  };
  fn.calls = calls;
  return fn;
};

const throwingDb = (code) => async () => {
  const e = new Error(`stub ${code}`);
  e.code = code;
  throw e;
};

test("binds a 9- or 13-digit EIK", async () => {
  for (const eik of ["207211849", "1752013040123"]) {
    const db = stubDb({ acts: [], inCr: false, coverage: null });
    await route(db, { eik });
    assert.deepEqual(db.calls[0].params, [eik]);
  }
});

test("refuses a malformed EIK without touching the database", async () => {
  for (const eik of ["", "12345", "obed-abc", "2072118490"]) {
    const db = stubDb({});
    const r = await route(db, { eik });
    assert.equal(r.status, 400);
    assert.equal(db.calls.length, 0);
  }
});

test("a database without 205 degrades to an empty, coverage-less list", async () => {
  for (const code of ["42883", "42P01"]) {
    const r = await route(throwingDb(code), { eik: "207211849" });
    assert.deepEqual(r.body, { acts: [], inCr: false, coverage: null });
  }
});

test("any other database error still fails loudly", async () => {
  await assert.rejects(route(throwingDb("57014"), { eik: "207211849" }));
});
