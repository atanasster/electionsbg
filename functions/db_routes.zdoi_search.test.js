// /api/db/zdoi-search — ЗДОИ requests (pitay.government.bg) naming a term, for the AI
// mentions tool.
//
//   npm run functions:test

const test = require("node:test");
const assert = require("node:assert/strict");
const { DB_ROUTES } = require("./db_routes.js");

const route = DB_ROUTES["zdoi-search"];

test("a missing or too-short q is a 400, not an unbounded scan", async () => {
  const db = async () => [];
  assert.equal((await route(db, {})).status, 400);
  assert.equal((await route(db, { q: "ab" })).status, 400);
});

test("asks the whole-word function, never the loose prefix search", async () => {
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });
    return sql.includes("zdoi_coverage")
      ? [
          {
            requests: 10,
            bodies: 3,
            firstSubmitted: "2019-01-01",
            lastSubmitted: "2026-11-23",
          },
        ]
      : [
          {
            r: {
              app_id: 8905,
              submitted_on: "2024-01-10",
              money_mentions: [{ amount: "100 млн. лв.", excerpt: "…сумата от 100 млн. лв.…" }],
            },
          },
        ];
  };
  const r = await route(db, { q: "INSAIT", limit: "500" });
  const hit = calls.find((c) => c.sql.includes("zdoi_mentions"));
  assert.ok(hit);
  assert.ok(!calls.some((c) => c.sql.includes("zdoi_search")));
  assert.deepEqual(hit.params, ["INSAIT", 50]);
  assert.equal(r.body.items[0].appId, 8905);
  assert.equal(r.body.items[0].submittedOn, "2024-01-10");
  assert.equal(r.body.items[0].moneyMentions[0].amount, "100 млн. лв.");
  assert.equal(r.body.coverage.requests, 10);
});

test("a database without 207 answers no rows and no coverage, not a 500", async () => {
  const db = async () => {
    const e = new Error("missing");
    e.code = "42883";
    throw e;
  };
  const r = await route(db, { q: "INSAIT" });
  assert.deepEqual(r.body, { items: [], coverage: null });
});

test("any other database error still fails loudly", async () => {
  const db = async () => {
    const e = new Error("boom");
    e.code = "57014";
    throw e;
  };
  await assert.rejects(route(db, { q: "INSAIT" }));
});

test("a database whose 207 predates money_mentions still answers, with none", async () => {
  const db = async (sql) =>
    sql.includes("zdoi_coverage") ? [] : [{ r: { app_id: 1, subject_excerpt: "x" } }];
  const r = await route(db, { q: "INSAIT" });
  assert.deepEqual(r.body.items[0].moneyMentions, []);
  assert.equal(r.body.items[0].submittedOn, null);
});
