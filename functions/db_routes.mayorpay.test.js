// Route-level tests for /api/db/mayor-pay and /api/db/mayor-pay-ranking
// (migration 186). The SQL is covered by scripts/db/tests/mayor_pay.data.test.ts.
//
// No DB: the handler is (dbRows, query) => Promise<{ body }>. Run: cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES } = require("./db_routes.js");

const single = DB_ROUTES["mayor-pay"];
const ranking = DB_ROUTES["mayor-pay-ranking"];

const stubDb = (payload) => {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    return [{ r: payload }];
  };
  fn.calls = calls;
  return fn;
};

const stubRows = (rows) => {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    return rows;
  };
  fn.calls = calls;
  return fn;
};

test("mayor-pay: uppercases and binds obshtina", async () => {
  const db = stubDb(null);
  await single(db, { obshtina: "dob03" });
  assert.deepEqual(db.calls[0].params, ["DOB03"]);
});

test("mayor-pay: missing obshtina -> 400 before a query runs", async () => {
  const db = stubDb(null);
  const res = await single(db, {});
  assert.equal(res.status, 400);
  assert.equal(db.calls.length, 0);
});

test("mayor-pay: a malformed place is rejected, not passed to SQL", async () => {
  for (const q of [
    { obshtina: "" },
    { obshtina: "d" },
    { obshtina: "'; DROP TABLE declaration; --" },
  ]) {
    const db = stubDb(null);
    const res = await single(db, q);
    assert.equal(res.status, 400, `${JSON.stringify(q)} should 400`);
    assert.equal(db.calls.length, 0);
  }
});

test("mayor-pay: a missing migration degrades to null, not a 500", async () => {
  const db = async () => {
    const e = new Error("function mayor_pay_by_obshtina(text) does not exist");
    e.code = "42883";
    throw e;
  };
  const res = await single(db, { obshtina: "DOB03" });
  assert.equal(res.status, undefined);
  assert.equal(res.body, null);
});

test("mayor-pay: a real database error still propagates", async () => {
  const db = async () => {
    const e = new Error("connection terminated");
    e.code = "57P01";
    throw e;
  };
  await assert.rejects(() => single(db, { obshtina: "DOB03" }));
});

test("mayor-pay-ranking: limit is clamped to [1, 1000], default 300", async () => {
  for (const [given, expected] of [
    [undefined, 300],
    ["1", 1],
    ["500", 500],
    ["5000", 1000],
    ["0", 1],
    ["-3", 1],
    ["12.5", 12],
    ["nonsense", 300],
  ]) {
    const db = stubRows([]);
    await ranking(db, { limit: given });
    assert.equal(db.calls[0].params[0], expected, `limit=${given}`);
  }
});

test("mayor-pay-ranking: a missing migration degrades to an empty list, not a 500", async () => {
  const db = async () => {
    const e = new Error("relation mayor_pay_ranking does not exist");
    e.code = "42P01";
    throw e;
  };
  const res = await ranking(db, {});
  assert.equal(res.status, undefined);
  assert.deepEqual(res.body, []);
});

test("mayor-pay-ranking: a real database error still propagates", async () => {
  const db = async () => {
    const e = new Error("connection terminated");
    e.code = "57P01";
    throw e;
  };
  await assert.rejects(() => ranking(db, {}));
});
