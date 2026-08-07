// Route-level tests for /api/db/interreg-place and /api/db/interreg-company —
// the JS layer over migration 138. The SQL is covered by
// scripts/db/tests/interreg.data.test.ts.
//
// These exist because the defect this file would have caught shipped: the
// obshtina regex was `[A-Z]{2,3}\d{2}`, which 400s SFO_CITY — Столична община,
// 272 of the 1,469 placed Bulgarian partner rows. The capital returned an error
// while every other municipality answered fine, and nothing in the SQL layer
// could see it. A route test needs no database, which is the whole argument for
// writing it before the expensive one.
//
// No DB: the handler is (dbRows, query) => Promise<{ body }>. Run: cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES } = require("./db_routes.js");

const place = DB_ROUTES["interreg-place"];
const company = DB_ROUTES["interreg-company"];

const stubDb = (payload = { budgetEur: 0, operations: [] }) => {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    return [{ r: payload }];
  };
  fn.calls = calls;
  return fn;
};

const throwingDb = (code) => async () => {
  const e = new Error(`stub ${code}`);
  e.code = code;
  throw e;
};

// ── which place gets answered ────────────────────────────────────────────────

test("a settlement request binds ekatte and NULLs obshtina", async () => {
  const db = stubDb();
  await place(db, { ekatte: "68134" });
  assert.deepEqual(db.calls[0].params, ["68134", null, 20]);
});

test("a municipality request binds obshtina and NULLs ekatte", async () => {
  const db = stubDb();
  await place(db, { obshtina: "BGS12" });
  assert.deepEqual(db.calls[0].params, [null, "BGS12", 20]);
});

test("ekatte wins when both are sent, so one place is answered", async () => {
  const db = stubDb();
  await place(db, { ekatte: "68134", obshtina: "BGS12" });
  assert.deepEqual(db.calls[0].params, ["68134", null, 20]);
});

// ── the regex: every code shape place_dim actually carries ───────────────────
//
// The exhaustive version of this — every obshtina code in place_dim passes —
// lives in interreg.data.test.ts, because it needs the dimension. Here we pin
// the four shapes so a hand-edit to the pattern goes red without a database.

test("every real obshtina code shape is accepted", async () => {
  for (const code of ["BGS12", "SFO26", "S2401", "S2224", "SFO_CITY"]) {
    const db = stubDb();
    const res = await place(db, { obshtina: code });
    assert.equal(res.status, undefined, `${code} should not 400`);
    assert.equal(db.calls[0].params[1], code);
  }
});

// The one that shipped broken. SFO_CITY is not an edge case: it is the single
// largest place in the corpus.
test("SFO_CITY is accepted — the capital is not an edge case", async () => {
  const db = stubDb();
  const res = await place(db, { obshtina: "SFO_CITY" });
  assert.equal(res.status, undefined);
});

test("a malformed or absent place is a 400, not an empty 200", async () => {
  for (const q of [
    {},
    { obshtina: "" },
    { obshtina: "bgs12" }, // lower case
    { obshtina: "EU" }, // an abroad pseudo-obshtina: never placed
    { ekatte: "6813" }, // 4 digits
    { ekatte: "681345" }, // 6 digits
  ]) {
    const res = await place(stubDb(), q);
    assert.equal(res.status, 400, `${JSON.stringify(q)} should 400`);
  }
});

test("an EIK must be exactly 9 digits", async () => {
  for (const eik of ["", "12345678", "1234567890", "BG000057086", "abcdefghi"])
    assert.equal((await company(stubDb(), { eik })).status, 400, eik);
  assert.equal((await company(stubDb(), { eik: "000057086" })).status, undefined);
});

// ── limits ──────────────────────────────────────────────────────────────────

test("limit is clamped and truncated on both routes", async () => {
  const cases = [
    [{ obshtina: "BGS12" }, 20],
    [{ obshtina: "BGS12", limit: "5" }, 5],
    [{ obshtina: "BGS12", limit: "12.5" }, 12],
    [{ obshtina: "BGS12", limit: "0" }, 1],
    [{ obshtina: "BGS12", limit: "999" }, 100],
    [{ obshtina: "BGS12", limit: "nope" }, 20],
  ];
  for (const [q, want] of cases) {
    const db = stubDb();
    await place(db, q);
    assert.equal(db.calls[0].params[2], want, JSON.stringify(q));
  }
  const db = stubDb();
  await company(db, { eik: "000057086", limit: "999" });
  assert.equal(db.calls[0].params[1], 200);
});

// ── the degrade contract ────────────────────────────────────────────────────
//
// Both routes degrade an absent migration to a zero-shaped payload — correct,
// because `deploy:db` can legitimately ship before 138 is applied on Cloud SQL.
// What must NOT degrade is a timeout: 57014 means the pool's own 10 s budget is
// already spent, and answering €0 there would publish a wrong number under load
// rather than surfacing a slow one.

test("an absent migration degrades to a zero-shaped payload", async () => {
  for (const code of ["42883", "42P01"]) {
    const p = await place(throwingDb(code), { obshtina: "BGS12" });
    assert.equal(p.body.budgetEur, 0);
    assert.deepEqual(p.body.operations, []);
    const c = await company(throwingDb(code), { eik: "000057086" });
    assert.equal(c.body.budgetEur, 0);
    assert.deepEqual(c.body.periods, {});
  }
});

test("a timeout or any other error is NOT degraded", async () => {
  for (const code of ["57014", "55P03", "08006", undefined]) {
    await assert.rejects(() => place(throwingDb(code), { obshtina: "BGS12" }));
    await assert.rejects(() => company(throwingDb(code), { eik: "000057086" }));
  }
});

