// Pure unit tests for the db_table WHERE builder — specifically the free-text
// `global` search arm and its `globalCols` allowlist (no DB needed; buildWhere
// only emits SQL text + params).
// Run: cd functions && npm test   (Node 22 built-in runner, zero deps)

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildWhere,
  REGISTRY,
  runDbTable,
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

test("persons declares no sum aggregate over public_money_eur", () => {
  // The money on a /persons row is what the person's COMPANIES won, and two co-officers
  // of one company each carry that company's full sum. A column total is therefore
  // double-counted — large, plausible and wrong, with nothing to flag it. The matview
  // header (120_person_browse.sql) and person_browse.data.test.ts carry the same warning
  // from the data side; this is the one that fails if someone adds `agg: "sum"` here.
  const r = REGISTRY.persons;
  assert.ok(r, "the persons resource has gone missing");
  for (const a of r.aggregates ?? [])
    assert.notEqual(
      a.col,
      "public_money_eur",
      "persons aggregates public_money_eur — co-officers of one company each carry its full sum, so the total double-counts",
    );
  assert.ok(
    !r.columns.public_money_eur.agg,
    "public_money_eur declares an `agg` — same double-counting problem",
  );
});

test("persons filters the padded code sets, never the display scalar", () => {
  // oblast_code is the REPRESENTATIVE seat; oblast_codes is every oblast the person holds
  // a role in. Filtering the scalar drops 1,851 people from an oblast they genuinely
  // serve, which renders as "no such people" rather than as a narrowed view.
  const c = REGISTRY.persons.columns;
  assert.ok(!c.oblast_code.filter, "oblast_code must stay display-only");
  assert.equal(c.oblast_codes.filter, "text");
  for (const set of [
    "role_codes",
    "facet_codes",
    "party_codes",
    "oblast_codes",
  ])
    assert.equal(c[set].filter, "text", `${set} must be a text (ILIKE) filter`);
});

test("persons searches the name FOLD, with the term folded too", () => {
  // searchCol without searchFold matches a Cyrillic query against transliterated Latin
  // text and returns nothing, forever — while looking like a working query.
  const n = REGISTRY.persons.columns.name;
  assert.equal(n.searchCol, "name_fold");
  assert.equal(
    n.searchFold,
    true,
    "name targets name_fold without folding the search term — every Cyrillic search returns 0 rows",
  );
});

test("facet:true is only used where the column is NOT filterable", () => {
  // A filterable column is facetable already, so `facet: true` beside a `filter` is inert
  // config that reads as a supported feature — the exact class of bug the unknown-keys test
  // below exists for. The flag is only meaningful on a column deliberately kept
  // unfilterable (persons.oblast_code).
  for (const [name, r] of Object.entries(REGISTRY))
    for (const [col, d] of Object.entries(r.columns))
      if (d.facet)
        assert.ok(
          !d.filter,
          `${name}.${col} declares both filter and facet:true — the facet flag does nothing there`,
        );
});

test("runDbFacets groups a facet:true column that has no filter", async () => {
  // The regression this guards: runDbFacets used to require `filter`, so a facet-only
  // column returned NO bucket at all — the dropdown it feeds silently rendered empty and
  // the control vanished, with no error anywhere.
  const seen = [];
  const q = async (sql) => {
    seen.push(sql);
    return [];
  };
  await runDbFacets(q, { resource: "persons", columns: ["oblast_code"] });
  assert.equal(seen.length, 1, "facet:true column was skipped");
  assert.match(seen[0], /GROUP BY oblast_code/);
});

test("runDbFacets still refuses a column that is neither filterable nor facetable", async () => {
  const seen = [];
  const q = async (sql) => {
    seen.push(sql);
    return [];
  };
  await runDbFacets(q, { resource: "persons", columns: ["photo_url"] });
  assert.equal(seen.length, 0, "a non-facetable column was grouped anyway");
});

