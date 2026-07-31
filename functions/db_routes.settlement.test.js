// Route-level tests for /api/db/procurement-settlement — the shape contract the tiles and
// the settlement page depend on. The SQL is covered by
// scripts/db/tests/procurement_settlement_scope.data.test.ts; this covers the JS layer,
// where the payload is trimmed.
//
// The load-bearing property is `awarderCount`. The tiles used to read `awarders.length`
// for their "buyers" KPI; under the ?slim shape that array is truncated to five, so
// without a separate count every settlement in the country would report "5 buyers" — a
// wrong number rendered confidently, with nothing failing.
//
// No DB: the handler is (dbRows, query) => Promise<{ body }>. Run: cd functions && npm test

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES, __resetMissLog } = require("./db_routes.js");

// The miss log is module-level and deliberately fires ONCE per process, so without this a
// test that asserts "nothing warned" would pass on state an earlier test left behind —
// order-dependence in the one direction that reads as success. Structural rather than a
// per-test call, so a test added later inherits it.
beforeEach(__resetMissLog);

const handler = DB_ROUTES["procurement-settlement"];

// A stub that can tell the handler's TWO queries apart — the precompute probe against
// procurement_settlement_payloads, and the live procurement_settlement_detail() call — and
// records which of them ran. The tests below are almost entirely about WHICH path served,
// which the older `async () => rows` stub cannot express.
const stubDb = ({ probe = [], live = [] } = {}) => {
  const calls = [];
  const fn = async (sql, params) => {
    const isProbe = sql.includes("procurement_settlement_payloads");
    calls.push({ path: isProbe ? "probe" : "live", sql, params });
    const answer = isProbe ? probe : live;
    return typeof answer === "function" ? answer(sql, params) : answer;
  };
  fn.calls = calls;
  fn.paths = () => calls.map((c) => c.path);
  return fn;
};

/** A `probe` implementation that resolves the window against a fake `procurement_scopes`
 *  USING THE COMPARISON THE SQL ACTUALLY WRITES.
 *
 *  Without this the stub answers every probe identically and the behavioural tests below
 *  cannot tell `IS NOT DISTINCT FROM` from `=` — only the SQL-text assertion could, and a
 *  single text pin is a thin guard for the property this whole change rests on. Here the
 *  comparison is read out of the SQL and applied with real three-valued logic: under `=`,
 *  `NULL = NULL` is NULL, so the row is not returned and the handler falls through to live,
 *  exactly as it would against Postgres. */
const scopesProbe =
  (scopes, rowsByScope = {}) =>
  (sql, params) => {
    const [ekatte, from, to] = params;
    // PER BOUND, not once for the whole statement. Both NULL-bearing scopes carry a NULL
    // `date_to`, so reverting only that half is the same production defect — and a single
    // flag read off the whole SQL would model it as still working.
    const cmpFor = (col) =>
      new RegExp(`${col}\\s+IS NOT DISTINCT FROM`).test(sql)
        ? (a, b) => a === b
        : (a, b) => a !== null && b !== null && a === b;
    const eqFrom = cmpFor("date_from");
    const eqTo = cmpFor("date_to");
    const hit = scopes.find(
      (sc) => eqFrom(sc.date_from, from) && eqTo(sc.date_to, to),
    );
    if (!hit) return [];
    const stored = rowsByScope[hit.scope_key] ?? {};
    return [
      {
        scope_key: hit.scope_key,
        r: stored[ekatte] ?? null,
        built: Object.keys(stored).length > 0,
      },
    ];
  };

// The two scopes that carry a NULL bound, which are the two that matter, plus one ordinary
// year for contrast. Mirrors the real table (verified: 30 rows, 2 with a NULL bound).
const SCOPES = [
  { scope_key: "all", date_from: null, date_to: null },
  { scope_key: "ns:2026_04_19", date_from: "2026-04-19", date_to: null },
  { scope_key: "y:2024", date_from: "2024-01-01", date_to: "2025-01-01" },
];

const pgError = (code) => Object.assign(new Error(`pg ${code}`), { code });

/** Run `fn` with console.warn captured. */
const captureWarnings = async (fn) => {
  const lines = [];
  const original = console.warn;
  console.warn = (m) => lines.push(String(m));
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return lines;
};

const payload = (n) => ({
  ekatte: "10135",
  name: "Варна",
  contractCount: 15079,
  totalEur: 3622680723,
  awarders: Array.from({ length: n }, (_, i) => ({
    eik: String(i),
    name: `Buyer ${i}`,
    totalEur: 1,
  })),
  topContracts: [{ key: "abc", amountEur: 1 }],
  byYear: [],
});

