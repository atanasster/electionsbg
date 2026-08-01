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

// ─── person-breakdowns (person-procurement-browser T5) ───────────────────────────────────
// The slug-keyed by-company / by-settlement cuts. Two independently-degrading queries behind
// one route, so it needs the same null-guard + dual-degradation + real-error coverage as its
// sibling above.
test("person-breakdowns returns empty cuts without a slug and skips the DB", async () => {
  const db = mockDb([{ r: [{ eik: "1" }] }]);
  const res = await DB_ROUTES["person-breakdowns"](db, {});
  assert.deepEqual(res.body, { byCompany: [], bySettlement: [] });
  // The guard must short-circuit before touching the DB.
  assert.equal(db.calls.length, 0, "no slug → no query");
});

test("person-breakdowns degrades BOTH cuts to [] for either missing-migration code", async () => {
  for (const code of MIGRATION_CODES) {
    const res = await DB_ROUTES["person-breakdowns"](
      mockDb(migrationMissing(code)),
      { slug: "x" },
    );
    assert.deepEqual(
      res.body,
      { byCompany: [], bySettlement: [] },
      `both cuts degrade for ${code}`,
    );
  }
});

test("person-breakdowns passes each cut's rows through", async () => {
  const rows = [{ eik: "1", totalEur: 5, contractCount: 1 }];
  const res = await DB_ROUTES["person-breakdowns"](mockDb([{ r: rows }]), {
    slug: "x",
  });
  assert.deepEqual(res.body, { byCompany: rows, bySettlement: rows });
});

test("person-breakdowns must not swallow a real error", async () => {
  const realError = Object.assign(new Error("syntax error"), { code: "42601" });
  await assert.rejects(
    () => DB_ROUTES["person-breakdowns"](mockDb(realError), { slug: "x" }),
    /syntax error/,
  );
});

// ─── mp-entry / mp-declarations / mp-assets (persons-pg-retirement T0.3) ─────────────────
// Two of the three are OBJECT-shaped, and missingMigrationEmpty degrades to the array
// sentinel `[{ r: [] }]` — so they need the `Array.isArray(r) ? null : r` guard or they
// serve an array where the client destructures an object. That guard is one line and reads
// like a redundant safety check, which is exactly why it needs a test before someone
// "simplifies" it away.
test("mp-* routes degrade to their own empty shape on a missing migration", async () => {
  for (const code of MIGRATION_CODES) {
    const entry = await DB_ROUTES["mp-entry"](mockDb(migrationMissing(code)), {
      id: "10",
    });
    assert.equal(entry.body, null, `mp-entry (${code}) must degrade to null`);

    const assets = await DB_ROUTES["mp-assets"](mockDb(migrationMissing(code)), {
      slug: "mp-10",
    });
    assert.equal(assets.body, null, `mp-assets (${code}) must degrade to null`);

    const decls = await DB_ROUTES["mp-declarations"](
      mockDb(migrationMissing(code)),
      { slug: "mp-10" },
    );
    assert.deepEqual(
      decls.body,
      [],
      `mp-declarations (${code}) must degrade to []`,
    );
  }
});

// Without a key there is nothing to look up, and the route must not reach the database at
// all — a bare `SELECT mp_entry(NULL, NULL)` would be a pointless round trip on every
// malformed request.
test("mp-* routes short-circuit when no key is supplied", async () => {
  const db = mockDb([{ r: null }]);
  assert.equal((await DB_ROUTES["mp-entry"](db, {})).body, null);
  assert.deepEqual((await DB_ROUTES["mp-declarations"](db, {})).body, []);
  assert.equal((await DB_ROUTES["mp-assets"](db, {})).body, null);
  assert.equal(db.calls.length, 0, "no DB call without a key");
});

// mp-entry takes EITHER key. The id path must pass a number and a null slug, the slug path
// the reverse — swapping them would silently look up a slug in the id space and answer null
// for every real MP.
test("mp-entry passes id and slug through in the right positions", async () => {
  const byId = mockDb([{ r: { id: 10 } }]);
  await DB_ROUTES["mp-entry"](byId, { id: "10" });
  assert.deepEqual(byId.calls[0].params, [10, null]);

  const bySlug = mockDb([{ r: { id: 10 } }]);
  await DB_ROUTES["mp-entry"](bySlug, { slug: "mp-10" });
  assert.deepEqual(bySlug.calls[0].params, [null, "mp-10"]);
});

