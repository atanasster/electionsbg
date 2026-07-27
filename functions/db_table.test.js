// Pure unit tests for the db_table WHERE builder — specifically the free-text
// `global` search arm and its `globalCols` allowlist (no DB needed; buildWhere
// only emits SQL text + params).
// Run: cd functions && npm test   (Node 22 built-in runner, zero deps)

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildWhere,
  REGISTRY,
  runDbFacets,
  buildAggSelect,
} = require("./db_table.js");

const contracts = REGISTRY.contracts;

test("global search ORs every searchable column by default", () => {
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "хемус" },
  });
  // title (searchText → FTS + trigram over the fold) …
  assert.ok(whereSql.includes("title_fold"), "title arm present");
  // … plus the entity-name arms.
  assert.ok(
    whereSql.includes("awarder_name ILIKE"),
    "awarder_name arm present",
  );
  assert.ok(
    whereSql.includes("contractor_name ILIKE"),
    "contractor_name arm present",
  );
});

test("globalCols=['title'] restricts the search to the title arm only", () => {
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "хемус", globalCols: ["title"] },
  });
  assert.ok(whereSql.includes("title_fold"), "title arm kept");
  assert.ok(
    !whereSql.includes("awarder_name ILIKE"),
    "awarder_name arm dropped",
  );
  assert.ok(
    !whereSql.includes("contractor_name ILIKE"),
    "contractor_name arm dropped",
  );
});

test("globalCols can select a single entity-name column", () => {
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "хемус", globalCols: ["contractor_name"] },
  });
  assert.ok(
    whereSql.includes("contractor_name ILIKE"),
    "contractor_name arm kept",
  );
  assert.ok(!whereSql.includes("title_fold"), "title arm dropped");
});

test("globalCols rejects a non-searchable column (no silent full-corpus match)", () => {
  assert.throws(
    () =>
      buildWhere(contracts, {
        filters: { global: "хемус", globalCols: ["procurement_method"] },
      }),
    /column not searchable: procurement_method/,
  );
  // A pure typo is rejected the same way — never silently ignored.
  assert.throws(
    () =>
      buildWhere(contracts, {
        filters: { global: "хемус", globalCols: ["ttile"] },
      }),
    /column not searchable: ttile/,
  );
});

test("an empty globalCols array is treated as 'no restriction'", () => {
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "хемус", globalCols: [] },
  });
  assert.ok(whereSql.includes("title_fold"), "title arm present");
  assert.ok(
    whereSql.includes("contractor_name ILIKE"),
    "contractor_name arm present",
  );
});

test("a valid globalCols with no global term emits no search arm", () => {
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "", globalCols: ["title"] },
  });
  assert.ok(!/ILIKE|title_fold/.test(whereSql), "no search arm emitted");
});

test("globalCols is validated even when there is no global term", () => {
  // A malformed request must throw regardless of whether a search term is
  // active — not be silently accepted in the empty-term case.
  assert.throws(
    () =>
      buildWhere(contracts, {
        filters: { global: "", globalCols: ["nope"] },
      }),
    /column not searchable: nope/,
  );
});

test("globalFtsOnly drops the trigram %> fallback, keeps the FTS arm", () => {
  // The project-file seed sets this: its membership is decided by the Cyrillic
  // confidence gate, so the fuzzy `%>` arm never admits a member — it only pulls
  // unrelated near-spellings (планиране for саниране) into the amount-sorted
  // seed window and inflates the exact-count banner. FTS-only makes it honest.
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "саниране", globalCols: ["title"], globalFtsOnly: true },
  });
  assert.ok(whereSql.includes("fold_prefix_tsquery"), "FTS arm kept");
  assert.ok(!whereSql.includes("%>"), "trigram %> arm dropped");
  assert.ok(
    !whereSql.includes("translit_bg_latin"),
    "trigram translit fallback dropped",
  );
});

test("default (no globalFtsOnly) keeps BOTH the FTS and trigram arms", () => {
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "саниране", globalCols: ["title"] },
  });
  assert.ok(whereSql.includes("fold_prefix_tsquery"), "FTS arm present");
  assert.ok(whereSql.includes("%>"), "trigram %> arm present by default");
});

