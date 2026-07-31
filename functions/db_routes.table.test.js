// Route-level tests for /api/db/table + /api/db/facets REQUEST validation — the 400
// boundary, not the SQL. The SQL and the registry are covered by db_table.test.js.
//
// No DB: every handler is (dbRows, query) => Promise<{ status?, body }>.
// Run: cd functions && npm test
//
// WHY THIS FILE EXISTS. `awarder_ekatte` is the settlement browser's identity scope, so
// buildFilter throws on an empty value rather than widening to the national corpus at a
// 200 (that is the right call — see the `required` note there). But the throw was a bare
// Error, and index.js has ONE catch-all that answers 500. So a caller that fired before
// its route param resolved got a 500 in ~3 ms, having touched no pool and run no query:
// 70 of them over 2026-07-28…07-31, the third-largest source of 500s on the `db` service
// after the statement_timeout and lock_timeout families. Those two take real work to tell
// apart; a malformed request sitting in the same bucket is pure noise in the one signal
// that is supposed to mean the server broke. See docs/plans/db-route-timeouts-v1.md §9.2.
//
// THE TEST THAT EARNS ITS PLACE is "no query ran" (asserted on every 400 below). A status
// assertion alone passes against a handler that resolves the semi-join, hits Postgres, and
// only then decides it dislikes the request — which is the expensive failure, not the
// visible one. Rejecting before the pool is touched is the property that makes a
// misfiring client cost ~0 instead of a connection.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES } = require("./db_routes.js");

// A query fn that RECORDS instead of querying. Every 400 case must leave `calls` empty;
// the discriminating case (a valid ekatte) must not.
const spyDb = (rows = []) => {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    // runDbTable's second round-trip is the count+aggregate; `_count` is the only field
    // it reads by name. Anything else can be an empty page.
    return /count\(\*\)/.test(sql) ? [{ _count: 0 }] : rows;
  };
  fn.calls = calls;
  return fn;
};

// The route's own console.warn would otherwise scroll past the assertions. Captured, not
// silenced — a malformed request must stay visible in the logs, and one test asserts it.
const captureWarn = async (cb) => {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    return { result: await cb(), lines };
  } finally {
    console.warn = original;
  }
};

const q = (req) => ({ q: JSON.stringify(req) });

// The exact request from the production logs, minimized: a settlement contracts browser
// firing with an unresolved :ekatte.
const EMPTY_REQUIRED = {
  resource: "contracts",
  pageSize: 1,
  filters: { columns: [{ id: "awarder_ekatte", value: "" }] },
};

test("an empty `required` filter is a 400, and costs no query", async () => {
  const db = spyDb();
  const { result, lines } = await captureWarn(() =>
    DB_ROUTES.table(db, q(EMPTY_REQUIRED)),
  );

  assert.equal(result.status, 400, "malformed request → 400, not 500");
  assert.match(
    result.body.error,
    /awarder_ekatte: required filter received no value/,
    "the message names the offending filter, so the misfiring client is findable",
  );
  assert.deepEqual(db.calls, [], "rejected before the pool was touched");
  assert.equal(
    lines.length,
    1,
    "still logged — 70 of these was itself the signal",
  );
  assert.match(lines[0], /db route table: bad request/);
});

test("the same request on /api/db/facets is a 400 too", async () => {
  // Same buildWhere, different entry point. The settlement page's KPI strip fires facets
  // from the SAME filter set as the table below it, so a fix that only covered `table`
  // would leave half the misfire 500-ing.
  const db = spyDb();
  const { result } = await captureWarn(() =>
    DB_ROUTES.facets(db, {
      q: JSON.stringify({
        resource: "contracts",
        columns: ["procurement_method"],
        fixedFilters: [{ id: "awarder_ekatte", value: "" }],
        filters: [],
      }),
    }),
  );

  assert.equal(result.status, 400);
  assert.match(result.body.error, /required filter received no value/);
  assert.deepEqual(db.calls, []);
});

// The rest of the caller-blame class — all of these were 500s for the same reason.
for (const [name, req] of [
  ["unknown resource", { resource: "no_such_resource" }],
  [
    "a column the resource does not expose as a filter",
    {
      resource: "contracts",
      filters: { columns: [{ id: "ocid", value: "x" }] },
    },
  ],
  [
    "a scope column outside scopeCols",
    { resource: "contracts", scope: { col: "amount_eur", val: "1" } },
  ],
  [
    "a globalCols entry that is not searchable",
    {
      resource: "contracts",
      filters: { global: "хемус", globalCols: ["amount_eur"] },
    },
  ],
  [
    "a semijoin handed an array (would bind as '{a,b}' and match nothing)",
    {
      resource: "contracts",
      filters: {
        columns: [{ id: "awarder_ekatte", value: ["68134", "10135"] }],
      },
    },
  ],
  [
    // `for…of` over an object throws a TypeError — same caller mistake, and it reached
    // the route with no message at all.
    "filters.columns sent as an object",
    { resource: "contracts", filters: { columns: { id: "tag" } } },
  ],
]) {
  test(`400, not 500: ${name}`, async () => {
    const db = spyDb();
    const { result } = await captureWarn(() => DB_ROUTES.table(db, q(req)));
    assert.equal(result.status, 400, `${name} → 400`);
    assert.ok(result.body.error, "carries a message the caller can act on");
    assert.deepEqual(db.calls, [], "rejected before the pool was touched");
  });
}

// --- the two directions that make the 400 mean something -----------------------------

test("a VALID awarder_ekatte still serves — the guard discriminates", async () => {
  // Without this, every assertion above is satisfied by a handler that 400s unconditionally.
  const db = spyDb([{ key: "c1" }]);
  const res = await DB_ROUTES.table(
    db,
    q({
      resource: "contracts",
      pageSize: 1,
      filters: { columns: [{ id: "awarder_ekatte", value: "68134" }] },
    }),
  );

  assert.equal(res.status, undefined, "no status → the 200 default");
  assert.equal(res.body.rows.length, 1);
  assert.ok(db.calls.length >= 1, "the query actually ran");
  assert.match(
    db.calls[0].sql,
    /awarder_eik IN \(SELECT eik FROM awarder_seats/,
    "and ran as the semi-join, not as a widened corpus scan",
  );
  assert.ok(
    db.calls[0].params.includes("68134"),
    "with the ekatte BOUND, never interpolated",
  );
});

test("a server fault is NOT demoted to 400", async () => {
  // The whole point of the split. If badRequest swallowed everything, a dead pool or a
  // registry typo would answer 400 — and the 500 bucket, which is what this change exists
  // to keep honest, would go quiet for the outages it is supposed to surface.
  const dead = async () => {
    const e = new Error("connection terminated unexpectedly");
    e.code = "57P01";
    throw e;
  };
  await assert.rejects(
    () =>
      DB_ROUTES.table(
        dead,
        q({
          resource: "contracts",
          filters: { columns: [{ id: "awarder_ekatte", value: "68134" }] },
        }),
      ),
    /connection terminated/,
    "propagates to index.js's catch-all, which answers 500",
  );
});

test("a malformed `q` is still a 400 (unchanged)", async () => {
  const db = spyDb();
  const res = await DB_ROUTES.table(db, { q: "{not json" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "bad q");
  assert.deepEqual(db.calls, []);
});
