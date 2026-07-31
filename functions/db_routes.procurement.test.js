// Route-level tests for the six /api/db/procurement-* dashboard routes served from the
// per-scope precompute (migration 124): overview, flow, rankings, concentration, sectors,
// benchmarks. The SQL is covered by scripts/db/tests/procurement_payloads.data.test.ts; this
// covers the JS layer — which path served, and whether a miss is visible.
//
// No DB: every handler is (dbRows, query) => Promise<{ body }>. Run: cd functions && npm test
//
// THE TEST THAT EARNS ITS PLACE is "a request with no window at all reads the precompute".
// Every other test here passes against a NULL-UNSAFE lookup: a y: scope hits, a bogus window
// falls back as designed, an absent matview falls back, the chain is intact. Only an assertion
// that the two NULL-bearing scopes read the matview distinguishes "the fallback is working"
// from "the fallback is all that is working" — and those two are `all` (what the AI tools send
// and what /api/db/procurement-flow returned 500 on) and the newest parliament (open-ended
// upper bound, the page default). See docs/plans/db-route-timeouts-v1.md §3.3.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES, __resetMissLog } = require("./db_routes.js");

// The miss log is module-level and deliberately fires ONCE per process, so without this a test
// that asserts "nothing warned" would pass on state an earlier test left behind — order
// dependence in the one direction that reads as success.
beforeEach(__resetMissLog);

// Every route served from 124, with the `kind` it must ask for. Driving the tests off this
// list rather than off one route means a seventh dashboard route added later without wiring
// scopedPayload shows up as a failure here rather than as a silent 10 s aggregate.
const KINDS = {
  "procurement-overview": "overview",
  "procurement-flow": "flow",
  "procurement-rankings": "rankings",
  "procurement-concentration": "concentration",
  "procurement-sectors": "sectors",
  "procurement-benchmarks": "benchmarks",
};
// The live aggregate each route must fall back to. Asserted BY NAME, because the stub
// classifies queries into buckets and "some live query ran" is not the property that matters:
// procurement-sectors falling back to procurement_overview() lands in the same bucket, passes
// every path assertion, and serves one dashboard's blob under another's heading at a 200 —
// on exactly the database where 124 is not loaded, which is the first-deploy state the
// fallback exists for.
const LIVE_FN = {
  "procurement-overview": "procurement_overview",
  "procurement-flow": "procurement_flow",
  "procurement-rankings": "procurement_rankings",
  "procurement-concentration": "procurement_concentration",
  "procurement-sectors": "procurement_sectors",
  "procurement-benchmarks": "procurement_benchmarks",
};

// A stub that tells the handler's queries apart — the precompute probe, the live aggregate,
// and a `cache` bucket that NOTHING should land in any more (025/031 are retired; it is kept
// solely so a reinstated cache read is detected rather than silently classed as "live").
// The tests are almost entirely about WHICH path served.
const stubDb = ({ probe = [], cache = [], live = [] } = {}) => {
  const calls = [];
  const fn = async (sql, params) => {
    const path = sql.includes("procurement_payloads")
      ? "probe"
      : /_cache\b/.test(sql)
        ? "cache"
        : "live";
    calls.push({ path, sql, params });
    const answer = path === "probe" ? probe : path === "cache" ? cache : live;
    return typeof answer === "function" ? answer(sql, params) : answer;
  };
  fn.calls = calls;
  fn.paths = () => calls.map((c) => c.path);
  return fn;
};

/** A `probe` implementation that resolves the window against a fake `procurement_scopes`
 *  USING THE COMPARISON THE SQL ACTUALLY WRITES.
 *
 *  Without this the stub answers every probe identically and the behavioural tests cannot tell
 *  `IS NOT DISTINCT FROM` from `=` — only the SQL-text assertion could, and a single text pin
 *  is a thin guard for the property this whole change rests on. Here the comparison is read out
 *  of the SQL and applied with real three-valued logic: under `=`, `NULL = NULL` is NULL, so
 *  the row is not returned and the handler falls through, exactly as against Postgres.
 *  Borrowed from db_routes.settlement.test.js, which guards the same property for 123. */