// An out-of-range or malformed id must MISS, never be clamped onto a different MP. The
// first cut capped at 1_000_000, so `?id=99999999` answered for MP 1000000 — a real entity,
// a wrong answer, and no error.
test("mp-entry does not clamp an out-of-range id onto another MP", async () => {
  const db = mockDb([{ r: null }]);
  await DB_ROUTES["mp-entry"](db, { id: "99999999" });
  assert.equal(db.calls[0].params[0], 99999999, "id must reach SQL unclamped");

  const zero = mockDb([{ r: null }]);
  await DB_ROUTES["mp-entry"](zero, { id: "0" });
  assert.equal(zero.calls[0].params[0], 0, "id 0 must stay 0, not become 1");
});

// A real database error is not a missing migration and must propagate — degrading it to an
// empty body would render an MP as "no data" during an outage.
test("mp-* routes propagate non-migration errors", async () => {
  const boom = Object.assign(new Error("connection reset"), { code: "08006" });
  await assert.rejects(() => DB_ROUTES["mp-entry"](mockDb(boom), { id: "10" }));
  await assert.rejects(() =>
    DB_ROUTES["mp-assets"](mockDb(boom), { slug: "mp-10" }),
  );
  await assert.rejects(() =>
    DB_ROUTES["mp-declarations"](mockDb(boom), { slug: "mp-10" }),
  );
});

// ─── municipal-officials-* routes (persons-pg-retirement-v1 T1.5) ──────────────────────────
// Both routes aggregate a single jsonb array and wrap it as { entries }. The SQL invariants
// (roster grain, candidateLink, the fold-CTE dedup + namesake guard) are pinned by
// scripts/db/tests/*.data.test.ts against a loaded DB; these pin the thin JS layer — the
// rows[0].r unwrap, the {entries} shape, and the missing-migration degradation to [].
test("municipal-officials-name-index unwraps rows[0].r into { entries }", async () => {
  const entries = [
    { slug: "s1", name: "N1", role: "mayor", municipality: "Бургас" },
  ];
  const db = mockDb([{ r: entries }]);
  const res = await DB_ROUTES["municipal-officials-name-index"](db);
  assert.equal(db.calls.length, 1, "exactly one DB call");
  assert.deepEqual(res.body, { entries });
});

test("municipal-officials-search-index unwraps rows[0].r into { entries }", async () => {
  const entries = [
    { slug: "s1", name: "N1", role: "mayor", municipality: "", personSlug: "p1" },
  ];
  const db = mockDb([{ r: entries }]);
  const res = await DB_ROUTES["municipal-officials-search-index"](db);
  assert.equal(db.calls.length, 1, "exactly one DB call");
  assert.deepEqual(res.body, { entries });
});

// Missing migration (unloaded / pre-migration DB) must degrade to an empty list, never throw —
// the header search + name resolver render empty rather than crashing the page.
test("municipal-officials-* routes degrade to empty entries on a missing migration", async () => {
  for (const code of MIGRATION_CODES) {
    for (const route of [
      "municipal-officials-name-index",
      "municipal-officials-search-index",
    ]) {
      const res = await DB_ROUTES[route](mockDb(migrationMissing(code)));
      assert.deepEqual(res.body, { entries: [] }, `${route} @ ${code}`);
    }
  }
});

// A real (non-migration) DB error must propagate, not render an empty search index.
test("municipal-officials-* routes propagate non-migration errors", async () => {
  const boom = Object.assign(new Error("connection reset"), { code: "08006" });
  await assert.rejects(() =>
    DB_ROUTES["municipal-officials-name-index"](mockDb(boom)),
  );
  await assert.rejects(() =>
    DB_ROUTES["municipal-officials-search-index"](mockDb(boom)),
  );
});

// ─── mp-networth-rank (persons-pg-retirement-v1 T2.2) ──────────────────────────────────────
// Object-shaped like mp-entry/mp-assets: it unwraps rows[0].r, degrades a missing migration
// to null (not an array), and short-circuits without a DB call when a required key is absent.
test("mp-networth-rank unwraps rows[0].r and needs both mpId + ns", async () => {
  const payload = { rank: 1, cohortSize: 127, median: 60844 };
  const db = mockDb([{ r: payload }]);
  const res = await DB_ROUTES["mp-networth-rank"](db, { mpId: "5100", ns: "52" });
  assert.equal(db.calls.length, 1, "one DB call");
  assert.deepEqual(res.body, payload);

  const noMp = mockDb([{ r: payload }]);
  assert.equal((await DB_ROUTES["mp-networth-rank"](noMp, { ns: "52" })).body, null);
  assert.equal(noMp.calls.length, 0, "no mpId → no DB call");

  const noNs = mockDb([{ r: payload }]);
  assert.equal((await DB_ROUTES["mp-networth-rank"](noNs, { mpId: "5100" })).body, null);
  assert.equal(noNs.calls.length, 0, "no ns → no DB call");
});