// The sentinel is what a client renders when the migration is missing, so its
// keys must be the keys the SQL function actually returns — a sentinel carrying
// `unpublishedCount` against a payload carrying `unpublishedPartnerCount` gives
// an `undefined` in exactly the deploy window the sentinel exists for.
test("the sentinels carry the same keys as the functions", async () => {
  const p = (await place(throwingDb("42P01"), { obshtina: "BGS12" })).body;
  assert.deepEqual(Object.keys(p).sort(), [
    "budgetEur",
    "linkedCount",
    "operationCount",
    "operations",
    "partnerCount",
    "unpublishedPartnerCount",
  ]);
  const c = (await company(throwingDb("42P01"), { eik: "000057086" })).body;
  assert.deepEqual(Object.keys(c).sort(), [
    "budgetEur",
    "operationCount",
    "operations",
    "partnerCount",
    "periods",
    "unpublishedPartnerCount",
  ]);
});

// ── /api/db/funds-muni-combined — the per-capita ranking with Interreg in it ──
//
// This route's obshtina vocabulary is NOT the same as interreg-place's above.
// It keys `fund_payloads`' muni-summary, which carries S22 — the Sofia city
// rollup, and the one key MyAreaProjectsMapTile sends for all ~25 Sofia rayon
// dashboards. The first draft copied the interreg-place regex, which has no S##
// alternative, so every Sofia page 400'd four times over (the hook throws on
// !ok, React Query retries) while rendering an identical number, because S22 has
// no published rank on either arm. Invisible in the UI, live in the logs.

const overview = DB_ROUTES["interreg-overview"];
const muni = DB_ROUTES["funds-muni-combined"];
const rank = DB_ROUTES["funds-muni-rank"];

test("S22 is accepted — it is the key the Sofia tile actually sends", async () => {
  const db = stubDb(null);
  const res = await muni(db, { obshtina: "S22" });
  assert.equal(res.status, undefined);
  assert.deepEqual(db.calls[0].params, ["S22"]);
});

test("every muni-summary key shape is accepted", async () => {
  for (const code of ["BGS12", "DOB03", "S2417", "S22", "SFO_CITY"])
    assert.equal(
      (await muni(stubDb(null), { obshtina: code })).status,
      undefined,
      code,
    );
});

test("a malformed obshtina is a 400", async () => {
  for (const q of [{}, { obshtina: "" }, { obshtina: "EU" }, { obshtina: "s22" }])
    assert.equal((await muni(stubDb(null), q)).status, 400, JSON.stringify(q));
});

// 200 + null, not 404: the funds convention this sits beside, and its shared
// getJson throws on any non-ok status — so a 404 would surface as a query error
// on every Sofia dashboard instead of the empty state it actually is.
test("an unranked municipality is 200 with a null body", async () => {
  const res = await muni(stubDb(null), { obshtina: "S22" });
  assert.equal(res.status, undefined);
  assert.equal(res.body, null);
});

test("the ranking degrades an absent migration but not a timeout", async () => {
  const degraded = await rank(throwingDb("42P01"), {});
  assert.deepEqual(degraded.body.munis, []);
  assert.equal(degraded.body.cohortSize, 0);
  assert.equal((await muni(throwingDb("42883"), { obshtina: "S22" })).body, null);
  await assert.rejects(() => rank(throwingDb("57014"), {}));
  await assert.rejects(() => muni(throwingDb("57014"), { obshtina: "S22" }));
});

test("the leaderboard limit is clamped", async () => {
  for (const [q, want] of [
    [{}, 25],
    [{ limit: "300" }, 300],
    [{ limit: "9999" }, 300],
    [{ limit: "0" }, 1],
  ]) {
    const db = stubDb({ munis: [] });
    await rank(db, q);
    assert.equal(db.calls[0].params[0], want, JSON.stringify(q));
  }
});

// ── /api/db/interreg-overview — the national picture on /funds ───────────────

test("the overview limit is clamped", async () => {
  for (const [q, want] of [
    [{}, 12],
    [{ limit: "6" }, 6],
    [{ limit: "99" }, 40],
    [{ limit: "0" }, 1],
    [{ limit: "nope" }, 12],
  ]) {
    const db = stubDb({ programmes: [] });
    await overview(db, q);
    assert.equal(db.calls[0].params[0], want, JSON.stringify(q));
  }
});

// Same contract as the routes above: an absent migration degrades (deploy:db can
// ship before 138 is applied on Cloud SQL), a timeout does not.
test("the overview degrades an absent migration but not a timeout", async () => {
  const r = await overview(throwingDb("42P01"), {});
  assert.equal(r.body.budgetEur, 0);
  assert.deepEqual(r.body.programmes, []);
  assert.deepEqual(r.body.periods, {});
  await assert.rejects(() => overview(throwingDb("57014"), {}));
});

// The sentinel is what /funds renders in the window between deploy:db and the
// migration. Its keys must be the function's keys — InterregTile reads
// `partnerCount` to decide whether to self-hide, so a missing key there renders
// the whole section against `undefined` instead of hiding it.
test("the overview sentinel carries the same keys as the function", async () => {
  const body = (await overview(throwingDb("42883"), {})).body;
  assert.deepEqual(Object.keys(body).sort(), [
    "budgetEur",
    "operationCount",
    "partnerCount",
    "periods",
    "placedCount",
    "programmeCount",
    "programmes",
    "unpublishedPartnerCount",
  ]);
});
