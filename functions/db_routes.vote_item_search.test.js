// /api/db/vote-item-search — the /parliament hub's topic finder.
//
//   npm run functions:test
//
// Two properties carry this route and neither is visible in a passing response:
// `superseded_by IS NULL`, and that `scope=out` RANKS rather than filters.

const test = require("node:test");
const assert = require("node:assert/strict");
const { DB_ROUTES } = require("./db_routes.js");

const route = DB_ROUTES["vote-item-search"];
const spy = (rows = []) => {
  const calls = [];
  return {
    calls,
    db: async (sql, params) => {
      calls.push({ sql, params });
      return sql.includes("shlyo_query_fold") ? [{ alt: null }] : rows;
    },
  };
};

test("a missing q is a 400, not an unbounded scan", async () => {
  const { db } = spy();
  assert.equal((await route(db, {})).status, 400);
  assert.equal((await route(db, { q: "   " })).status, 400);
});

test("every query filters superseded_by", async () => {
  // dedupeRevotes keeps the LAST of a repeated vote, so an annulled first attempt returned
  // here would send a reader to an item the chamber decided not to stand by — and it would
  // look like an ordinary result.
  const { calls, db } = spy();
  await route(db, { q: "бюджет", ns: "52" });
  const item = calls.filter((c) => c.sql.includes("vote_item"));
  assert.ok(item.length > 0);
  assert.ok(item.every((c) => c.sql.includes("superseded_by IS NULL")));
});

test("scope=out asks for OTHER parliaments, not for none", async () => {
  // The out-of-scope group exists so a reader on the 52nd still finds a 47th-NS vote. A
  // clause that returned nothing would be the scope-filters failure with extra steps.
  const { calls, db } = spy();
  await route(db, { q: "бюджет", ns: "52", scope: "out" });
  const item = calls.find((c) => c.sql.includes("vote_item"));
  assert.match(item.sql, /ns <> \$2/);
  assert.equal(item.params[1], 52);
});

test("the in-scope clause survives a missing ns rather than dropping the parameter", async () => {
  // Dropping $2 for the unscoped case leaves it untyped and Postgres rejects the whole
  // statement — a 500 where an unscoped search was intended.
  const { calls, db } = spy();
  await route(db, { q: "бюджет" });
  const item = calls.find((c) => c.sql.includes("vote_item"));
  assert.match(item.sql, /\$2::int/);
  assert.equal(item.params[1], 0);
});

test("scope=out with no ns returns nothing rather than every parliament", async () => {
  // "Outside the selected parliament" is meaningless without one; answering with the whole
  // corpus would put 16,741 items under a heading that claims to exclude something.
  const { calls, db } = spy();
  const res = await route(db, { q: "бюджет", scope: "out" });
  assert.deepEqual(res.body.items, []);
  assert.equal(calls.length, 0, "and it must not query at all");
});

test("the shliokavitsa rewrite extends the result and never reorders it", async () => {
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("shlyo_query_fold")) return [{ alt: "byudzhet" }];
    return params[0] === "byudjet"
      ? [{ itemId: 1, title: "a" }]
      : [
          { itemId: 1, title: "a" },
          { itemId: 2, title: "b" },
        ];
  };
  const res = await route(db, { q: "byudjet", ns: "52" });
  assert.deepEqual(
    res.body.items.map((r) => r.itemId),
    [1, 2],
    "the plain row keeps its position and the rewrite appends",
  );
  assert.equal(res.body.altQuery, "byudzhet");
});

test("a database without migration 141 searches exactly as it did before", async () => {
  const err = Object.assign(new Error("no shlyo_query_fold"), { code: "42883" });
  const db = async (sql) => {
    if (sql.includes("shlyo_query_fold")) throw err;
    return [{ itemId: 1, title: "a" }];
  };
  const res = await route(db, { q: "byudjet", ns: "52" });
  assert.deepEqual(
    res.body.items.map((r) => r.itemId),
    [1],
  );
  assert.equal(res.body.altQuery, null);
});

test("a missing vote_item table degrades to an empty list, not a 500", async () => {
  // First cloud deploy, before db:load:rollcall:pg:cloud has run.
  const db = async () => Promise.reject({ code: "42P01" });
  const res = await route(db, { q: "бюджет", ns: "52" });
  assert.deepEqual(res.body.items, []);
});

test("limit and ns are clamped — they arrive from a URL", async () => {
  const { calls, db } = spy();
  await route(db, { q: "б", ns: "999", limit: "9999" });
  const item = calls.find((c) => c.sql.includes("vote_item"));
  assert.ok(item.params[2] <= 25, `limit not clamped: ${item.params[2]}`);
  assert.ok(item.params[1] <= 99, `ns not clamped: ${item.params[1]}`);
});