test("globalFtsOnly is a no-op on a non-searchText (name) column", () => {
  // contractor_name is a searchFold/ILIKE column, not searchText — the flag only
  // gates the FTS/trigram searchText arm, so the name match is unchanged.
  const { whereSql } = buildWhere(contracts, {
    filters: {
      global: "хемус",
      globalCols: ["contractor_name"],
      globalFtsOnly: true,
    },
  });
  assert.ok(whereSql.includes("contractor_name ILIKE"), "name arm unchanged");
});

// ---- registry shape invariants ----------------------------------------------
// The engine assumes these and never checks them, so a mistake fails at RUNTIME with a
// 500 on the live route rather than at commit time. Table-driven over every resource so
// a new one is covered the moment it is added.
//
// NOTE what is deliberately NOT asserted: `select ⊆ columns`. The two serve different
// purposes — `columns` is the CLIENT-facing whitelist (what may be sorted/filtered/
// searched, the security boundary), while `select` is the server-controlled projection
// and is legitimately broader. `ngos` projects `signals` (a real ngos_list column) that
// is intentionally not client-addressable. Validating projection names needs the live
// schema, not the registry.

test("every client-addressable column is declared", () => {
  // The security-relevant direction: anything the client can name in a sort, filter,
  // search or scope MUST be in `columns`, because that is the only place the engine
  // validates identifiers before they reach the SQL string.
  for (const [name, r] of Object.entries(REGISTRY)) {
    for (const [col] of r.defaultSort ?? [])
      assert.ok(
        r.columns[col],
        `${name}: defaultSort references undeclared column '${col}'`,
      );
    for (const c of r.scopeCols ?? [])
      assert.ok(
        r.columns[c],
        `${name}: scopeCol '${c}' is not declared in columns`,
      );
  }
});

test("every column descriptor declares a type", () => {
  // `type` picks the filter/predicate shape; a descriptor without one silently falls
  // through the builder's switch and the filter becomes a no-op.
  for (const [name, r] of Object.entries(REGISTRY))
    for (const [id, d] of Object.entries(r.columns))
      assert.ok(
        typeof d === "object" && d !== null && typeof d.type === "string",
        `${name}.${id}: column descriptor must declare a type`,
      );
});

test("the pagination tiebreak column is part of the projection", () => {
  // buildOrder appends `key` (or select[0]) as the deterministic tiebreak, so it has to
  // be selected — otherwise paging can repeat or skip a row at a page boundary.
  for (const [name, r] of Object.entries(REGISTRY)) {
    const tie = r.columns.key ? "key" : r.select[0];
    assert.ok(
      r.select.includes(tie),
      `${name}: pagination tiebreak '${tie}' is not in select`,
    );
  }
});

test("aggregate columns are declared and numeric", () => {
  for (const [name, r] of Object.entries(REGISTRY)) {
    for (const a of r.aggregates ?? []) {
      if (!a.col) continue; // bare count()
      assert.ok(
        r.columns[a.col],
        `${name}: aggregate over undeclared column '${a.col}'`,
      );
    }
  }
});

test("no resource carries unknown top-level registry keys", () => {
  // Guards against inert config that reads as a supported feature — `facets: [...]`
  // looked declarative but runDbFacets builds from req.columns and never read it.
  const KNOWN = new Set([
    "base",
    "scopeCols",
    "defaultScope",
    "columns",
    "select",
    "defaultSort",
    "aggregates",
    "maxPageSize",
  ]);
  for (const [name, r] of Object.entries(REGISTRY))
    for (const k of Object.keys(r))
      assert.ok(KNOWN.has(k), `${name}: unknown registry key '${k}'`);
});

test("defaultScope, where declared, names a real scope column", () => {
  for (const [name, r] of Object.entries(REGISTRY)) {
    if (!r.defaultScope) continue;
    assert.ok(
      r.defaultScope.col && typeof r.defaultScope.val === "string",
      `${name}: defaultScope must be { col, val }`,
    );
    assert.ok(
      r.scopeCols.includes(r.defaultScope.col),
      `${name}: defaultScope column '${r.defaultScope.col}' is not in scopeCols — ` +
        `buildWhere would throw on every unscoped request`,
    );
  }
});

// Fan-out resources — those whose base emits one row per (entity, scope value) — MUST
// declare a defaultScope, because an unscoped query over them returns the union of every
// bucket: each entity counted once per bucket, count aggregate and facets inflated to
// match, and no error. Listed explicitly rather than inferred: nothing in the registry
// distinguishes a fan-out base from a normal one, and a new fan-out resource shipping
// without a default is precisely the regression this pins.
test("every fan-out resource declares a defaultScope", () => {
  const FAN_OUT = ["mp_assets_rankings", "mp_cars"];
  for (const name of FAN_OUT) {
    assert.ok(REGISTRY[name], `${name} is no longer a registry resource`);
    assert.ok(
      REGISTRY[name].defaultScope,
      `${name} fans out on ${REGISTRY[name].scopeCols.join("/")} but has no ` +
        `defaultScope — an unscoped query would silently double-count`,
    );
  }
});

