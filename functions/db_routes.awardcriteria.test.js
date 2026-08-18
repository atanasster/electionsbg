// Route-level unit tests for /api/db/procurement-award-criteria.
//
// The SQL is covered by scripts/db/tests/award_criteria.data.test.ts; this pins
// the JS layer — that the scope window reaches the function as $1/$2 rather than
// being dropped, and that a missing migration 164 degrades to `null` rather than
// 500ing the whole /procurement dashboard.
//
// The degrade path is not hypothetical housekeeping: until the migration reaches
// a given database this is the path production takes, and `null` is the value the
// tile self-suppresses on. Returning `[]` or `{}` instead would render an empty
// chart, which reads as "no criterion is ever recorded".
//
// No DB: a mock `dbRows` records SQL + params and returns canned rows.
// Run: cd functions && npm test

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
const migrationMissing = (code) =>
  Object.assign(new Error("no migration"), { code });

const route = DB_ROUTES["procurement-award-criteria"];

test("procurement-award-criteria is registered", () => {
  assert.equal(typeof route, "function");
});

test("forwards the scope window as $1/$2", async () => {
  const db = mockDb([{ r: { firstYear: "2020", byYear: [], byType: [] } }]);
  await route(db, { from: "2023-04-02", to: "2024-06-09" });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /procurement_award_criteria\(\$1, \$2\)/);
  assert.deepEqual(db.calls[0].params, ["2023-04-02", "2024-06-09"]);
});

test("an absent window becomes NULL, not the empty string", async () => {
  // The SQL COALESCEs NULL to an open bound; '' would also work for `from` but
  // not for `to`, so the distinction is load-bearing on the full-corpus scope.
  const db = mockDb([{ r: {} }]);
  await route(db, {});
  assert.deepEqual(db.calls[0].params, [null, null]);
});

test("returns the payload unwrapped from the row", async () => {
  const payload = { firstYear: "2020", byYear: [{ year: "2020" }], byType: [] };
  const db = mockDb([{ r: payload }]);
  const out = await route(db, {});
  assert.deepEqual(out.body, payload);
});

for (const code of ["42883", "42P01"]) {
  test(`degrades a missing migration (${code}) to null`, async () => {
    const db = mockDb(migrationMissing(code));
    const out = await route(db, {});
    assert.equal(
      out.body,
      null,
      "must be null — the tile self-suppresses on null, while [] or {} would " +
        "render an empty chart that reads as 'no criterion is ever recorded'",
    );
  });
}

test("does NOT swallow an unrelated database error", async () => {
  // A degrade that catches everything would hide a real outage behind a missing
  // tile for ever.
  const db = mockDb(migrationMissing("57014"));
  await assert.rejects(() => route(db, {}), /no migration/);
});
