// Route-level unit tests for /api/db/connection — the person page's „Проверка на връзка".
// The SQL is covered by scripts/db/tests/person_person_bridge.data.test.ts; this pins the JS
// layer, and specifically the ASYMMETRY between the two degrees:
//
//   `shared`  (connection_between, 008) — the question this route has always answered, and
//             therefore must NEVER be degraded away.
//   `bridged` (person_person_bridge, 192) — degrades to [] on a missing migration, because a
//             database whose TR loader has not applied 192 must still answer the first.
//
// The degradation is also LOGGED. A permanently empty second degree that says nothing in
// Cloud Logging is indistinguishable from „these two really have no indirect link", which is
// how /api/db/mp-management sat on a stale body for weeks.
//
// No DB: a mock `dbRows` records SQL + params and answers per query. Run: cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES, __resetMissLog } = require("./db_routes.js");

/** Answers by which function the SQL names, so a mock cannot let a bridge assertion pass off
 *  the direct query's rows — the two carry different shapes and only one may degrade. */
function mockDb({ shared = [], bridge = [] } = {}) {
  const calls = [];
  const fn = (sql, params) => {
    calls.push({ sql, params });
    const answer = sql.includes("person_person_bridge") ? bridge : shared;
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  };
  fn.calls = calls;
  return fn;
}
const pgError = (code) => Object.assign(new Error(code), { code });

const SHARED_ROW = { uic: "1", company: "АКМЕ", a_roles: "partner", b_roles: "manager" };
const BRIDGE_ROW = { bridge_name: "ИВАН", a_eik: "2", b_eik: "3" };

test("asks BOTH degrees, in one round trip, with the limit passed explicitly", async () => {
  const db = mockDb({ shared: [SHARED_ROW], bridge: [BRIDGE_ROW] });
  const res = await DB_ROUTES.connection(db, { a: "Иван", b: "Георги" });
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].sql, /connection_between\(\$1, \$2\)/);
  assert.deepEqual(db.calls[0].params, ["Иван", "Георги"]);
  assert.match(db.calls[1].sql, /person_person_bridge\(\$1, \$2, \$3\)/);
  // The limit is an ARGUMENT, not the SQL default: a default the caller never exercises is
  // a default nobody has measured.
  assert.deepEqual(db.calls[1].params, ["Иван", "Георги", 25]);
  assert.deepEqual(res.body, {
    a: "Иван",
    b: "Георги",
    shared: [SHARED_ROW],
    bridged: [BRIDGE_ROW],
    bridgedTimedOut: false,
  });
});

test("a missing 192 degrades `bridged` to [] and leaves `shared` intact", async () => {
  for (const code of ["42883", "42P01"]) {
    __resetMissLog();
    const db = mockDb({ shared: [SHARED_ROW], bridge: pgError(code) });
    const res = await DB_ROUTES.connection(db, { a: "Иван", b: "Георги" });
    assert.deepEqual(res.body.bridged, [], `${code} ⇒ []`);
    assert.deepEqual(
      res.body.shared,
      [SHARED_ROW],
      `${code} must not cost the FIRST degree its answer`,
    );
  }
});

test("the degradation is logged once, under a greppable key", async () => {
  __resetMissLog();
  const warn = console.warn;
  const lines = [];
  console.warn = (m) => lines.push(String(m));
  try {
    const db = mockDb({ bridge: pgError("42883") });
    await DB_ROUTES.connection(db, { a: "Иван", b: "Георги" });
    await DB_ROUTES.connection(db, { a: "Иван", b: "Георги" });
  } finally {
    console.warn = warn;
  }
  assert.equal(lines.length, 1, "once per process, not once per request");
  assert.match(lines[0], /^ppb:not-built:42883/);
  // The remedy is in the message: the key alone does not tell an operator what to run.
  assert.match(lines[0], /db:load:tr:pg/);
});

test("⚠️ 57014 degrades VISIBLY — the first degree survives and the flag says why", async () => {
  // The route's whole invariant: a failure of the EXPENSIVE half must not cost the cheap half
  // its answer. `bridged` rejecting on 57014 propagates through Promise.all → 500 → the
  // component's failure panel, throwing away a `shared` that came back in milliseconds. And
  // person_person_bridge is the least-measured query on the route (unmeasured on Cloud SQL,
  // on the table family this repo has a 4h41m incident with), so it is the realistic trigger.
  __resetMissLog();
  const db = mockDb({ shared: [SHARED_ROW], bridge: pgError("57014") });
  const res = await DB_ROUTES.connection(db, { a: "Иван", b: "Георги" });
  assert.deepEqual(res.body.shared, [SHARED_ROW], "the first degree lost its answer");
  assert.deepEqual(res.body.bridged, []);
  // …and NOT silently: an empty `bridged` with no flag renders as „no indirect link", a claim
  // about two named people that nothing established.
  assert.equal(res.body.bridgedTimedOut, true);
});

test("a timeout is logged under its OWN key, not the not-built one", async () => {
  // The two mean different things to an operator — „192 never landed here" vs „the plan on
  // this database is too slow" — and only one of them is fixed by running a loader.
  __resetMissLog();
  const warn = console.warn;
  const lines = [];
  console.warn = (m) => lines.push(String(m));
  try {
    const db = mockDb({ bridge: pgError("57014") });
    await DB_ROUTES.connection(db, { a: "Иван", b: "Георги" });
  } finally {
    console.warn = warn;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^ppb:timeout/);
  assert.doesNotMatch(lines[0], /not-built/);
});

test("a NOT-built degrade does not set the timeout flag", async () => {
  // The flag drives reader-facing copy („проверката не завърши"). A database that never ran
  // the TR loader did not time out — it has no second degree at all, which is a different
  // sentence, and the miss copy is the right one there.
  __resetMissLog();
  const db = mockDb({ shared: [SHARED_ROW], bridge: pgError("42883") });
  const res = await DB_ROUTES.connection(db, { a: "Иван", b: "Георги" });
  assert.equal(res.body.bridgedTimedOut, false);
});

test("any OTHER error on the bridge still propagates", async () => {
  // Degrading is only correct for the two states it names. A permission error or a syntax
  // error is a real regression, and swallowing it would turn one into a narrower answer.
  const db = mockDb({ shared: [SHARED_ROW], bridge: pgError("42501") });
  await assert.rejects(
    () => DB_ROUTES.connection(db, { a: "Иван", b: "Георги" }),
    (e) => e.code === "42501",
  );
});

test("a real error on the FIRST degree still propagates", async () => {
  const db = mockDb({ shared: pgError("42883"), bridge: [] });
  await assert.rejects(() => DB_ROUTES.connection(db, { a: "Иван", b: "Георги" }));
});

test("a missing name is a 400 and never reaches the DB", async () => {
  for (const q of [{ a: "Иван" }, { b: "Георги" }, {}]) {
    const db = mockDb();
    const res = await DB_ROUTES.connection(db, q);
    assert.equal(res.status, 400);
    assert.equal(db.calls.length, 0);
  }
});
