// Route-level unit tests for the connections-graph API routes (connections-engine-v1 §P3.5):
// person-connections (now 2-arg, ?private toggle), graph-ego, graph-global. The SQL is covered by
// scripts/db/tests/{person_connections,graph_ego,graph_payloads}.data.test.ts; this pins the JS route
// layer — param handling, the ?private=1 parse, and the missing-migration degradation (all three must
// degrade to `null`, matching the payload contract, NOT to `[]`).
//
// No DB: a mock `dbRows` records SQL + params and returns canned rows. Run: cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES } = require("./db_routes.js");

function mockDb(result) {
  const calls = [];
  const fn = (sql, params) => {
    calls.push({ sql, params });
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result);
  };
  fn.calls = calls;
  return fn;
}
const migrationMissing = (code = "42883") =>
  Object.assign(new Error("no migration"), { code });

// ─── person-connections: the ?private toggle is RETIRED (2026-09-09) ─────────────────────
// The Tier-V arm was removed from person_connections: it had no consumer and named non-public
// individuals as connections of named public figures. This asserts ?private cannot bring it back
// through the query string — the route must pass ONE argument and ignore the parameter entirely.
// A forwarded 2nd arg would now also be a hard error, since the 2-arg overload no longer exists.
// graph-ego KEEPS its toggle and is asserted separately below. docs/plans/connections-guard-v2.md.
test("person-connections ignores ?private and calls the 1-arg function", async () => {
  for (const q of [
    { slug: "ivan-a", private: "1" },
    { slug: "ivan-a" },
    { slug: "ivan-a", private: "yes" },
  ]) {
    const db = mockDb([{ r: { subject: { slug: "x" }, related: [] } }]);
    await DB_ROUTES["person-connections"](db, q);
    assert.equal(db.calls.length, 1);
    assert.match(db.calls[0].sql, /person_connections\(\$1\)/);
    assert.doesNotMatch(
      db.calls[0].sql,
      /\$2/,
      `?private=${q.private ?? "(absent)"} reached the SQL — the retired Tier-V arm is back`,
    );
    assert.deepEqual(db.calls[0].params, ["ivan-a"]);
  }
});

test("person-connections returns null for a missing slug and does not hit the DB", async () => {
  const db = mockDb([{ r: {} }]);
  const res = await DB_ROUTES["person-connections"](db, {});
  assert.equal(res.body, null);
  assert.equal(db.calls.length, 0);
});

test("person-connections degrades to null (not []) on a missing migration", async () => {
  for (const code of ["42883", "42P01"]) {
    const db = mockDb(migrationMissing(code));
    const res = await DB_ROUTES["person-connections"](db, { slug: "ivan-a" });
    assert.equal(res.body, null, `code ${code} should degrade to null`);
  }
});

test("person-connections rethrows a non-migration error", async () => {
  const db = mockDb(Object.assign(new Error("boom"), { code: "57014" }));
  await assert.rejects(() => DB_ROUTES["person-connections"](db, { slug: "ivan-a" }));
});

// ─── graph-ego ───────────────────────────────────────────────────────────────────────────
test("graph-ego passes slug + private and degrades to null", async () => {
  const db = mockDb([{ r: { subject: { slug: "x" }, companies: [], edges: [] } }]);
  const res = await DB_ROUTES["graph-ego"](db, { slug: "ivan-a", private: "1" });
  assert.match(db.calls[0].sql, /person_graph_ego\(\$1, \$2\)/);
  assert.deepEqual(db.calls[0].params, ["ivan-a", true]);
  assert.ok(res.body);

  const missing = mockDb(migrationMissing("42P01"));
  assert.equal((await DB_ROUTES["graph-ego"](missing, { slug: "ivan-a" })).body, null);

  const noSlug = mockDb([{ r: {} }]);
  assert.equal((await DB_ROUTES["graph-ego"](noSlug, {})).body, null);
  assert.equal(noSlug.calls.length, 0, "no DB call without a slug");
});

// ─── graph-global ──────────────────────────────────────────────────────────────────────────
test("graph-global reads the global blob and degrades to null when unbuilt", async () => {
  const blob = { companies: [], persons: [], edges: [], matrix: [] };
  const db = mockDb([{ payload: blob }]);
  const res = await DB_ROUTES["graph-global"](db);
  assert.match(db.calls[0].sql, /graph_payloads WHERE scope = 'global'/);
  assert.deepEqual(res.body, blob);

  for (const code of ["42883", "42P01"]) {
    const missing = mockDb(migrationMissing(code));
    assert.equal(
      (await DB_ROUTES["graph-global"](missing)).body,
      null,
      `graph-global should degrade to null on ${code}`,
    );
  }
});
