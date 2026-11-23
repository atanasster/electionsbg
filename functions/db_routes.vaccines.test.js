// Route-level unit tests for /api/db/vaccines-overview and /api/db/vaccines-oblast.
//
// The SQL will be covered by scripts/db/tests/vaccines.data.test.ts (T8); this pins the JS
// layer — that the season reaches the function validated, that the oblast
// family is an allowlist, and that a missing migration 206 degrades to `null`
// rather than `[]` (an empty array is truthy and would read as "no shots
// recorded").
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
const fail = (code) => Object.assign(new Error("db"), { code });

const overview = DB_ROUTES["vaccines-overview"];
const oblast = DB_ROUTES["vaccines-oblast"];

test("both routes are registered", () => {
  assert.equal(typeof overview, "function");
  assert.equal(typeof oblast, "function");
});

test("overview forwards a four-digit season and NULLs anything else", async () => {
  const db = mockDb([{ r: { season: 2025 } }]);
  const out = await overview(db, { season: "2025" });
  assert.deepEqual(db.calls[0].params, [2025]);
  assert.deepEqual(out.body, { season: 2025 });
  await overview(db, { season: "2025; drop" });
  await overview(db, {});
  assert.deepEqual(db.calls[1].params, [null]);
  assert.deepEqual(db.calls[2].params, [null]);
});

test("overview degrades a missing 206 to null, and rethrows anything else", async () => {
  for (const code of ["42883", "42P01"]) {
    const out = await overview(mockDb(fail(code)), {});
    assert.equal(out.body, null);
  }
  await assert.rejects(overview(mockDb(fail("57014")), {}));
});

test("oblast validates the family against its allowlist", async () => {
  const db = mockDb([{ oblastCode: "PVN" }]);
  await oblast(db, { season: "2025", family: "flu_all" });
  assert.deepEqual(db.calls[0].params, [2025, "flu_all"]);
  await oblast(db, { season: "2025", family: "covid" });
  const main = db.calls.filter((c) => c.sql.includes("vaccines_oblast"));
  assert.deepEqual(main[1].params, [2025, "flu"]);
});

test("oblast without a season answers null without querying", async () => {
  const db = mockDb([]);
  const out = await oblast(db, {});
  assert.equal(out.body, null);
  assert.equal(db.calls.length, 0);
});

test("oblast degrades a missing 206 to null, not an empty array", async () => {
  const out = await oblast(mockDb(fail("42P01")), { season: "2025" });
  assert.equal(out.body, null);
});

test("oblast answers null for a season the data does not hold", async () => {
  const out = await oblast(mockDb([]), { season: "2030" });
  assert.equal(out.body, null);
});

test("oblast labels its rows with season, basis, population and as-of", async () => {
  const db = (sql) =>
    Promise.resolve(
      sql.includes("vaccine_source_asof")
        ? [{ asOf: "2026-11-23T06:08:00Z" }]
        : [{ completeThrough: "2026-10", oblastCode: "PVN", per1000: 59.7 }],
    );
  const out = await oblast(db, { season: "2026", family: "flu_all" });
  assert.deepEqual(out.body, {
    season: 2026,
    family: "flu_all",
    basis: "his_monthly",
    population: "nzis_60plus",
    asOf: "2026-11-23T06:08:00Z",
    completeThrough: "2026-10",
    rows: [{ oblastCode: "PVN", per1000: 59.7 }],
  });
});
