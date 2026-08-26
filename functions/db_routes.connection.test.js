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

test("⚠️ 57014 is NOT degraded — it is the pool's own timeout, not a missing migration", async () => {
  // Swallowing it would turn a real regression into a silently narrower answer, on a route
  // whose direct query has already been paid for by the time it fires.
  const db = mockDb({ shared: [SHARED_ROW], bridge: pgError("57014") });
  await assert.rejects(
    () => DB_ROUTES.connection(db, { a: "Иван", b: "Георги" }),
    (e) => e.code === "57014",
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
