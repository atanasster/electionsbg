// Route-level unit tests for /api/db/awarder-group-rollup.
//
// Pins the exMembers switch (docs/plans/water-hub-v1.md G1/G3): the water browse
// pack counts ex-members, so its strip must be able to ask for the same basis,
// while the default stays member-inclusive for the defense strip that was sized
// on it. No DB: a mock `dbRows` records SQL + params.
// Run: cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES } = require("./db_routes.js");

function mockDb() {
  const calls = [];
  const fn = (sql, params) => {
    calls.push({ sql, params });
    return Promise.resolve([]);
  };
  fn.calls = calls;
  return fn;
}

const route = DB_ROUTES["awarder-group-rollup"];
const MEMBER_CLAUSE = "consortium_role IS DISTINCT FROM 'member'";

test("default basis counts consortium member rows", async () => {
  const db = mockDb();
  await route(db, { eiks: "130175000,206086428" });
  assert.ok(!db.calls[0].sql.includes(MEMBER_CLAUSE));
});

test("exMembers=1 drops consortium member rows", async () => {
  const db = mockDb();
  await route(db, { eiks: "130175000", exMembers: "1" });
  assert.ok(db.calls[0].sql.includes(MEMBER_CLAUSE));
  // The switch adds a literal clause only — nothing from the request is
  // interpolated, and the parameters are unchanged.
  assert.deepEqual(db.calls[0].params, [["130175000"], null, null]);
});

test("any other exMembers value keeps the default", async () => {
  const db = mockDb();
  await route(db, { eiks: "130175000", exMembers: "true" });
  assert.ok(!db.calls[0].sql.includes(MEMBER_CLAUSE));
});