test("buildWhere applies defaultScope when the caller sends none", () => {
  const { whereSql, params } = buildWhere(REGISTRY.mp_cars, {});
  assert.match(whereSql, /ns = \$1/);
  assert.deepEqual(params, ["all"]);

  // An explicit scope still wins over the default.
  const explicit = buildWhere(REGISTRY.mp_cars, {
    scope: { col: "ns", val: "52" },
  });
  assert.deepEqual(explicit.params, ["52"]);
});

// ── runDbFacets: filter-scoped facets (the `filters` merge) ──────────────────
// The contracts table now issues facets that apply the active filters (minus the
// facet's own dimension) so the mix bar / dropdowns reflect the current scope.
// runDbFacets must merge req.filters with req.fixedFilters into the WHERE, and
// omitting req.filters must reproduce the pre-change (fixedFilters-only) behavior.

test("runDbFacets merges req.filters with fixedFilters into the WHERE", async () => {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    return [];
  };
  await runDbFacets(q, {
    resource: "contracts",
    scope: { col: "contractor_eik", val: "X" },
    fixedFilters: [{ id: "tag", value: ["contract"] }],
    filters: [{ id: "date", min: "2024-01-01", max: "2024-12-31" }],
    columns: ["procurement_method"],
    limit: 100,
  });
  assert.equal(calls.length, 1, "one query per requested facet column");
  const { sql, params } = calls[0];
  assert.ok(sql.includes("procurement_method"), "groups by the facet column");
  assert.ok(params.includes("X"), "scope value present");
  assert.ok(params.includes("contract"), "fixedFilter (tag) present");
  assert.ok(
    params.includes("2024-01-01") && params.includes("2024-12-31"),
    "user filter (date range) merged into the WHERE",
  );
});

test("runDbFacets without req.filters keeps the fixedFilters-only behavior", async () => {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    return [];
  };
  await runDbFacets(q, {
    resource: "contracts",
    scope: { col: "contractor_eik", val: "X" },
    fixedFilters: [{ id: "tag", value: ["contract"] }],
    columns: ["procurement_method"],
    limit: 100,
  });
  const { params } = calls[0];
  assert.ok(params.includes("X") && params.includes("contract"));
  assert.ok(
    !params.includes("2024-01-01"),
    "no user filter applied when req.filters is omitted",
  );
});

// buildAggSelect (persons-pg-retirement-v1 T2.2): a column-scoped `count` is a NON-NULL
// count, distinct from the always-present count(*); sum still requires agg:"sum". These lock
// the backward-compat contract so the /mp-cars summary (count / count(value_eur) /
// sum(value_eur)) can't silently regress.
test("buildAggSelect: bare count is count(*); column count is a non-null count", () => {
  const r = {
    base: "t",
    columns: { value_eur: { type: "number", agg: "sum" } },
    aggregates: [
      { fn: "count" },
      { fn: "count", col: "value_eur" },
      { fn: "sum", col: "value_eur" },
    ],
  };
  const sql = buildAggSelect(r);
  assert.match(sql, /count\(\*\)::bigint AS _count/);
  assert.match(sql, /count\(value_eur\)::bigint AS "countValueEur"/);
  assert.match(sql, /coalesce\(sum\(value_eur\),0\) AS "sumValueEur"/);
});

test("buildAggSelect: sum without agg:'sum', or a count over an unknown column, emit nothing extra", () => {
  const noAggFlag = buildAggSelect({
    base: "t",
    columns: { x: { type: "number" } },
    aggregates: [{ fn: "count" }, { fn: "sum", col: "x" }],
  });
  assert.equal(noAggFlag, "count(*)::bigint AS _count", "sum needs agg:'sum'");

  const unknownCol = buildAggSelect({
    base: "t",
    columns: {},
    aggregates: [{ fn: "count" }, { fn: "count", col: "nope" }],
  });
  assert.equal(
    unknownCol,
    "count(*)::bigint AS _count",
    "a count over a column absent from the registry is dropped",
  );
});