const db = (rows) => async () => rows;

test("drops topContracts from the default shape", async () => {
  const { body } = await handler(db([{ r: payload(112) }]), {
    ekatte: "10135",
  });
  assert.equal(body.topContracts, undefined, "no consumer reads it");
  assert.equal(body.awarders.length, 112, "the full list is served");
  assert.equal(body.contractCount, 15079, "the totals survive");
});

test("awarderCount is the TRUE count in both shapes", async () => {
  const full = await handler(db([{ r: payload(112) }]), { ekatte: "10135" });
  assert.equal(full.body.awarderCount, 112);

  const slim = await handler(db([{ r: payload(112) }]), {
    ekatte: "10135",
    slim: "1",
  });
  assert.equal(slim.body.awarders.length, 5, "the list is truncated");
  assert.equal(
    slim.body.awarderCount,
    112,
    "but the count still describes the settlement, not the slice",
  );
});

test("?limit is clamped, and never widens past the real list", async () => {
  const big = await handler(db([{ r: payload(112) }]), {
    ekatte: "10135",
    slim: "1",
    limit: "999",
  });
  assert.equal(big.body.awarders.length, 50, "clamped to the ceiling");

  const small = await handler(db([{ r: payload(3) }]), {
    ekatte: "10135",
    slim: "1",
    limit: "20",
  });
  assert.equal(small.body.awarders.length, 3, "a short list stays short");
});

test("slim is parsed as a boolean, not as string truthiness", async () => {
  // `?slim=0` and `?slim=false` are the first spellings a caller reaches for; a bare
  // `?slim` is what an HTML form emits. Reading the raw string would invert all three.
  for (const q of [{ slim: "0" }, { slim: "false" }, { slim: "no" }]) {
    const { body } = await handler(db([{ r: payload(112) }]), {
      ekatte: "10135",
      ...q,
    });
    assert.equal(
      body.awarders.length,
      112,
      `${JSON.stringify(q)} must mean FULL`,
    );
  }
  for (const q of [{ slim: "" }, { slim: "1" }, { slim: "true" }]) {
    const { body } = await handler(db([{ r: payload(112) }]), {
      ekatte: "10135",
      ...q,
    });
    assert.equal(
      body.awarders.length,
      5,
      `${JSON.stringify(q)} must mean SLIM`,
    );
  }
});

test("a missing ekatte is a 400, and an unknown one is a null body", async () => {
  const bad = await handler(db([]), {});
  assert.equal(bad.status, 400);

  const none = await handler(db([{ r: null }]), { ekatte: "00000" });
  assert.equal(none.body, null, "no settlement → null, not an empty shell");
});

test("a null awarders array cannot reach the client as a non-array", async () => {
  // The type declares `awarders` non-optional; a shape guard applied to only one branch
  // would let the full response through with `awarders: null` and crash every consumer
  // that maps over it.
  const { body } = await handler(
    db([{ r: { ...payload(0), awarders: null } }]),
    {
      ekatte: "10135",
    },
  );
  assert.ok(Array.isArray(body.awarders), "always an array");
  assert.equal(body.awarderCount, 0);
});

// ---------------------------------------------------------------------------
// Serving from the per-scope precompute (migration 123).
//
// These are about WHICH path answered, not about the payload's shape. The route degrades to
// the live function on any miss and returns the same body either way, so a broken precompute
// lookup is invisible to every assertion above: correct numbers, 200, just slow. The only
// way to catch it is to assert the precompute was actually READ.
// ---------------------------------------------------------------------------

const scopeRow = (over = {}) => ({
  scope_key: "all",
  r: payload(112),
  built: true,
  ...over,
});

test("a request with NO window reads the precompute — the case `=` would break", async () => {
  // THE test in this file. `all` is the scope with BOTH bounds NULL, and it is what the AI
  // tools send and what a bare settlement request resolves to. The client omits the query
  // param entirely when a bound is null, so both arrive here as null — and `date_from = NULL`
  // is never true. A lookup written with `=` still passes every `y:` scope, so this is the
  // assertion that separates "the precompute works" from "the fallback works".
  const db2 = stubDb({
    probe: scopesProbe(SCOPES, { all: { 68134: payload(112) } }),
    live: [{ r: payload(1) }],
  });
  const { body } = await handler(db2, { ekatte: "68134" });

  assert.deepEqual(
    db2.paths(),
    ["probe"],
    "served from the matview, no live call",
  );
  assert.deepEqual(
    db2.calls[0].params,
    ["68134", null, null],
    "both bounds bound as NULL, not omitted or empty-string",
  );
  assert.equal(body.awarderCount, 112, "the STORED payload is what is served");
});