const scopesProbe =
  (scopes, payloadByScope = {}) =>
  (sql, params) => {
    const [, from, to] = params;
    // PER BOUND, not once for the whole statement. Both NULL-bearing scopes carry a NULL
    // `date_to`, so reverting only that half is the same production defect — and a single flag
    // read off the whole SQL would model it as still working.
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
    return [
      { scope_key: hit.scope_key, r: payloadByScope[hit.scope_key] ?? null },
    ];
  };

// The two scopes that carry a NULL bound, which are the two that matter, plus one ordinary
// year and one closed parliament for contrast. Mirrors the real table (verified: 30 rows,
// 2 with a NULL bound).
const SCOPES = [
  { scope_key: "all", date_from: null, date_to: null },
  { scope_key: "ns:2026_04_19", date_from: "2026-04-19", date_to: null },
  {
    scope_key: "ns:2023_04_02",
    date_from: "2023-04-02",
    date_to: "2024-06-09",
  },
  { scope_key: "y:2024", date_from: "2024-01-01", date_to: "2025-01-01" },
];

const pgError = (code) => Object.assign(new Error(`pg ${code}`), { code });

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

// Distinguishable payloads, so a test can tell WHICH source answered rather than only that
// something did.
const STORED = (scope) => ({ from: "precompute", scope });
const LIVE = { from: "live" };

// ── The NULL-safety property, from both directions ───────────────────────────

test("a request with no window at all reads the precompute (all six routes)", async () => {
  // `all` carries BOTH bounds NULL. The client omits the parameter entirely when a bound is
  // null and the AI tools send neither, so both arrive as undefined → orNull → NULL. Under
  // `=` this misses and the route silently runs the widest, most expensive aggregate there is
  // — which is exactly how /api/db/procurement-flow reached 10.006 s and a 500.
  for (const [route, kind] of Object.entries(KINDS)) {
    const db = stubDb({
      probe: scopesProbe(SCOPES, { all: STORED("all") }),
      live: [{ r: LIVE }],
    });
    const lines = await captureWarnings(async () => {
      const { body } = await DB_ROUTES[route](db, {});
      assert.deepEqual(body, STORED("all"), `${route}: served the precompute`);
    });
    assert.deepEqual(db.paths(), ["probe"], `${route}: no live aggregate ran`);
    assert.deepEqual(
      db.calls[0].params[0],
      kind,
      `${route}: asked for ${kind}`,
    );
    assert.deepEqual(lines, [], `${route}: a hit must not warn`);
  }
});

test("the newest parliament's open-ended window reads the precompute", async () => {
  // The other half of the NULL problem, and the PAGE DEFAULT: the newest parliament has no
  // successor, so `from` is present and `to` is absent.
  for (const route of Object.keys(KINDS)) {
    const db = stubDb({
      probe: scopesProbe(SCOPES, { "ns:2026_04_19": STORED("ns:2026_04_19") }),
      live: [{ r: LIVE }],
    });
    let body;
    const lines = await captureWarnings(async () => {
      ({ body } = await DB_ROUTES[route](db, { from: "2026-04-19" }));
    });
    assert.deepEqual(body, STORED("ns:2026_04_19"), `${route}: precomputed`);
    assert.deepEqual(db.paths(), ["probe"], `${route}: no fallback`);
    assert.deepEqual(lines, [], `${route}: a hit must not warn`);
  }
});

test("each route falls back to ITS OWN live aggregate, by name", async () => {
  // Path CLASS is not path IDENTITY. Every assertion elsewhere in this file checks that "a
  // live query ran"; none of them would notice procurement-sectors calling
  // procurement_overview(). That mistake serves one dashboard's payload under another's
  // heading, at a 200, and only on a database where the precompute is missing — which is the
  // orderless-deploy state this fallback was built for, i.e. the one nobody tests.
  for (const [route, fn] of Object.entries(LIVE_FN)) {
    const db = stubDb({ probe: scopesProbe(SCOPES, {}), live: [{ r: LIVE }] });
    await captureWarnings(() => DB_ROUTES[route](db, {}));
    const liveCall = db.calls.find((c) => c.path === "live");
    assert.ok(liveCall, `${route}: a live fallback must run`);
    assert.match(
      liveCall.sql,
      new RegExp(`\\b${fn}\\(`),
      `${route} must fall back to ${fn}(), not to another dashboard's aggregate`,
    );
  }
});

