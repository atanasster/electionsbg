// Route-level tests for /api/db/place-companies — the JS layer of the "фирми,
// регистрирани тук" tile (migration 133). The SQL is covered by
// scripts/db/tests/tr_company_place.data.test.ts.
//
// The properties worth pinning here are all about which PLACE gets answered.
// The SQL function ORs its two predicates, so a request that carries both an
// ekatte and an obshtina would return the UNION of a settlement and a
// municipality — a number nobody asked for, served as a fact about one place.
// The handler resolves that to exactly one before it reaches SQL.
//
// No DB: the handler is (dbRows, query) => Promise<{ body }>. Run: cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES } = require("./db_routes.js");

const handler = DB_ROUTES["place-companies"];

const stubDb = (payload = { count: 0, companies: [] }) => {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    return [{ r: payload }];
  };
  fn.calls = calls;
  return fn;
};

test("a settlement request binds ekatte and NULLs obshtina", async () => {
  const db = stubDb();
  await handler(db, { ekatte: "21193" });
  assert.deepEqual(db.calls[0].params, ["21193", null, 5]);
});

test("a municipality request binds obshtina and NULLs ekatte", async () => {
  const db = stubDb();
  await handler(db, { obshtina: "VID33" });
  assert.deepEqual(db.calls[0].params, [null, "VID33", 5]);
});

test("both params sent → ekatte wins, so one place is answered", async () => {
  const db = stubDb();
  await handler(db, { ekatte: "68134", obshtina: "VID33" });
  assert.deepEqual(
    db.calls[0].params,
    ["68134", null, 5],
    "an ekatte+obshtina request must not OR two places together",
  );
});

test("neither param → 400 before a query runs", async () => {
  const db = stubDb();
  const res = await handler(db, {});
  assert.equal(res.status, 400);
  assert.equal(db.calls.length, 0);
});

test("a malformed place is rejected, not passed to SQL", async () => {
  for (const q of [
    { ekatte: "abc" },
    { ekatte: "123" },
    { obshtina: "vid33" },
    { obshtina: "VID3" },
    { ekatte: "'; DROP TABLE tr_company_place; --" },
  ]) {
    const db = stubDb();
    const res = await handler(db, q);
    assert.equal(res.status, 400, `${JSON.stringify(q)} should 400`);
    assert.equal(db.calls.length, 0);
  }
});

test("limit is clamped to the function's ceiling", async () => {
  for (const [given, expected] of [
    [undefined, 5],
    ["1", 1],
    ["50", 50],
    ["999", 50],
    ["0", 1],
    ["-3", 1],
    ["12.5", 12],
    ["nonsense", 5],
  ]) {
    const db = stubDb();
    await handler(db, { ekatte: "21193", limit: given });
    assert.equal(db.calls[0].params[2], expected, `limit=${given}`);
  }
});

test("a missing migration degrades to an empty place, not a 500", async () => {
  const db = async () => {
    const e = new Error(
      "function place_companies(text, text, integer) does not exist",
    );
    e.code = "42883";
    throw e;
  };
  const res = await handler(db, { ekatte: "21193" });
  assert.equal(res.status, undefined);
  assert.deepEqual(res.body, {
    count: 0,
    moneyCount: 0,
    politicalCount: 0,
    companies: [],
  });
});

test("a real database error still propagates", async () => {
  const db = async () => {
    const e = new Error("connection terminated");
    e.code = "57P01";
    throw e;
  };
  await assert.rejects(() => handler(db, { ekatte: "21193" }));
});
