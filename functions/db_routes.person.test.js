// Route-level unit tests for the three person-declaration API routes (audit T3.8/T3.9/T3.10),
// added to close the D1 gap: the SQL behind these is covered by scripts/db/tests/*.data.test.ts,
// but the JS route layer (param handling, the missing-migration degradation, the shape guards,
// and — most importantly — the T3.10 privacy contract) had no test at all.
//
// No DB: each handler is (dbRows, query) => Promise<{ body }>, so a mock `dbRows` that records
// its SQL + params and returns canned rows exercises every branch. Run: cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES } = require("./db_routes.js");

// A mock query fn. Records every call; returns `result`, or rejects with it if it's an Error
// (used to simulate a missing migration, which the handlers .catch).
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

// The two error codes missingMigrationEmpty catches: undefined_function + undefined_table.
const MIGRATION_CODES = ["42883", "42P01"];
const migrationMissing = (code = "42883") =>
  Object.assign(new Error("no migration"), { code });

// ─── new-filings (T3.10) ────────────────────────────────────────────────────────────────
// The privacy contract: the watchlist is applied in the browser and MUST NOT travel to the
// server. So this route must ignore any `slugs` param entirely and always call the site-wide
// function — never a per-slug one. This is the test that fails if anyone reintroduces
// ?slugs= server-side filtering.
test("new-filings ignores a slugs param and only calls the site-wide function", async () => {
  const db = mockDb([{ r: [{ slug: "x", name: "X" }] }]);
  const res = await DB_ROUTES["new-filings"](db, {
    slugs: "ivan-a,petar-b,georgi-c",
    limit: "10",
  });
  assert.equal(db.calls.length, 1, "exactly one DB call");
  assert.match(
    db.calls[0].sql,
    /declaration_new_filings/,
    "site-wide fn called",
  );
  assert.doesNotMatch(
    db.calls[0].sql,
    /person_new_filings|slug/i,
    "no per-slug function and no slug in the SQL",
  );
  // The slug list reaches neither the SQL nor the params.
  assert.deepEqual(db.calls[0].params, [10], "only the limit is passed");
  assert.deepEqual(res.body, [{ slug: "x", name: "X" }]);
});

test("new-filings clamps the limit to [1,200] with a default of 50", async () => {
  const grab = async (limit) => {
    const db = mockDb([{ r: [] }]);
    await DB_ROUTES["new-filings"](db, { limit });
    return db.calls[0].params[0];
  };
  assert.equal(await grab(undefined), 50, "default");
  assert.equal(await grab("10"), 10, "in range");
  assert.equal(await grab("9999"), 200, "clamped to max");
  assert.equal(await grab("0"), 1, "clamped to min");
  assert.equal(await grab("abc"), 50, "non-numeric → default");
  assert.equal(await grab("12.9"), 12, "fractional → truncated");
});

test("new-filings degrades to [] for either missing-migration code", async () => {
  for (const code of MIGRATION_CODES) {
    const res = await DB_ROUTES["new-filings"](
      mockDb(migrationMissing(code)),
      {},
    );
    assert.deepEqual(res.body, [], `code ${code} degrades to []`);
  }
});

// ─── person-cohort-benchmark (T3.9) ─────────────────────────────────────────────────────
test("person-cohort-benchmark returns null and skips the DB without a slug", async () => {
  const db = mockDb([{ r: {} }]);
  const res = await DB_ROUTES["person-cohort-benchmark"](db, {});
  assert.equal(res.body, null);
  assert.equal(db.calls.length, 0, "no DB call without a slug");
});

test("person-cohort-benchmark passes the object through and degrades an array to null", async () => {
  const obj = { cohort: "mp", percentile: 97 };
  const ok = await DB_ROUTES["person-cohort-benchmark"](mockDb([{ r: obj }]), {
    slug: "mp-2946",
  });
  assert.deepEqual(ok.body, obj, "object payload passes through");

  // The object-shaped route must never emit an array: a missing migration yields [{r:[]}],
  // so r is [] — which must become null, not a shape the client can't read.
  const degraded = await DB_ROUTES["person-cohort-benchmark"](
    mockDb(migrationMissing()),
    { slug: "mp-2946" },
  );
  assert.equal(degraded.body, null, "array/[] degrades to null");
});

// ─── person-stake-procurement (T3.8) ────────────────────────────────────────────────────
test("person-stake-procurement returns [] without a slug and skips the DB", async () => {
  const db = mockDb([{ r: [{ eik: "1" }] }]);
  const res = await DB_ROUTES["person-stake-procurement"](db, {});
  assert.deepEqual(res.body, []);
  // Assert the guard actually short-circuited — mockDb([]) alone would yield [] even if it
  // did not, so the no-DB-call check is what makes this test non-tautological.
  assert.equal(db.calls.length, 0, "no DB call without a slug");
});

test("person-stake-procurement degrades to [] for either missing-migration code", async () => {
  for (const code of MIGRATION_CODES) {
    const res = await DB_ROUTES["person-stake-procurement"](
      mockDb(migrationMissing(code)),
      { slug: "mp-2946" },
    );
    assert.deepEqual(res.body, [], `code ${code} → []`);
  }
});

test("person-stake-procurement passes the row array through", async () => {
  const rows = [{ eik: "112028994", companyName: "РАДИО СОТ" }];
  const res = await DB_ROUTES["person-stake-procurement"](
    mockDb([{ r: rows }]),
    {
      slug: "mp-2946",
    },
  );
  assert.deepEqual(res.body, rows);
});

// ─── the load-bearing degradation boundary ──────────────────────────────────────────────
// missingMigrationEmpty catches ONLY 42883/42P01. Every other DB error must propagate — a
// broadened catch would silently turn a query failure into an empty result on all three
// routes while every test above still passed. Lock the boundary.
test("a non-migration DB error propagates on every route", async () => {
  const realError = Object.assign(new Error("syntax error"), { code: "42601" });
  await assert.rejects(
    () => DB_ROUTES["new-filings"](mockDb(realError), {}),
    /syntax error/,
    "new-filings must not swallow a real error",
  );
  await assert.rejects(
    () =>
      DB_ROUTES["person-cohort-benchmark"](mockDb(realError), { slug: "x" }),
    /syntax error/,
    "person-cohort-benchmark must not swallow a real error",
  );
  await assert.rejects(
    () =>
      DB_ROUTES["person-stake-procurement"](mockDb(realError), { slug: "x" }),
    /syntax error/,
    "person-stake-procurement must not swallow a real error",
  );
});