test("the probe projects the columns and join the handler reads", async () => {
  // The stub fabricates its result rows, so it cannot notice the SELECT list or the join shape
  // drifting away from what the handler destructures. Each of these leaves every behavioural
  // test in this file green while changing what production does:
  //
  //  - renaming `p.payload AS r`  → the precompute never serves, AND the route reports
  //    pp:not-built, sending an operator to re-run a multi-minute Cloud SQL loader against
  //    what is really a typo in the SQL;
  //  - dropping `sc.scope_key`    → the not-built warning cannot name the scope;
  //  - LEFT JOIN → JOIN, or moving `p.kind` from ON to WHERE → an unbuilt scope stops
  //    resolving at all, so the miss reports as pp:no-scope instead of pp:not-built. That is
  //    the one line §7 deliberately EXEMPTS from its acceptance criteria, so the deploy check
  //    passes while nothing is precomputed.
  const db = stubDb({ probe: scopesProbe(SCOPES, {}), live: [{ r: LIVE }] });
  await captureWarnings(() => DB_ROUTES["procurement-flow"](db, {}));
  const { sql } = db.calls[0];

  assert.match(sql, /p\.payload AS r\b/, "the payload must arrive as `r`");
  // Anchored on SELECT, not a bare /sc\.scope_key/: that column also appears in the JOIN
  // condition, so an unanchored match stays green when it is dropped from the projection —
  // and then the not-built warning names `undefined` instead of the scope an operator needs.
  assert.match(
    sql,
    /SELECT\s+sc\.scope_key\b/,
    "the scope key must be PROJECTED — it names the scope in the warning",
  );
  assert.match(sql, /LEFT JOIN\s+procurement_payloads/, "must be a LEFT JOIN");
  assert.match(
    sql,
    /ON\s+p\.kind\s*=\s*\$\d/,
    "kind must be filtered in the JOIN condition, not in WHERE",
  );
});

