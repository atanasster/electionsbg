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

test("default basis counts consortium member rows and says so", async () => {
  const db = mockDb();
  const res = await route(db, { eiks: "130175000,206086428" });
  assert.equal(res.body.exMembers, false);
  assert.ok(!db.calls[0].sql.includes(MEMBER_CLAUSE));
});

test("exMembers=1 drops consortium member rows and says so", async () => {
  const db = mockDb();
  const res = await route(db, { eiks: "130175000", exMembers: "1" });
  assert.equal(res.body.exMembers, true);
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

// ── exFramework ──────────────────────────────────────────────────────────────
// A joint_kind='framework' row (087) is ceiling/N — a share of a framework
// CEILING, not money spent — and on МЗ they nearly double the ministry. The
// switch must reach all three group routes, stay opt-in, and interpolate only a
// literal clause.
const FRAMEWORK_CLAUSE = "joint_kind IS DISTINCT FROM 'framework'";

test("rollup default keeps framework rows in the counts but reports them apart", async () => {
  const db = mockDb();
  const res = await route(db, { eiks: "000695317" });
  assert.equal(res.body.exFramework, false);
  assert.ok(!db.calls[0].sql.includes(FRAMEWORK_CLAUSE));
  // The per-operator framework line is there on either basis.
  assert.ok(db.calls[0].sql.includes('AS "frameworkEur"'));
});

test("rollup exFramework=1 filters framework rows out of every aggregate", async () => {
  const db = mockDb();
  const res = await route(db, { eiks: "000695317", exFramework: "1" });
  assert.equal(res.body.exFramework, true);
  // count, €, bidKnownN, singleBidN and the ORDER BY: five uses.
  assert.equal(db.calls[0].sql.split(FRAMEWORK_CLAUSE).length - 1, 5);
  assert.deepEqual(db.calls[0].params, [["000695317"], null, null]);
});

test("model sends the 4th argument only when exFramework=1", async () => {
  const model = DB_ROUTES["awarder-group-model"];
  const db = mockDb();
  await model(db, { eiks: "000695317" });
  await model(db, { eiks: "000695317", exFramework: "1" });
  await model(db, { eiks: "000695317", exFramework: "true" });
  assert.ok(db.calls[0].sql.includes("awarder_group_model($1, $2, $3) AS r"));
  assert.ok(db.calls[1].sql.includes("awarder_group_model($1, $2, $3, true)"));
  assert.ok(db.calls[2].sql.includes("awarder_group_model($1, $2, $3) AS r"));
  for (const c of db.calls) assert.equal(c.params.length, 3);
});

test("top-contracts exFramework=1 drops ceiling shares and returns jointKind", async () => {
  const top = DB_ROUTES["awarder-group-top-contracts"];
  const db = mockDb();
  const a = await top(db, { eiks: "000695317" });
  const b = await top(db, { eiks: "000695317", exFramework: "1" });
  assert.equal(a.body.exFramework, false);
  assert.equal(b.body.exFramework, true);
  assert.ok(!db.calls[0].sql.includes(FRAMEWORK_CLAUSE));
  assert.ok(db.calls[1].sql.includes(FRAMEWORK_CLAUSE));
  assert.ok(db.calls[0].sql.includes('joint_kind AS "jointKind"'));
});

test("model falls back to the 3-arg call on a pre-D3 061 (42883), not a 500", async () => {
  const model = DB_ROUTES["awarder-group-model"];
  const calls = [];
  const db = (sql, params) => {
    calls.push(sql);
    if (sql.includes(", true)")) {
      const e = new Error("function does not exist");
      e.code = "42883";
      return Promise.reject(e);
    }
    return Promise.resolve([{ r: { totalEur: 1 } }]);
  };
  const res = await model(db, { eiks: "000695317", exFramework: "1" });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes("awarder_group_model($1, $2, $3) AS r"));
  // The echo is absent — that is how the caller learns the switch was ignored.
  assert.equal(res.body.exFramework, undefined);
});

test("model does not swallow a non-42883 error", async () => {
  const model = DB_ROUTES["awarder-group-model"];
  const db = () => {
    const e = new Error("boom");
    e.code = "57014";
    return Promise.reject(e);
  };
  await assert.rejects(model(db, { eiks: "000695317", exFramework: "1" }));
});
