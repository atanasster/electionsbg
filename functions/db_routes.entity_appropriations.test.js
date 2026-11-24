// /api/db/entity-appropriations — budget-law lines (208) and spending decrees (209) for a
// curated entity's explicit (year, code) lines and decree ids, for the AI mentions tool.
//
//   npm run functions:test

const test = require("node:test");
const assert = require("node:assert/strict");
const { DB_ROUTES } = require("./db_routes.js");

const route = DB_ROUTES["entity-appropriations"];

test("no valid line or decree id is a 400, not an unbounded read", async () => {
  const db = async () => [];
  assert.equal((await route(db, {})).status, 400);
  assert.equal(
    (await route(db, { lines: "'; DROP TABLE x;--", decrees: "-1,abc" }))
      .status,
    400,
  );
  // a code without its law's year is refused — codes repeat across laws
  assert.equal((await route(db, { lines: "NP-25.001-0048" })).status, 400);
  // past int4: a 400, not a 22003 → 500
  assert.equal((await route(db, { decrees: "999999999999" })).status, 400);
});

test("passes only well-formed lines and ids, as bound (year, code) arrays", async () => {
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });
    return [];
  };
  const r = await route(db, {
    lines: "2025:NP-25.001-0048, bogus ,2026:NP-25.002-0048",
    decrees: "156315,0,x",
  });
  const named = calls.find((c) => c.sql.includes("budget_named_appropriation"));
  const decree = calls.find((c) => c.sql.includes("budget_spending_decree"));
  assert.deepEqual(named.params, [
    [2025, 2026],
    ["NP-25.001-0048", "NP-25.002-0048"],
  ]);
  assert.match(named.sql, /\(p\.fiscal_year, p\.project_code\) IN/);
  assert.deepEqual(decree.params, [[156315]]);
  assert.deepEqual(r.body, { named: [], decrees: [] });
});

test("only queries the side it was asked for", async () => {
  const calls = [];
  const db = async (sql) => {
    calls.push(sql);
    return [];
  };
  await route(db, { decrees: "156315" });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("budget_spending_decree"));
});

test("a database without 208/209 answers empty arms, not a 500", async () => {
  const db = async () => {
    const e = new Error("missing");
    e.code = "42P01";
    throw e;
  };
  const r = await route(db, {
    lines: "2025:NP-25.001-0048",
    decrees: "156315",
  });
  assert.deepEqual(r.body, { named: [], decrees: [] });
});

test("any other database error still fails loudly", async () => {
  const db = async () => {
    const e = new Error("boom");
    e.code = "57014";
    throw e;
  };
  await assert.rejects(route(db, { decrees: "156315" }));
});
