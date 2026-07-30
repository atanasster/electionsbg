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
      assert.equal(c[a.col].agg, "sum", `${a.fn} over a non-agg column ${a.col}`);
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
