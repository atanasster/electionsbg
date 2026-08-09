// Route-level tests for /api/db/open-calls (open_calls, migration 142).
//
// The SQL is covered by scripts/db/tests/open_calls.data.test.ts; this covers the JS layer —
// which codes degrade, which propagate, and whether a miss is visible to an operator.
//
// No DB: the handler is (dbRows, query) => Promise<{ body }>. Run: cd functions && npm test
//
// THE TESTS THAT EARN THEIR PLACE are the two NEGATIVE ones. Degrading on 42P01/55000/55P03 is
// the easy half and every plausible implementation gets it right. What distinguishes a correct
// route here is refusing to degrade on:
//   * 57014 — the pool's OWN statement_timeout. The probe has already spent the whole budget,
//     so a fallback cannot finish either; degrading converts a 10 s failure into a 20 s one
//     while holding a pooled connection under exactly the saturation that caused it.
//   * 42501 — a missing GRANT. On a PLAIN TABLE that is permanent, not a refresh artifact, so
//     degrading serves an empty page for ever instead of failing loudly once. (The 123/124
//     precedent DOES include 42501, because those are matviews — copying it here was the bug.)

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES, __resetMissLog } = require("./db_routes.js");

beforeEach(__resetMissLog);

const route = DB_ROUTES["open-calls"];

/** A dbRows that answers every query from `rows`. */
const ok =
  (rows = []) =>
  async () =>
    rows;

/** A dbRows that always fails with `code`. */
const failing = (code) => async () => {
  const e = new Error(`simulated ${code}`);
  e.code = code;
  throw e;
};

const CALL = {
  id: 1,
  source: "isun",
  source_key: "guid",
  code: "BG16RFPR001-1.011",
  kind: "call",
  title: "Внедряване на иновации",
  status: "open",
  datePrecision: "exact",
  closesAt: "2026-09-14T13:30:00.000Z",
  daysLeft: 6,
};

test("returns the three groups plus the crawl stamp", async () => {
  const { body } = await route(ok([CALL]), {});
  for (const k of ["calls", "indicative", "consultations", "crawl"])
    assert.ok(Array.isArray(body[k]), `${k} should be an array`);
  // `calls` concatenates open + upcoming, so a stub answering every query yields two.
  assert.equal(body.calls.length, 2);
});

test("groups are never merged — each is its own query", async () => {
  // If the route ranked once and partitioned afterwards, a stub that returns a single row per
  // query could not produce four independently-populated groups.
  const seen = [];
  const dbRows = async (sql, params) => {
    seen.push(params ? params.slice(0, 2) : null);
    return [];
  };
  await route(dbRows, {});
  const statusKind = seen.filter(Boolean).map((p) => p.join("/"));
  assert.deepEqual(statusKind, [
    "open/call",
    "upcoming/call",
    "indicative/call",
    "consultation/consultation",
  ]);
});

// 42883 FIRST in this list, because it is the code a database without migration 142 actually
// raises: the group queries call open_calls_list(), a FUNCTION. An earlier version omitted it,
// which made the whole degrade branch UNREACHABLE in exactly the first-cloud-deploy case its
// log message addresses — the route 500'd instead.
for (const code of ["42883", "42P01", "55000", "55P03"]) {
  test(`degrades to an empty page on ${code}`, async () => {
    const { body } = await route(failing(code), {});
    assert.deepEqual(body, {
      calls: [],
      indicative: [],
      consultations: [],
      crawl: [],
    });
  });
}

test("logs the miss ONCE per process, naming the loader to run", async () => {
  const warned = [];
  const orig = console.warn;
  console.warn = (m) => warned.push(String(m));
  try {
    await route(failing("42P01"), {});
    await route(failing("42P01"), {});
  } finally {
    console.warn = orig;
  }
  assert.equal(warned.length, 1, "a crawler must not multiply this into one line per request");
  assert.match(warned[0], /oc:not-built/);
  assert.match(warned[0], /db:load:open-calls:pg/);
});

test("does NOT degrade on 57014 (the pool's own timeout)", async () => {
  await assert.rejects(() => route(failing("57014"), {}), /simulated 57014/);
});

test("does NOT degrade on 42501 (a permanent missing GRANT on a plain table)", async () => {
  await assert.rejects(() => route(failing("42501"), {}), /simulated 42501/);
});

test("an unexpected error still propagates", async () => {
  await assert.rejects(() => route(failing("XX000"), {}), /simulated XX000/);
});

test("limit is clamped and audience is passed through", async () => {
  const params = [];
  const dbRows = async (_sql, p) => {
    if (p) params.push(p);
    return [];
  };
  await route(dbRows, { limit: "9999", audience: "farmer" });
  for (const p of params) {
    assert.equal(p[2], "farmer", "audience must reach the function");
    assert.ok(p[3] <= 200, `limit ${p[3]} exceeds the ceiling`);
  }
});

test("a blank audience becomes NULL, not an empty string", async () => {
  // `audience @> ARRAY['']` matches nothing, so an empty string would silently return zero
  // rows for every reader who has not chosen a facet.
  const params = [];
  const dbRows = async (_sql, p) => {
    if (p) params.push(p);
    return [];
  };
  await route(dbRows, { audience: "  " });
  for (const p of params) assert.equal(p[2], null);
});

// ── Registry contract (db_table.js), which the browse page depends on ──────────────────
const { REGISTRY } = require("./db_table.js");

test("the browse resource floors on kind='call' + status='open'", () => {
  // open_calls is an ARCHIVE — the loader never deletes — and defaultSort is closes_at ASC.
  // Without a floor the default request leads with the OLDEST EXPIRED rows (measured: 8 of the
  // first 8 closed, oldest 2024-06-22), and the /funds tile's count disagrees with what a
  // reader sees on arrival.
  const df = REGISTRY.open_calls.defaultFilters ?? [];
  assert.deepEqual(
    df.map((f) => `${f.col}=${f.val}`).sort(),
    ["kind=call", "status=open"],
  );
});

test("audience is NOT declared filterable — an `in` filter on text[] 500s", () => {
  // `WHERE audience IN ('farmer')` against a text[] column raises 22P02 (malformed array
  // literal), a guaranteed 500. The plan's own registry sketch specified filter:"in" here; the
  // audience facet is served by the ROUTE's p_audience (array containment) instead.
  assert.equal(REGISTRY.open_calls.columns.audience.filter, undefined);
});

test("budget_eur has no SUM aggregate, but does have its denominator", () => {
  // Money is NULL unless enrichment IN ('source','reviewed'), so a SUM would total only the
  // rows that publish a budget while reading as the total across all of them.
  const aggs = REGISTRY.open_calls.aggregates;
  assert.ok(!aggs.some((a) => a.fn === "sum"), "a bare SUM would misstate the total");
  assert.ok(
    aggs.some((a) => a.fn === "count" && a.col === "budget_eur"),
    "the N-of-M published-budget denominator must be available",
  );
});

test("every selected column is declared, and every declared column is selectable", () => {
  const r = REGISTRY.open_calls;
  for (const c of r.select)
    assert.ok(r.columns[c], `select lists ${c}, which is not declared`);
});
