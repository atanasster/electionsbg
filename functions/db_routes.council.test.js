// Route-level tests for the /api/db/council-* routes (migration 161 over the 160
// corpus). No DB: each handler is (dbRows, query) => Promise<{ body }>.
// Run: cd functions && npm test
//
// This exists because a bug shipped across FIVE of these routes: the missing-migration
// degrade path passed a diagnostic-looking string ("cc:not-built") as the fallback VALUE
// instead of the route's own fallback (null, or an empty-shape object), so a database
// that hasn't yet run migration 161 — a documented, anticipated deploy window — served
// that string as the JSON body. Every typed consumer's `if (!entry) return null` guard
// is a falsy check, so it does not catch a truthy string, and crashes trying to read
// fields off it. council-councillor-by-slug was fixed first; council-overview,
// council-muni, council-resolution and council-councillor carried the same defect.
// See docs/plans/person-election-voting-redesign-v1.md.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES } = require("./db_routes.js");

const councillorBySlug = DB_ROUTES["council-councillor-by-slug"];

const stubDb = (payload) => async () => [{ r: payload }];

const throwingDb = (code) => async () => {
  const e = new Error(`stub ${code}`);
  e.code = code;
  throw e;
};

test("missing slug returns null without querying the database", async () => {
  const res = await councillorBySlug(async () => {
    throw new Error("must not be called");
  }, {});
  assert.equal(res.body, null);
});

test("passes the slug through to council_councillor_by_slug", async () => {
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });
    return [{ r: { personId: 1, votes: 3 } }];
  };
  const res = await councillorBySlug(db, { slug: "abdrahim-abdrahimov-1obnxg" });
  assert.deepEqual(calls[0].params, ["abdrahim-abdrahimov-1obnxg"]);
  assert.deepEqual(res.body, { personId: 1, votes: 3 });
});

test("a real payload passes through unchanged", async () => {
  const payload = { personId: 1, votes: 180, recent: [] };
  const res = await councillorBySlug(stubDb(payload), { slug: "x" });
  assert.deepEqual(res.body, payload);
});

test("degrades to null — not a diagnostic string — on a missing migration", async () => {
  for (const code of ["42883", "42P01"]) {
    const res = await councillorBySlug(throwingDb(code), { slug: "x" });
    assert.equal(
      res.body,
      null,
      `code ${code} must degrade to null, never a truthy placeholder — a ` +
        "consumer's `if (!entry) return null` guard cannot catch a truthy string",
    );
  }
});

test("a pool timeout (57014) is not swallowed", async () => {
  await assert.rejects(() => councillorBySlug(throwingDb("57014"), { slug: "x" }));
});

const councilOverview = DB_ROUTES["council-overview"];
const OVERVIEW_EMPTY = {
  councilsCovered: 0,
  councilsTotal: 265,
  councilsWithNamedVotes: 0,
  resolutions: 0,
  namedVotes: 0,
  attributedVotes: 0,
  newestDecidedOn: null,
  councils: [],
};

test("council-overview degrades to its own empty shape — not a diagnostic string — on a missing migration", async () => {
  for (const code of ["42883", "42P01"]) {
    const res = await councilOverview(throwingDb(code), {});
    assert.deepEqual(
      res.body,
      OVERVIEW_EMPTY,
      `code ${code} must degrade to the route's own empty shape, never a truthy placeholder`,
    );
  }
});

const councilMuni = DB_ROUTES["council-muni"];

test("council-muni degrades to null — not a diagnostic string — on a missing migration", async () => {
  for (const code of ["42883", "42P01"]) {
    const res = await councilMuni(throwingDb(code), { code: "SOF" });
    assert.equal(
      res.body,
      null,
      `code ${code} must degrade to null, never a truthy placeholder`,
    );
  }
});

const councilResolution = DB_ROUTES["council-resolution"];

test("council-resolution degrades to null — not a diagnostic string — on a missing migration", async () => {
  for (const code of ["42883", "42P01"]) {
    const res = await councilResolution(throwingDb(code), { id: "abc123" });
    assert.equal(
      res.body,
      null,
      `code ${code} must degrade to null, never a truthy placeholder`,
    );
  }
});

const councilCouncillor = DB_ROUTES["council-councillor"];

test("council-councillor degrades to null — not a diagnostic string — on a missing migration", async () => {
  for (const code of ["42883", "42P01"]) {
    const res = await councilCouncillor(throwingDb(code), { personId: "1" });
    assert.equal(
      res.body,
      null,
      `code ${code} must degrade to null, never a truthy placeholder`,
    );
  }
});