test("the lookup compares BOTH bounds NULL-safely, in the SQL itself", async () => {
  // The behavioural tests above would also pass if the scope table happened to be probed some
  // other way; this pins the operator, per bound. Reverting either half alone reintroduces the
  // defect for the scopes that carry a NULL in that position.
  const db = stubDb({ probe: [], live: [{ r: LIVE }] });
  await DB_ROUTES["procurement-flow"](db, {});
  const { sql } = db.calls[0];

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

test("a closed parliament window and a calendar year both read the precompute", async () => {
  // The ordinary scopes. These pass with a NULL-unsafe lookup too — they are here so a
  // regression that breaks the COMMON case is not mistaken for the NULL one.
  const cases = [
    [{ from: "2023-04-02", to: "2024-06-09" }, "ns:2023_04_02"],
    [{ from: "2024-01-01", to: "2025-01-01" }, "y:2024"],
  ];
  for (const [q, scope] of cases) {
    const db = stubDb({
      probe: scopesProbe(SCOPES, { [scope]: STORED(scope) }),
      live: [{ r: LIVE }],
    });
    let body;
    const lines = await captureWarnings(async () => {
      ({ body } = await DB_ROUTES["procurement-overview"](db, q));
    });
    assert.deepEqual(body, STORED(scope));
    assert.deepEqual(db.paths(), ["probe"]);
    assert.deepEqual(lines, [], `${scope}: a hit must not warn`);
  }
});

// ── Degrading, and saying so ─────────────────────────────────────────────────

test("a window that is not a scope falls back to live and warns once", async () => {
  // A caller may legitimately ask for a window that is not one of the thirty (a hand-built
  // URL). Serving it live is the DESIGNED behaviour, not a defect — which is why §7 exempts
  // pp:no-scope from its acceptance criteria. It still logs, because the same line is how an
  // operator learns a NEW election window exists that the scopes loader has not been re-run for.
  const db = stubDb({
    probe: scopesProbe(SCOPES),
    live: [{ r: LIVE }],
  });
  const lines = await captureWarnings(async () => {
    const { body } = await DB_ROUTES["procurement-flow"](db, {
      from: "2023-05-05",
      to: "2023-06-06",
    });
    assert.deepEqual(body, LIVE, "the live answer is served");
  });
  assert.deepEqual(db.paths(), ["probe", "live"], "probed, missed, computed");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^pp:no-scope:flow —/);
  assert.match(lines[0], /2023-05-05/, "the window is named for diagnosis");
});

test("a scope present but never built warns that the LOADER did not run", async () => {
  // Distinct from the above, and the distinction is the whole point of the log: an unmatched
  // window is a caller's doing, an unbuilt scope is an operator's. Every (kind, scope) pair has
  // a non-NULL payload by construction (180/180), so a row with a NULL payload can only mean
  // the matview was never refreshed on this database.
  const db = stubDb({
    probe: scopesProbe(SCOPES, {}), // scope resolves, payload is null
    live: [{ r: LIVE }],
  });
  const lines = await captureWarnings(async () => {
    const { body } = await DB_ROUTES["procurement-sectors"](db, {});
    assert.deepEqual(body, LIVE);
  });
  assert.deepEqual(db.paths(), ["probe", "live"]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^pp:not-built:sectors:all —/);
  assert.match(lines[0], /db:load:procurement-scopes:pg/, "names the fix");
});

test("an unreadable or unbuilt matview falls back instead of erroring", async () => {
  // This is what makes the deploy orderless — the deliberate difference from cpv_catalog,
  // where degrading would serve a WRONG answer rather than a slow one.
  //
  // 55000 is the state that MATTERS most and is easiest to leave out: reading a matview created
  // WITH NO DATA does not return zero rows, it raises object_not_in_prerequisite_state. That is
  // exactly a database where the DDL was applied and the REFRESH never ran — the first-deploy
  // case this property is about, and a 500 without it.
  for (const code of ["42P01", "55000", "42501", "55P03"]) {
    // Redundant TODAY — the key carries the code, so the four iterations cannot collide and
    // beforeEach already cleared the Set. Kept so the `lines.length === 1` assertion below
    // stays true of each iteration on its own merits rather than on that key-shape accident,
    // which is exactly the sort of thing a later edit to the key changes without noticing.
    __resetMissLog();
    const db = stubDb({
      probe: () => Promise.reject(pgError(code)),
      live: [{ r: LIVE }],
    });
    const lines = await captureWarnings(async () => {
      const { body } = await DB_ROUTES["procurement-concentration"](db, {});
      assert.deepEqual(body, LIVE, `${code} still serves the right answer`);
    });
    assert.deepEqual(db.paths(), ["probe", "live"], `${code} degrades to live`);
    assert.equal(lines.length, 1, `${code} is reported, not swallowed`);
    assert.match(lines[0], new RegExp(`pp:read-failed:concentration:${code}`));
  }
});

test("a non-degradable error rethrows rather than double-querying", async () => {
  // A pool or connection failure is not a reason to retry as a second, much heavier query —
  // that just doubles the load on a pool that is already saturated (max: 4).
  //
  // 57014 belongs HERE, not in the list above, and it is easy to get backwards: it looks like
  // the "locked by a REFRESH" code but that is 55P03. What raises 57014 is the pool's own
  // statement_timeout — the probe has already burned the full 10 s budget, so falling back to
  // an aggregate touching 199k-411k buffers cannot finish either. It would turn a 10 s failure
  // into a ~20 s one holding a pooled connection, under exactly the saturation that caused the
  // timeout.
  for (const code of ["53300", "57014"]) {
    const db = stubDb({ probe: () => Promise.reject(pgError(code)) });
    await assert.rejects(
      () => DB_ROUTES["procurement-benchmarks"](db, {}),
      new RegExp(code),
    );
    assert.deepEqual(db.paths(), ["probe"], `${code}: no live retry`);
  }
});

// ── The retired all-only caches ──────────────────────────────────────────────

test("no DASHBOARD route reads a retired *_cache matview, on any scope shape", async () => {
  // 025's procurement_overview_cache and 031's procurement_rankings_cache each answered exactly
  // ONE of the thirty scopes; 124 answers all thirty, verified jsonb-equal on prod before they
  // were dropped. This asserts the READ is gone, not merely unused: those relations no longer
  // exist, so a lingering read raises 42P01 inside a bare try/catch and degrades SILENTLY back
  // to the live aggregate — the exact 10 s path this whole change removed, with nothing red.
  //
  // BOTH query shapes, and that is the point. The three tests this replaced included one for a
  // WINDOWED scope specifically; driving only `{}` here would pass against a reinstated
  // `if (from || to)` cache read (mutation-checked). Scoped to the six dashboard routes by
  // name — four other routes (030, 033, 044, 077) read *_cache matviews entirely legitimately.
  for (const q of [{}, { from: "2023-04-02", to: "2024-06-09" }]) {
    const label = Object.keys(q).length ? "windowed" : "no window";
    for (const route of Object.keys(KINDS)) {
      const db = stubDb({
        probe: scopesProbe(SCOPES, {}),
        live: [{ r: LIVE }],
      });
      await captureWarnings(() => DB_ROUTES[route](db, q));
      assert.deepEqual(
        db.paths(),
        ["probe", "live"],
        `${route} (${label}): must go precompute → live, with nothing in between`,
      );
      assert.ok(
        !db.calls.some((c) => /_cache\b/.test(c.sql)),
        `${route} (${label}): still reads a retired cache matview`,
      );
    }
  }
});

// ── The log must stay greppable and bounded ──────────────────────────────────

test("miss-log keys carry no client input, and the message is sanitised", async () => {
  // The Set is module-level, never pruned, in a container that lives for days with
  // minInstances=1 — so a key derived from a query parameter is an unbounded allocation AND an
  // unbounded log stream. The MESSAGE interpolates the window, so it is capped and stripped:
  // a newline would split one warning into several Cloud Logging entries, and because this
  // fires once per process a junk request would otherwise permanently occupy the one line that
  // exists to reveal a real new election window.
  const db = stubDb({ probe: scopesProbe(SCOPES), live: [{ r: LIVE }] });
  const lines = await captureWarnings(() =>
    DB_ROUTES["procurement-flow"](db, {
      // An INTERIOR newline, deliberately. `orNull` trims the ends, so a LEADING "\n" is gone
      // before logSafe ever runs — a fixture using one asserts nothing and stays green with
      // the control-character strip deleted. This is the input that discriminates.
      from: "2026-01-01\nINFO all good",
      to: "x".repeat(200),
    }),
  );
  assert.equal(lines.length, 1);
  const [key] = lines[0].split(" — ");
  assert.equal(key, "pp:no-scope:flow", "the key is a constant plus the kind");
  assert.ok(
    lines[0].includes("·"),
    "the control char is replaced, not merely dropped",
  );
  assert.ok(
    !lines[0].includes("x".repeat(33)),
    "an over-long bound is truncated to 32",
  );
  assert.ok(!lines[0].includes("\n"), "no newline reaches the log");
  // Tight enough to fail a WEAKENED cap, not merely an absent one: the fixed prose is ~150
  // chars and each bound is capped at 32, so a slice(0, 64) regression pushes past this.
  assert.ok(
    lines[0].length < 230,
    `message stayed bounded (${lines[0].length})`,
  );
});

test("repeated misses log once, per kind", async () => {
  // Once per process is the contract — the log is a signal that the loader never ran, not a
  // per-request stream. But the six kinds are independent signals: overview being unbuilt says
  // nothing about flow.
  const lines = await captureWarnings(async () => {
    for (const route of Object.keys(KINDS)) {
      for (let i = 0; i < 3; i++) {
        await DB_ROUTES[route](
          stubDb({
            probe: scopesProbe(SCOPES, {}),
            cache: [],
            live: [{ r: LIVE }],
          }),
          {},
        );
      }
    }
  });
  assert.equal(lines.length, 6, "one line per kind, not per request");
  assert.deepEqual(
    lines.map((l) => l.split(" — ")[0]).sort(),
    Object.values(KINDS)
      .map((k) => `pp:not-built:${k}:all`)
      .sort(),
  );
});
