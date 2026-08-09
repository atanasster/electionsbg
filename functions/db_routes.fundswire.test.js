// Route-level tests for /api/db/funds-wire (the band-0 wire and band-2 rail, migration 144).
//
// The SQL is covered by scripts/db/tests/funds_wire.data.test.ts; this covers the JS layer. Two
// contracts matter here:
//
//   * THE THREE CARDS ARE GROUPED SERVER-SIDE. A flat tagged list would let a consumer render two
//     of them and silently drop the third — and the third is the disbursement card, the only one
//     that says anything critical.
//   * THE WINDOW IS DECLARED. „372 нови" means nothing without „за 30 дни", and a client that
//     hard-coded the label would drift the first time the default moved.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES, __resetMissLog } = require("./db_routes.js");

beforeEach(__resetMissLog);

const route = DB_ROUTES["funds-wire"];

const WIRE = {
  checkedOn: "2026-08-09",
  lastChangeOn: "2026-08-03",
  newProjects: 372,
  newEur: 277325713.84,
  backfillDays: 0,
  backfillRows: 0,
  openCalls: 45,
};

const NEWS = [
  { card: "new_contracts", rank: 1, label: "Проект", sublabel: "Фирма", href: "/funds/contract/X", amountEur: 17977343, pct: null },
  { card: "by_place", rank: 1, label: "SOFIA_CITY", sublabel: "12", href: null, amountEur: 39629297, pct: null },
  { card: "lowest_paid", rank: 1, label: "Процедура", sublabel: "Програма", href: "/funds/procedure/Y", amountEur: 14836986, pct: 0 },
];

const ok = () => {
  const seen = [];
  const dbRows = async (sql, params) => {
    seen.push({ sql, params });
    if (/funds_wire/.test(sql)) return [WIRE];
    if (/funds_news/.test(sql)) return NEWS;
    return [];
  };
  return { dbRows, seen };
};

const failing = (code) => async () => {
  const e = new Error(`simulated ${code}`);
  e.code = code;
  throw e;
};

test("returns the wire and the three grouped cards", async () => {
  const { dbRows } = ok();
  const { body } = await route(dbRows, {});
  assert.deepEqual(body.wire, WIRE);
  assert.equal(body.news.newContracts.length, 1);
  assert.equal(body.news.byPlace.length, 1);
  assert.equal(body.news.lowestPaid.length, 1);
});

test("the three card keys ALWAYS exist, even when a card is empty", async () => {
  // A consumer destructures all three. If a key were missing when its card returned nothing,
  // `.length` would throw and the whole rail would disappear rather than one card.
  const dbRows = async (sql) => (/funds_wire/.test(sql) ? [WIRE] : []);
  const { body } = await route(dbRows, {});
  assert.deepEqual(body.news, {
    newContracts: [],
    byPlace: [],
    lowestPaid: [],
  });
});

test("an unknown card tag is dropped, not spread into the payload", async () => {
  // A new card added in SQL but not here must not appear as an untyped key the UI ignores
  // silently — it should be visibly absent until the client is taught about it.
  const dbRows = async (sql) =>
    /funds_wire/.test(sql)
      ? [WIRE]
      : [...NEWS, { card: "brand_new", rank: 1, label: "x" }];
  const { body } = await route(dbRows, {});
  assert.deepEqual(Object.keys(body.news).sort(), [
    "byPlace",
    "lowestPaid",
    "newContracts",
  ]);
});

test("the window is declared in the payload", async () => {
  const { dbRows } = ok();
  const { body } = await route(dbRows, { days: "14", newsDays: "90" });
  assert.equal(body.windowDays, 14);
  assert.equal(body.newsWindowDays, 90);
});

test("windows and the limit are clamped", async () => {
  const { dbRows, seen } = ok();
  await route(dbRows, { days: "9999", newsDays: "-5", limit: "500" });
  const w = seen.find((c) => /funds_wire/.test(c.sql));
  const n = seen.find((c) => /funds_news/.test(c.sql));
  assert.ok(w.params[0] <= 365 && w.params[0] >= 1, `days ${w.params[0]}`);
  assert.ok(n.params[0] >= 1, `newsDays ${n.params[0]}`);
  assert.ok(n.params[1] <= 10, `limit ${n.params[1]}`);
});

test("a missing wire row becomes null, not undefined", async () => {
  // The client checks `!w`; `undefined` would work by luck, but the contract should be explicit
  // so a JSON round trip cannot drop the key entirely.
  const dbRows = async (sql) => (/funds_news/.test(sql) ? NEWS : []);
  const { body } = await route(dbRows, {});
  assert.equal(body.wire, null);
});

for (const code of ["42883", "42P01", "55000", "55P03"]) {
  test(`degrades to an empty wire and rail on ${code}`, async () => {
    const { body } = await route(failing(code), {});
    assert.equal(body.wire, null);
    assert.deepEqual(body.news, {
      newContracts: [],
      byPlace: [],
      lowestPaid: [],
    });
  });
}

test("does NOT degrade on 57014 (the pool's own timeout)", async () => {
  await assert.rejects(() => route(failing("57014"), {}), /simulated 57014/);
});

test("does NOT degrade on 42501 (a permanent missing GRANT)", async () => {
  await assert.rejects(() => route(failing("42501"), {}), /simulated 42501/);
});

test("logs the miss ONCE, naming the migration to apply", async () => {
  const warned = [];
  const orig = console.warn;
  console.warn = (m) => warned.push(String(m));
  try {
    await route(failing("42P01"), {});
    await route(failing("42P01"), {});
  } finally {
    console.warn = orig;
  }
  assert.equal(warned.length, 1);
  assert.match(warned[0], /fw:not-built/);
  assert.match(warned[0], /144_funds_wire\.sql/);
});
