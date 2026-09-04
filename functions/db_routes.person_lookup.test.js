// Route-level tests for `/api/db/person-lookup` — the header search's people arm.
//
// ⚠️ IT IS NOT THE ROUTE `db_routes.person_search.test.js` COVERS, and the names invite the
// mistake. `person-search` reads the TABLE person_search (126) and has a JS merge layer;
// `person-lookup` reads the FUNCTION person_search(text,int) (082), which coexists with the
// table on purpose (relations and functions are separate catalogs — see the note at the
// route). The plan for the office/place pair named the wrong file as its gate for exactly
// this reason; this is the right one.
//
// WHAT IT PINS. The handler is a pass-through, so the only things that can go wrong here are
// the three that are invisible in a diff:
//
//   1. THE PAYLOAD IS FORWARDED VERBATIM. `primaryRole` / `placeLabel` / `placeLabelEn` are
//      the contract the header dropdown codes against, and they arrive as whatever the SQL
//      function put in the jsonb. A handler that projected a field list — the obvious
//      "tidy-up" — would silently drop them and the subtitle would vanish sitewide with the
//      route still answering 200.
//   2. NULL KEYS SURVIVE. person_browse_card returns NULL for a person the browse matview
//      does not carry, so the keys are present with a json null. A consumer distinguishing
//      "no place" from "this build predates the field" reads the VALUE; anything that strips
//      nulls on the way out turns those two states into one.
//   3. THE MISSING-MIGRATION DEGRADE. `missingMigrationEmpty` covers 42883/42P01 only, which
//      is why person_browse_card swallows its own 42501 rather than letting it reach here —
//      an escape is a 500 on every keystroke on every page. The 42501 arm below is what says
//      that contract is the FUNCTION's job, not this route's.
//
// Run: cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES } = require("./db_routes.js");
const route = DB_ROUTES["person-lookup"];

/** A dbRows that records its params and answers with one jsonb column, as the SQL does. */
function db(payload, seen) {
  return (sql, params) => {
    if (seen) seen.push({ sql, params });
    return Promise.resolve([{ r: payload }]);
  };
}

const HIT = {
  slug: "boyan-boychev-1a9q2r",
  name: "Боян Иванов Бойчев",
  namesakeRisk: 2,
  roles: 2,
  party: "БСП",
  partyColor: "rgb(237, 28, 36)",
  mpId: null,
  score: 2.15,
  primaryRole: "candidate",
  placeLabel: "София 24 МИР",
  placeLabelEn: "Sofia 24th MMC",
};

test("person-lookup: missing q → empty array, no query issued", async () => {
  const seen = [];
  const res = await route(db([HIT], seen), {});
  assert.deepEqual(res.body, []);
  assert.equal(seen.length, 0, "a blank query must not reach the database");
});

test("person-lookup: forwards the card keys verbatim", async () => {
  const res = await route(db([HIT]), { q: "бойчев" });
  assert.deepEqual(res.body, [HIT]);
  // Named individually so that dropping ONE of the three fails with a message saying which.
  for (const k of ["primaryRole", "placeLabel", "placeLabelEn"])
    assert.equal(res.body[0][k], HIT[k], `${k} did not survive the route`);
});

test("person-lookup: a null card keeps its keys rather than dropping them", async () => {
  const noCard = {
    ...HIT,
    primaryRole: null,
    placeLabel: null,
    placeLabelEn: null,
  };
  const res = await route(db([noCard]), { q: "бойчев" });
  for (const k of ["primaryRole", "placeLabel", "placeLabelEn"]) {
    assert.ok(
      k in res.body[0],
      `${k} was stripped — "no place" and "this build has no such field" must stay distinct`,
    );
    assert.equal(res.body[0][k], null);
  }
});

test("person-lookup: limit is clamped to 1..100, default 20", async () => {
  const cases = [
    [undefined, 20],
    ["6", 6],
    ["0", 1],
    ["-5", 1],
    ["1000", 100],
    ["nonsense", 20],
  ];
  for (const [given, want] of cases) {
    const seen = [];
    await route(db([], seen), { q: "иван", limit: given });
    assert.equal(
      seen[0].params[1],
      want,
      `limit=${String(given)} should clamp to ${want}`,
    );
  }
});

test("person-lookup: a missing 082 degrades to [] instead of 500ing the header", async () => {
  for (const code of ["42883", "42P01"]) {
    const err = Object.assign(new Error(`missing: ${code}`), { code });
    const res = await route(() => Promise.reject(err), { q: "иван" });
    assert.deepEqual(res.body, [], `SQLSTATE ${code} should degrade to an empty list`);
  }
});

test("person-lookup: a 42501 is NOT degraded here — the function must swallow its own", async () => {
  // This is the contract, not an oversight: `missingMigrationEmpty` covers 42883/42P01 only,
  // so an insufficient_privilege raised INSIDE person_search would 500 every keystroke. That
  // is why person_browse_card catches 42501 in its own EXCEPTION arm (082); this asserts the
  // route has not quietly grown a second, wider net that would mask a real ACL failure.
  const err = Object.assign(new Error("permission denied"), { code: "42501" });
  await assert.rejects(
    () => route(() => Promise.reject(err), { q: "иван" }),
    /permission denied/,
  );
});

test("person-lookup: a NULL jsonb result becomes [], never null", async () => {
  // person_search() COALESCEs to '[]', but the row itself can be absent on a degrade path,
  // and the header maps over this array without a guard.
  assert.deepEqual((await route(() => Promise.resolve([]), { q: "иван" })).body, []);
  assert.deepEqual(
    (await route(() => Promise.resolve([{ r: null }]), { q: "иван" })).body,
    [],
  );
});