test("no resource carries unknown top-level registry keys", () => {
  // Guards against inert config that reads as a supported feature — `facets: [...]`
  // looked declarative but runDbFacets builds from req.columns and never read it.
  const KNOWN = new Set([
    "base",
    "aggBase",
    "scopeCols",
    "defaultScope",
    "defaultFilters",
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
  const FAN_OUT = [
    "mp_assets_rankings",
    "mp_cars",
    "procurement_settlements",
    "contractor_rankings",
  ];
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

// defaultFilters is the SECOND-margin analogue of defaultScope: contractor_rankings
// fans out on (scope_key × division), each with a rollup bucket, but defaultScope
// covers only scope_key. Without a default on `division`, an unscoped query unions the
// 'ALL' rollup row with every per-division row per contractor → a ~2× leaderboard.
test("every declared defaultFilter names a filterable column", () => {
  for (const [name, r] of Object.entries(REGISTRY)) {
    for (const df of r.defaultFilters ?? []) {
      assert.ok(
        df.col && "val" in df,
        `${name}: defaultFilter must be { col, val }`,
      );
      assert.ok(
        r.columns[df.col] && r.columns[df.col].filter,
        `${name}: defaultFilter column '${df.col}' is not a filterable column — ` +
          `buildWhere would throw on every request that omits it`,
      );
    }
  }
});

test("buildWhere defaults the division margin when the caller omits it", () => {
  // The regression that pins the [FINDING-001] double-count fix: a scope-only request
  // must still constrain division to the 'ALL' rollup.
  const { whereSql, params } = buildWhere(REGISTRY.contractor_rankings, {
    scope: { col: "scope_key", val: "all" },
  });
  assert.match(whereSql, /scope_key = \$\d/);
  assert.match(
    whereSql,
    /division = \$\d/,
    "division margin not defaulted — the leaderboard double-counts",
  );
  assert.ok(params.includes("ALL"));

  // An explicit division still wins — the default is only applied when absent.
  const explicit = buildWhere(REGISTRY.contractor_rankings, {
    scope: { col: "scope_key", val: "all" },
    filters: { columns: [{ id: "division", value: "45" }] },
  });
  assert.ok(explicit.params.includes("45"));
  assert.ok(
    !explicit.params.includes("ALL"),
    "explicit division should suppress the 'ALL' default",
  );
});

test("a facet on a defaulted column suppresses that column's defaultFilter", () => {
  // runDbFacets passes skipDefaultFilterCols = the faceted columns, so a `division`
  // facet enumerates all divisions instead of being pinned to the 'ALL' default.
  const withSkip = buildWhere(
    REGISTRY.contractor_rankings,
    { scope: { col: "scope_key", val: "all" } },
    { skipDefaultFilterCols: new Set(["division"]) },
  );
  assert.doesNotMatch(
    withSkip.whereSql,
    /division = \$\d/,
    "division default not suppressed — the facet would return only the 'ALL' bucket",
  );
  // A facet on a DIFFERENT column still gets the division default (double-count-safe).
  const other = buildWhere(
    REGISTRY.contractor_rankings,
    { scope: { col: "scope_key", val: "all" } },
    { skipDefaultFilterCols: new Set(["is_mp_tied"]) },
  );
  assert.match(other.whereSql, /division = \$\d/);
});

test("contractor_rankings searches the name FOLD, with the term folded", () => {
  const n = REGISTRY.contractor_rankings.columns.name;
  assert.equal(n.searchCol, "name_fold");
  assert.equal(n.searchFold, true);
  const { whereSql } = buildWhere(REGISTRY.contractor_rankings, {
    scope: { col: "scope_key", val: "all" },
    filters: { global: "sofarma" },
  });
  assert.match(whereSql, /name_fold ILIKE '%' \|\| translit_bg_latin/);
});

test("contractor_rankings sum/max aggregate only the agg-marked total_eur", () => {
  const c = REGISTRY.contractor_rankings.columns;
  assert.equal(c.total_eur.agg, "sum");
  for (const a of REGISTRY.contractor_rankings.aggregates)
    if (a.col)
      assert.equal(
        c[a.col].agg,
        "sum",
        `${a.fn} over a non-agg column ${a.col}`,
      );
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

test("runDbFacets suppresses a defaulted column's default ONLY in its own facet", async () => {
  // Co-request the defaulted `division` and another column together. The division
  // facet must enumerate all divisions (its default suppressed), while the is_mp_tied
  // facet must KEEP division='ALL' — otherwise it unions the rollup with every
  // per-division row and double-counts. This is why the WHERE is built per-facet.
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    return [];
  };
  await runDbFacets(q, {
    resource: "contractor_rankings",
    scope: { col: "scope_key", val: "all" },
    columns: ["division", "is_mp_tied"],
    limit: 50,
  });
  assert.equal(calls.length, 2, "one query per requested facet column");
  const divisionCall = calls.find((c) => / division AS value/.test(c.sql));
  const mpCall = calls.find((c) => /is_mp_tied AS value/.test(c.sql));
  assert.ok(divisionCall && mpCall, "both facet queries present");
  assert.ok(
    !/division = \$/.test(divisionCall.sql),
    "division facet still pinned to its own 'ALL' default — would return one bucket",
  );
  assert.ok(
    /division = \$/.test(mpCall.sql) && mpCall.params.includes("ALL"),
    "is_mp_tied facet lost the division default — buckets double-count",
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

// ── procurement_settlements (the by-settlement ranking) ─────────────────────────────────
// Registered in the same commit that moved /procurement/by-settlement off a 196 KB static
// blob. Every assertion below guards a SILENT failure: the wrong scope unions ~30 time
// windows into one ranking, a missing tiebreak shuffles rows between pages, and a raw
// ILIKE search would seq-scan every scope instead of using the trigram index.

const settlements = REGISTRY.procurement_settlements;

test("procurement_settlements is scoped by scope_key", () => {
  // Without this the resource would union every pscope window — ~30 copies of each
  // settlement summed into a ranking that matches no period on the page.
  assert.deepEqual(settlements.scopeCols, ["scope_key"]);
});

test("procurement_settlements searches the transliterated fold, not the raw name", () => {
  const { whereSql } = buildWhere(settlements, {
    filters: { global: "veliko tarnovo" },
  });
  // The fold is what makes Latin input match Cyrillic names AND what the gin_trgm index
  // is built on; searching `name` directly would be both wrong and a seq scan.
  assert.ok(whereSql.includes("name_fold"), "fold arm present");
  assert.ok(
    whereSql.includes("translit_bg_latin"),
    "query is folded with the same function as the column",
  );
  assert.ok(!whereSql.includes("name ILIKE"), "raw name is not searched");
});

test("procurement_settlements sorts by value with an ekatte tiebreak", () => {
  // total_eur alone is not a total order — settlements share values — so pagination would
  // drop or repeat rows without the second key.
  assert.deepEqual(settlements.defaultSort, [
    ["total_eur", "desc"],
    ["ekatte", "asc"],
  ]);
});

test("procurement_settlements exposes count, sum and max of total_eur", () => {
  // max backs the in-cell magnitude bar: its denominator is the largest value in the
  // CURRENT filtered set, which is a property of the whole result rather than of the page.
  const sql = buildAggSelect(settlements);
  assert.ok(
    sql.includes('count(*)::bigint AS "_count"') ||
      sql.includes("count(*)::bigint"),
  );
  assert.ok(sql.includes("sum(total_eur)"), "sum arm present");
  assert.ok(
    sql.includes('coalesce(max(total_eur),0) AS "maxTotalEur"'),
    "max arm present and coalesced — an empty filtered set must size the bar as 0, not NaN",
  );
});

test("the max aggregate is gated exactly like sum", () => {
  // A caller must not be able to aggregate an arbitrary column…
  const rogue = {
    columns: { ekatte: { type: "text" } },
    aggregates: [{ fn: "max", col: "ekatte" }],
  };
  assert.ok(
    !buildAggSelect(rogue).includes("max(ekatte)"),
    "max on an un-marked column must be dropped",
  );
  // …and a truthy-but-wrong `agg` marker must not slip a text column through, whose max
  // the client would read via Number() as NaN.
  const mislabelled = {
    columns: { province: { type: "text", agg: "count" } },
    aggregates: [{ fn: "max", col: "province" }],
  };
  assert.ok(
    !buildAggSelect(mislabelled).includes("max(province)"),
    "max must require agg === 'sum', not merely a truthy agg",
  );
});

test("procurement_settlements projects the English name without sorting on it", () => {
  // The ranking is one row per place; re-ordering it by transliteration would reshuffle
  // the table for an English reader with no explanation.
  assert.ok(settlements.select.includes("name_en"), "name_en is projected");
  assert.ok(!settlements.columns.name_en.sort, "name_en is not sortable");
});

// --- awarder_ekatte: the settlement semi-join (procurement-settlement-browser-v1 §2.1) ---

test("semijoin emits a parameterized subquery against the REAL column", () => {
  const { whereSql, params } = buildWhere(contracts, {
    filters: { columns: [{ id: "awarder_ekatte", value: "68134" }] },
  });
  // The virtual column's name never reaches the SQL — awarder_eik does.
  assert.ok(
    !whereSql.includes("awarder_ekatte"),
    "the virtual column name must not appear in SQL",
  );
  assert.ok(
    whereSql.includes("awarder_eik IN (SELECT eik FROM awarder_seats"),
    "constrains the real column via the registry subquery",
  );
  // is_local_hq keeps national buyers out, matching procurement_by_settlement().
  assert.ok(whereSql.includes("is_local_hq"), "local-tier predicate preserved");
  // The value is BOUND, never interpolated.
  assert.ok(whereSql.includes("ekatte = $1"), "placeholder, not a literal");
  assert.deepEqual(params, ["68134"]);
});

test("semijoin binds a hostile value rather than interpolating it", () => {
  const { whereSql, params } = buildWhere(contracts, {
    filters: {
      columns: [
        { id: "awarder_ekatte", value: "68134'; DROP TABLE contracts--" },
      ],
    },
  });
  assert.ok(!whereSql.includes("DROP TABLE"), "no client text reaches the SQL");
  assert.deepEqual(params, ["68134'; DROP TABLE contracts--"]);
});

test("a required semijoin THROWS on an absent value rather than serving the corpus", () => {
  // The whole point of `required`: dropping this clause does not narrow anything,
  // it widens to every contract in the country — served at a 200, with an exact
  // count, under one settlement's heading. Fail closed instead.
  for (const value of ["", null, undefined]) {
    assert.throws(
      () =>
        buildWhere(contracts, {
          filters: { columns: [{ id: "awarder_ekatte", value }] },
        }),
      /required filter received no value/,
      `value ${JSON.stringify(value)} must be refused`,
    );
  }
});

test("a semijoin refuses a non-scalar value instead of matching nothing", () => {
  // node-postgres would bind an array as '{68134,56784}', which equals no ekatte —
  // rendering "0 contracts" for a settlement that has thousands.
  assert.throws(
    () =>
      buildWhere(contracts, {
        filters: {
          columns: [{ id: "awarder_ekatte", value: ["68134", "56784"] }],
        },
      }),
    /expects a scalar value/,
  );
});

test("the semijoin composes with the scope window and tag, all bound", () => {
  // The shape the settlement page actually sends: tag + pscope window + the place.
  //
  // The upper bound is the day BEFORE the next election (2026-04-18, not -19).
  // src/data/scope/scopeRange.ts is explicit that the DB endpoints filter
  // `date <= to` inclusively, so an ns window must stop a day short to stay
  // half-open — a contract dated on election day belongs to the NEXT parliament.
  // Pinned here because a browser that used the election date itself would show
  // rows the by-settlement KPI excludes, and the two would reconcile nowhere.
  const { whereSql, params } = buildWhere(contracts, {
    filters: {
      columns: [
        { id: "tag", value: ["contract"] },
        { id: "date", min: "2023-04-02", max: "2026-04-18" },
        { id: "awarder_ekatte", value: "68134" },
      ],
    },
  });
  assert.ok(whereSql.includes("date >= $"), "window lower bound is sargable");
  assert.ok(whereSql.includes("date <= $"), "window upper bound is sargable");
  assert.ok(whereSql.includes("awarder_seats"), "semi-join present");
  assert.deepEqual(params, ["contract", "2023-04-02", "2026-04-18", "68134"]);
});

test("awarder_ekatte is filter-only — not projected, sorted, searched or view-bound", () => {
  const def = contracts.columns.awarder_ekatte;
  // It names no real column, so projecting or sorting it would be a 42703.
  assert.ok(!contracts.select.includes("awarder_ekatte"), "not projected");
  assert.ok(!def.sort, "not sortable");
  assert.ok(!def.search, "not searchable");
  // NOT viewOnly: the semi-join constrains a BASE column, so aggregates must stay
  // on aggBase (`contracts`) and keep the migration-113 covering indexes.
  assert.ok(!def.viewOnly, "must not force the aggregate onto the view");
});

test("a semijoin column is refused as a facet", () => {
  // GROUP BY on a virtual column is an undefined-column error, not a vocabulary.
  const calls = [];
  const dbRows = async (sql, params) => {
    calls.push({ sql, params });
    return [];
  };
  return runDbFacets(dbRows, {
    resource: "contracts",
    columns: ["awarder_ekatte"],
    filters: [],
  }).then((out) => {
    assert.deepEqual(out.facets, {}, "no facet is produced");
    assert.equal(calls.length, 0, "and no query is issued");
  });
});

test("the semijoin keeps count+sum on the base table, not the view", async () => {
  // The registry comment stakes a MEASURED claim (count+sum 54ms) that holds only
  // while aggBaseFor returns `contracts`. Aggregating over contracts_list instead
  // would drop to the seq-scan path the aggBase comment describes, with every other
  // test still green.
  const sqls = [];
  const q = async (sql) => {
    sqls.push(sql);
    return [{ _count: "0" }];
  };
  await runDbTable(q, {
    resource: "contracts",
    filters: { columns: [{ id: "awarder_ekatte", value: "68134" }] },
  });
  const agg = sqls.find((s) => s.includes("count(*)::bigint"));
  assert.ok(agg, "an aggregate query ran");
  assert.match(agg, /FROM contracts /, "aggregate stayed on aggBase");
  assert.ok(
    agg.includes("awarder_seats"),
    "and the semi-join reached the aggregate WHERE",
  );
});

test("a semijoin fixedFilter scopes every facet without becoming one", async () => {
  // The shape the settlement page sends: the place as a fixedFilter, real columns
  // as the facets. Neither the table nor the facet tests above cover this path.
  const sqls = [];
  const q = async (sql) => {
    sqls.push(sql);
    return [];
  };
  await runDbFacets(q, {
    resource: "contracts",
    columns: ["procurement_method", "cpv"],
    fixedFilters: [
      { id: "tag", value: ["contract"] },
      { id: "awarder_ekatte", value: "68134" },
    ],
  });
  assert.equal(sqls.length, 2, "both real facets ran");
  for (const s of sqls) {
    assert.ok(
      s.includes("awarder_eik IN (SELECT eik FROM awarder_seats"),
      "facet is place-scoped",
    );
    assert.ok(
      !s.includes("awarder_ekatte"),
      "the virtual name never reaches SQL",
    );
    assert.match(s, /FROM contracts /, "facets stayed on aggBase");
  }
});

test("every semijoin column in the registry is well-formed", () => {
  // These descriptor keys are the first column-level registry keys with structural
  // requirements, and every way of getting them wrong is a request-time 500 or a
  // 42703 rather than a startup failure. Check them statically instead.
  let checked = 0;
  for (const [name, r] of Object.entries(REGISTRY))
    for (const [id, d] of Object.entries(r.columns)) {
      if (d.filter !== "semijoin") continue;
      checked++;
      assert.equal(
        typeof d.semiJoinSql,
        "string",
        `${name}.${id}: no semiJoinSql (a misspelled key is a 500 at request time)`,
      );
      assert.equal(
        d.semiJoinSql.split("?").length,
        2,
        `${name}.${id}: template needs exactly one ? placeholder`,
      );
      assert.ok(
        r.columns[d.semiJoinCol],
        `${name}.${id}: semiJoinCol '${d.semiJoinCol}' is not a declared column`,
      );
      // A viewOnly target would 42703 on the aggregate query alone: physicalColId
      // now resolves through semiJoinCol, so aggBaseFor WOULD see it — this keeps
      // that guarantee from regressing if the resolution is ever reverted.
      assert.ok(
        !r.columns[d.semiJoinCol].viewOnly,
        `${name}.${id}: semiJoinCol '${d.semiJoinCol}' is viewOnly — the aggregate would 42703`,
      );
      // Virtual: it names no real column, so it must stay out of the projection,
      // the sort whitelist and the global search.
      assert.ok(
        !(r.select ?? []).includes(id),
        `${name}.${id}: virtual column must not be projected`,
      );
      assert.ok(
        !d.sort && !d.search,
        `${name}.${id}: virtual column must not be sortable or searchable`,
      );
    }
  assert.ok(
    checked > 0,
    "the invariant actually ran against a semijoin column",
  );
});

test("a malformed semijoin template is refused", () => {
  // The only coverage the parts.length !== 2 branch has.
  const bad = {
    columns: {
      x: {
        type: "text",
        filter: "semijoin",
        semiJoinCol: "y",
        semiJoinSql: "SELECT y FROM t WHERE a = ? AND b = ?",
      },
    },
    scopeCols: [],
    select: ["y"],
  };
  assert.throws(
    () => buildWhere(bad, { filters: { columns: [{ id: "x", value: "1" }] } }),
    /exactly one placeholder/,
  );
});

// ── isdistinct filter mode (person contracts browser, migration 125) ──────────────────────
// The mode exists for NULL-safety: excluding €0 consortium-MEMBER rows must KEEP the ~99% of
// contracts whose consortium_role is NULL, which `!=` would drop. `not_consortium_member`
// remaps the physical `consortium_role` column via `col`.
test("isdistinct emits a NULL-safe parameterized inequality (member exclusion)", () => {
  const { whereSql, params } = buildWhere(contracts, {
    filters: { columns: [{ id: "not_consortium_member", value: "member" }] },
  });
  assert.match(whereSql, /consortium_role IS DISTINCT FROM \$\d+/);
  assert.deepEqual(params, ["member"]);
});

test("isdistinct with an empty value drops the predicate (never IS DISTINCT FROM NULL)", () => {
  for (const value of [null, undefined, ""]) {
    const { whereSql, params } = buildWhere(contracts, {
      filters: { columns: [{ id: "not_consortium_member", value }] },
    });
    assert.ok(
      !/IS DISTINCT FROM/.test(whereSql),
      `empty value ${JSON.stringify(value)} must emit no predicate`,
    );
    assert.deepEqual(params, []);
  }
});
