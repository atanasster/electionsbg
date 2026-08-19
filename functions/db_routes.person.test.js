// Route-level unit tests for the four person-declaration API routes (audit T3.8/T3.9/T3.10),
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

// ─── person-declared-stake-status (T4b) ─────────────────────────────────────────────────
test("person-declared-stake-status returns [] without a slug and skips the DB", async () => {
  const db = mockDb([{ r: [{ declaredName: "X" }] }]);
  const res = await DB_ROUTES["person-declared-stake-status"](db, {});
  assert.deepEqual(res.body, []);
  assert.equal(db.calls.length, 0, "no DB call without a slug");
});

test("person-declared-stake-status degrades to [] for either missing-migration code", async () => {
  // The degrade matters more here than on its siblings: this route explains why a declared
  // stake is NOT linked, so a client that receives nothing must fall back to the old
  // undifferentiated list — never to a reason it made up.
  for (const code of MIGRATION_CODES) {
    const res = await DB_ROUTES["person-declared-stake-status"](
      mockDb(migrationMissing(code)),
      { slug: "mp-868" },
    );
    assert.deepEqual(res.body, [], `code ${code} → []`);
  }
});

test("person-declared-stake-status passes the reasons through untouched", async () => {
  const payload = [
    { declaredName: "Актив груп ЕООД", reason: "ambiguous", eik: null,
      candidates: [{ eik: "121891779" }, { eik: "125577092" }] },
    { declaredName: "Питстрой 13 ЕООД", reason: "linked", eik: "204361427", candidates: [] },
  ];
  const res = await DB_ROUTES["person-declared-stake-status"](
    mockDb([{ r: payload }]),
    { slug: "mp-868" },
  );
  // The route must not reshape, sort or filter: the refusal semantics live in 096, and a
  // route that dropped `candidates` would turn "several bear this name" into a bare denial.
  assert.deepEqual(res.body, payload);
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
// broadened catch would silently turn a query failure into an empty result on all four
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

  await assert.rejects(
    () =>
      DB_ROUTES["person-declared-stake-status"](mockDb(realError), {
        slug: "mp-868",
      }),
    /syntax error/,
    "person-declared-stake-status must not swallow a real error",
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

// person-abroad-overview is the same class and shipped WITHOUT the guard: the payload is an
// object, `missingMigrationEmpty` degrades to `[{ r: [] }]`, and `[] ?? null` is `[]` — so a
// database without 169 handed the client a truthy empty array. The card renders on presence,
// and /declarations/abroad published „— % от " with no number and no denominator, which is
// the exact failure 169's header, the route comment and the screen comment all exist to
// prevent. One line, and it reads like a redundant safety check.
test("person-abroad-overview degrades to null, not the array sentinel", async () => {
  for (const code of MIGRATION_CODES) {
    const res = await DB_ROUTES["person-abroad-overview"](
      mockDb(migrationMissing(code)),
      {},
    );
    assert.equal(
      res.body,
      null,
      `person-abroad-overview (${code}) must degrade to null, got ${JSON.stringify(res.body)}`,
    );
    assert.ok(
      !Array.isArray(res.body),
      `person-abroad-overview (${code}) must never serve an array — the client reads an object`,
    );
  }
});

// …and it passes a real payload through untouched, so the guard above cannot be satisfied by
// a route that simply always returns null.
test("person-abroad-overview passes a real payload through", async () => {
  const payload = { eurAbroad: 46815104, eurInScope: 799027521, pctOfInScope: 5.9 };
  const res = await DB_ROUTES["person-abroad-overview"](
    mockDb([{ r: payload }]),
    {},
  );
  assert.deepEqual(res.body, payload);
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

// ─── mp-assets-by-party (the /mp-assets group chart) ───────────────────────────────────────
// One contract dominates this route: it must never hand back a group breakdown for a
// parliament whose party labels it cannot trust. The matview's party column is the group the
// MP sits in TODAY, so an older bucket's rows are either ungrouped or filed under a party the
// MP joined afterwards — and `applicable` is what tells the two apart. The SQL decides it
// (a comparison against mp_roster_meta.current_ns), so these tests pin the JS half: the
// short-circuits that must not issue SQL, the bound-parameter contract, and the object shape
// a caller can rely on when the database has never seen migration 105.
test("mp-assets-by-party: no ns → the inapplicable shape, without a DB call", async () => {
  const db = mockDb([{ r: { applicable: true, groups: [{ party: "X" }] } }]);
  const res = await DB_ROUTES["mp-assets-by-party"](db, { ns: "" });
  assert.deepEqual(res.body, {
    ns: "",
    applicable: false,
    groups: [],
    ungrouped: null,
  });
  assert.equal(db.calls.length, 0, "no ns must not issue SQL");
});

test("mp-assets-by-party: an all-junk mpIds set short-circuits to zero groups", async () => {
  const db = mockDb([{ r: { applicable: true, groups: [{ party: "X" }] } }]);
  const res = await DB_ROUTES["mp-assets-by-party"](db, {
    ns: "52",
    mpIds: "abc",
  });
  assert.deepEqual(res.body.groups, []);
  assert.equal(db.calls.length, 0, "an empty scope must not issue SQL");
});

test("mp-assets-by-party: the mp-id scope is a bound int[], never spliced into SQL", async () => {
  const db = mockDb([{ r: { applicable: true, groups: [] } }]);
  await DB_ROUTES["mp-assets-by-party"](db, { ns: "52", mpIds: "-1,5100" });
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, ["52", [-1, 5100]]);
  assert.ok(!db.calls[0].sql.includes("5100"), "id text never in the SQL string");
});

test("mp-assets-by-party: an unscoped call binds NULL, not an empty array", async () => {
  // [] would be `mp_id = ANY('{}')` — zero rows — where the caller meant "the whole bucket".
  const db = mockDb([{ r: { applicable: true, groups: [] } }]);
  await DB_ROUTES["mp-assets-by-party"](db, { ns: "all" });
  assert.deepEqual(db.calls[0].params, ["all", null]);
});

test("mp-assets-by-party: the applicability gate is asked of the roster, not of coverage", async () => {
  // The trap this pins: for the 51st, 88 of 90 rows DO carry a group — the group those MPs
  // sit in now — so any "enough rows are labelled" test would pass and publish a chart
  // attributing their wealth to parties they joined later. The gate has to be an identity
  // comparison against the roster's own current parliament.
  const db = mockDb([{ r: { applicable: false, groups: [] } }]);
  await DB_ROUTES["mp-assets-by-party"](db, { ns: "51" });
  const sql = db.calls[0].sql;
  assert.ok(/mp_roster_meta/.test(sql), "applicability reads mp_roster_meta");
  assert.ok(
    /current_ns/.test(sql) && /\$1/.test(sql),
    "and compares it to the requested bucket",
  );
});

test("mp-assets-by-party: unwraps rows[0].r and degrades a missing migration", async () => {
  const body = {
    ns: "52",
    applicable: true,
    groups: [{ party: "ПГ на ДПС", mps: 21, declared: 21, totalNetEur: 11560382 }],
    ungrouped: { mps: 0, declared: 0, totalNetEur: 0 },
  };
  assert.deepEqual(
    (await DB_ROUTES["mp-assets-by-party"](mockDb([{ r: body }]), { ns: "52" }))
      .body,
    body,
  );
  for (const code of MIGRATION_CODES) {
    // Object-shaped, not the [] sentinel: the caller reads `.groups`, and an array here
    // would make `applicable` undefined — falsy, but for the wrong reason.
    assert.deepEqual(
      (
        await DB_ROUTES["mp-assets-by-party"](mockDb(migrationMissing(code)), {
          ns: "52",
        })
      ).body,
      { ns: "52", applicable: false, groups: [], ungrouped: null },
      `mp-assets-by-party @ ${code}`,
    );
  }
  const boom = Object.assign(new Error("connection reset"), { code: "08006" });
  await assert.rejects(() =>
    DB_ROUTES["mp-assets-by-party"](mockDb(boom), { ns: "52" }),
  );
});