test("the scope lookup is NULL-safe by construction", async () => {
  // Pinned against the SQL itself, deliberately. This is the one property whose regression
  // produces no failure anywhere else: every `y:` scope keeps working, so a `=` would ship.
  // Asserted PER BOUND so the failure names which half broke, and so that dropping a bound
  // condition altogether (which no behavioural test can see) fails here.
  const db2 = stubDb({ probe: [scopeRow()] });
  await handler(db2, { ekatte: "68134" });
  const { sql } = db2.calls[0];

  for (const col of ["date_from", "date_to"]) {
    assert.match(
      sql,
      new RegExp(`${col}\\s+IS NOT DISTINCT FROM \\$\\d`),
      `${col} must be compared NULL-safely`,
    );
    assert.ok(
      !new RegExp(`${col}\\s*=\\s*\\$`).test(sql),
      `${col} must not be compared with \`=\``,
    );
  }
});

test("the probe projects the columns the handler reads", async () => {
  // The stub fabricates its result rows, so it cannot notice the SELECT list drifting away
  // from what the handler destructures. Renaming `p.payload AS r`, or dropping `built`,
  // leaves every behavioural test green while in production the precompute never serves and
  // never says so — `hit.length` is 1, so no `psp:no-scope`; `built` is undefined-falsy, so
  // the wrong branch decides whether to warn. That is the plan's §7 acceptance criterion
  // ("no psp:* log lines") passing while София still times out.
  const db2 = stubDb({ probe: [scopeRow()] });
  await handler(db2, { ekatte: "68134" });
  const { sql } = db2.calls[0];

  assert.match(sql, /p\.payload AS r\b/, "the payload must arrive as `r`");
  assert.match(
    sql,
    /\bAS built\b/,
    "the built flag decides whether a miss warns",
  );
  assert.match(
    sql,
    /sc\.scope_key/,
    "the scope key names the scope in the warning",
  );
});

test("an open-ended parliament window reads the precompute", async () => {
  // The newest parliament has no successor, so its upper bound is NULL — the page DEFAULT,
  // and the other half of the NULL problem: `from` present, `to` absent.
  const db2 = stubDb({
    probe: scopesProbe(SCOPES, {
      "ns:2026_04_19": { 68134: payload(9) },
    }),
    live: [{ r: payload(1) }],
  });
  const { body } = await handler(db2, { ekatte: "68134", from: "2026-04-19" });

  assert.deepEqual(db2.paths(), ["probe"]);
  assert.deepEqual(db2.calls[0].params, ["68134", "2026-04-19", null]);
  assert.equal(
    body.awarderCount,
    9,
    "the stored payload, not a live recompute",
  );
});

test("an ordinary year scope hits too — the case a broken lookup still passes", async () => {
  // Kept as the CONTRAST to the two above: `y:` windows have no NULL bound, so they work
  // under either comparison. A change that breaks NULL-safety leaves this test green, which
  // is exactly why it cannot be the only scope covered.
  const db2 = stubDb({
    probe: scopesProbe(SCOPES, { "y:2024": { 68134: payload(7) } }),
    live: [{ r: payload(1) }],
  });
  const { body } = await handler(db2, {
    ekatte: "68134",
    from: "2024-01-01",
    to: "2025-01-01",
  });

  assert.deepEqual(db2.paths(), ["probe"]);
  assert.equal(body.awarderCount, 7);
});

test("a window that is not a scope falls back to the live function", async () => {
  const db2 = stubDb({ probe: [], live: [{ r: payload(4) }] });
  const { body } = await handler(db2, {
    ekatte: "68134",
    from: "2024-03-07",
    to: "2024-09-01",
  });

  assert.deepEqual(db2.paths(), ["probe", "live"], "probed, missed, computed");
  assert.equal(body.awarderCount, 4, "the live answer is served");
});