test("mp-networth-rank degrades to null on a missing migration, propagates real errors", async () => {
  for (const code of MIGRATION_CODES) {
    const res = await DB_ROUTES["mp-networth-rank"](mockDb(migrationMissing(code)), {
      mpId: "10",
      ns: "52",
    });
    assert.equal(res.body, null, `mp-networth-rank @ ${code} → null`);
  }
  const boom = Object.assign(new Error("connection reset"), { code: "08006" });
  await assert.rejects(() =>
    DB_ROUTES["mp-networth-rank"](mockDb(boom), { mpId: "10", ns: "52" }),
  );
});

// ─── mp-avatars (persons-pg-retirement-v1 T2.3) ────────────────────────────────────────────
// The slim avatar index rebuilt from mp_profile — object-shaped, no params. Unwraps rows[0].r,
// degrades a missing migration to null, propagates real errors (same contract as mp-assets).
test("mp-avatars unwraps rows[0].r into the avatar-index object", async () => {
  const idx = { total: 2, groups: { "1": "ГЕРБ" }, noPhoto: [2], extra: {} };
  const db = mockDb([{ r: idx }]);
  const res = await DB_ROUTES["mp-avatars"](db);
  assert.equal(db.calls.length, 1, "one DB call");
  assert.deepEqual(res.body, idx);
});

test("mp-avatars degrades to null on a missing migration, propagates real errors", async () => {
  for (const code of MIGRATION_CODES) {
    const res = await DB_ROUTES["mp-avatars"](mockDb(migrationMissing(code)));
    assert.equal(res.body, null, `mp-avatars @ ${code} → null`);
  }
  const boom = Object.assign(new Error("connection reset"), { code: "08006" });
  await assert.rejects(() => DB_ROUTES["mp-avatars"](mockDb(boom)));
});

// ─── car-makes (persons-pg-retirement-v1 T2.2) ─────────────────────────────────────────────
// Distinct-MP-per-make aggregate. Array-shaped, with a scope sentinel: no ns or an
// all-junk/empty mp-id set short-circuits to [] WITHOUT a DB call; a real scoped set is passed
// as a bound int[] param (never spliced into SQL); a missing migration degrades to [].
test("car-makes: no ns → [] without a DB call", async () => {
  const db = mockDb([{ r: [{ make: "X" }] }]);
  assert.deepEqual((await DB_ROUTES["car-makes"](db, { ns: "" })).body, []);
  assert.equal(db.calls.length, 0, "no ns must not issue SQL");
});

test("car-makes: an all-junk mpIds set short-circuits to [] without a DB call", async () => {
  const db = mockDb([{ r: [{ make: "X" }] }]);
  assert.deepEqual(
    (await DB_ROUTES["car-makes"](db, { ns: "52", mpIds: "abc" })).body,
    [],
  );
  assert.equal(db.calls.length, 0, "all-NaN mpIds → empty scope, no SQL");
});

test("car-makes: a scoped mpIds set is a bound int[] param, never spliced into SQL", async () => {
  const db = mockDb([{ r: [] }]);
  await DB_ROUTES["car-makes"](db, { ns: "all", mpIds: "-1,5100" });
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, ["all", [-1, 5100]]);
  assert.ok(!db.calls[0].sql.includes("5100"), "id text never in the SQL string");
});

test("car-makes: unwraps rows[0].r and degrades a missing migration to []", async () => {
  const makes = [{ make: "Toyota", mpCount: 7, vehicleCount: 9, sampleMpIds: [] }];
  assert.deepEqual(
    (await DB_ROUTES["car-makes"](mockDb([{ r: makes }]), { ns: "52" })).body,
    makes,
  );
  for (const code of MIGRATION_CODES) {
    assert.deepEqual(
      (await DB_ROUTES["car-makes"](mockDb(migrationMissing(code)), { ns: "52" }))
        .body,
      [],
    );
  }
});
