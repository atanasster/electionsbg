// Pure unit tests for the db_table WHERE builder — specifically the free-text
// `global` search arm and its `globalCols` allowlist (no DB needed; buildWhere
// only emits SQL text + params).
// Run: cd functions && npm test   (Node 22 built-in runner, zero deps)

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildWhere, REGISTRY } = require("./db_table.js");

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