test("an absent matview falls back instead of erroring", async () => {
  // The route must be shippable to a database that has never run the loader — that is what
  // makes the deploy orderless, and the deliberate difference from cpv_catalog, where
  // degrading would serve a WRONG answer rather than a slow one.
  //
  // 55000 is the state that MATTERS most and is easiest to leave out: reading a matview
  // created WITH NO DATA does not return zero rows, it raises
  // object_not_in_prerequisite_state. That is exactly a database where the DDL was applied
  // and the REFRESH never ran — the first-deploy case this property is about.
  for (const code of ["42P01", "55000", "42501", "55P03"]) {
    __resetMissLog();
    const db2 = stubDb({
      probe: () => Promise.reject(pgError(code)),
      live: [{ r: payload(2) }],
    });
    let body;
    const lines = await captureWarnings(async () => {
      ({ body } = await handler(db2, { ekatte: "68134" }));
    });

    assert.deepEqual(
      db2.paths(),
      ["probe", "live"],
      `${code} degrades to live`,
    );
    assert.equal(body.awarderCount, 2, `${code} still serves the right answer`);
    assert.equal(lines.length, 1, `${code} is reported, not swallowed`);
    assert.match(lines[0], new RegExp(code));
  }
});

test("an error that is NOT a degradable state rethrows rather than double-querying", async () => {
  // A pool or connection failure is not a reason to retry as a second, heavier query — that
  // just doubles the load on a pool that is already saturated (max: 4).
  //
  // 57014 is in this list, NOT the degradable one above, and the distinction is easy to get
  // backwards: it looks like the "locked by a REFRESH" code but that is 55P03. What raises
  // 57014 here is the pool's own statement_timeout — the probe has already burned the full
  // 10 s budget, so falling back to a query 25-70x heavier cannot finish either. It would turn
  // a 10 s failure into a ~20 s failure holding a pooled connection, under exactly the
  // saturation that caused the timeout. Degrading is only correct when it beats failing.
  for (const code of ["53300", "57014"]) {
    const db2 = stubDb({ probe: () => Promise.reject(pgError(code)) });
    await assert.rejects(
      () => handler(db2, { ekatte: "68134" }),
      new RegExp(code),
    );
    assert.deepEqual(db2.paths(), ["probe"], `${code}: no live retry`);
  }
});

test("?slim still trims a payload served from the precompute", async () => {
  const db2 = stubDb({ probe: [scopeRow()] });
  const { body } = await handler(db2, { ekatte: "68134", slim: "1" });

  assert.deepEqual(db2.paths(), ["probe"]);
  assert.equal(body.awarders.length, 5, "trimmed");
  assert.equal(body.awarderCount, 112, "but counted in full");
});

test("a settlement with no seated buyer is silent; an unbuilt scope is not", async () => {
  // Only 869 of the ~5,400 settlements have a seated buyer, and every settlement tile asks
  // for the corpus window whatever place the reader picked. So "this scope holds no row for
  // this ekatte" is the ORDINARY case and must not warn — otherwise the warning is constant
  // and therefore worthless, and (worse) a Set keyed per scope lets that benign first hit
  // permanently silence a scope that genuinely was never built.
  __resetMissLog();
  const quiet = await captureWarnings(async () => {
    const db2 = stubDb({
      probe: [scopeRow({ r: null, built: true })],
      live: [{ r: null }],
    });
    const { body } = await handler(db2, { ekatte: "00001" });
    assert.equal(body, null, "unknown settlement → null body");
  });
  assert.deepEqual(quiet, [], "an unseated settlement warns about nothing");

  const loud = await captureWarnings(() =>
    handler(
      stubDb({
        probe: [scopeRow({ scope_key: "y:2011", r: null, built: false })],
        live: [{ r: payload(1) }],
      }),
      { ekatte: "68134", from: "2011-01-01", to: "2012-01-01" },
    ),
  );
  assert.equal(loud.length, 1, "a scope with no rows at all is reported");
  assert.match(loud[0], /y:2011/);
  assert.match(loud[0], /db:load:procurement-scopes:pg/, "says how to fix it");
});

test("an unmatched window is logged once, and not keyed on client input", async () => {
  // The Set is module-level and never pruned, in a container that runs minInstances=1 for
  // days. Keying it on `from`/`to` — raw query parameters — would make it an unbounded
  // allocation and an unbounded log stream, defeating the bound it exists to provide.
  __resetMissLog();
  const lines = await captureWarnings(async () => {
    for (const w of [
      { from: "2024-03-07", to: "2024-09-01" },
      { from: "zzz", to: "qqq" },
      { from: "aaa", to: "bbb" },
    ]) {
      await handler(stubDb({ probe: [], live: [{ r: payload(1) }] }), {
        ekatte: "68134",
        ...w,
      });
    }
  });
  assert.equal(lines.length, 1, "three distinct bogus windows, ONE line");
});
