// Route-level unit tests for the "person-search" handler (plan S1). The SQL behind it is covered
// by scripts/db/tests/person_search.data.test.ts; this pins the pure-JS layer the data test
// cannot see: the per-tier exact-float/dedup merge, the cross-tier `people` back-compat shape, and
// the missing-table degrade (no 500 on a first cloud deploy).
//
// No DB: the handler is (dbRows, query) => Promise<{ body }>, so a mock `dbRows` that dispatches on
// the tier param + exact/fuzzy SQL shape exercises every branch. Run: cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES } = require("./db_routes.js");
const route = DB_ROUTES["person-search"];

// Dispatch canned rows by `${tier}:${exact|fuzzy}`. exactQ uses `name_fold = translit_bg_latin`,
// fuzzyQ uses `name_fold %> translit_bg_latin`; both bind the tier as $1.
function db(byKey) {
  return (sql, params) => {
    const tier = params[0];
    const kind = sql.includes("name_fold = translit_bg_latin") ? "exact" : "fuzzy";
    return Promise.resolve(byKey(`${tier}:${kind}`) || []);
  };
}

test("person-search: missing q → 400", async () => {
  const res = await route(() => Promise.resolve([]), {});
  assert.equal(res.status, 400);
});

test("person-search: floats an exact V owner ahead of higher-ranked fuzzy V", async () => {
  const exactV = { key: "fold:exactV", name: "Exact V", tier: "V", firms_count: 2 };
  const fuzzyV = [
    { key: "fold:fz1", name: "Fz1", tier: "V", firms_count: 9 },
    { key: "fold:fz2", name: "Fz2", tier: "V", firms_count: 8 },
  ];
  const fn = db((k) => (k === "V:exact" ? [exactV] : k === "V:fuzzy" ? fuzzyV : []));
  const res = await route(fn, { q: "иван" });
  // FINDING-003: a single cross-tier exact query would be starved by P; per-tier exact fixes it.
  assert.equal(res.body.money[0].key, "fold:exactV");
});

test("person-search: dedups an exact hit that fuzzy also returns", async () => {
  const row = { key: "fold:dup", name: "Dup", tier: "V", firms_count: 1 };
  const fn = db((k) => (k === "V:exact" ? [row] : k === "V:fuzzy" ? [row] : []));
  const res = await route(fn, { q: "x" });
  assert.equal(res.body.money.filter((r) => r.key === "fold:dup").length, 1);
});

test("person-search: people back-compat spans all tiers (no public-figure dropout)", async () => {
  const fn = db((k) => {
    if (k === "P:fuzzy") return [{ key: "slug:mp", name: "MP", tier: "P", firms_count: 0 }];
    if (k === "V:fuzzy") return [{ key: "fold:v", name: "Vowner", tier: "V", firms_count: 3 }];
    if (k === "N:fuzzy") return [{ key: "fold:n", name: "Nowner", tier: "N", firms_count: 1 }];
    return [];
  });
  const res = await route(fn, { q: "test" });
  const names = res.body.people.map((p) => p.name);
  assert.ok(
    names.includes("MP") && names.includes("Vowner") && names.includes("Nowner"),
    `people must span all tiers, got ${JSON.stringify(names)}`,
  );
  assert.deepEqual(res.body.people[0], { name: "MP", companies: 0 });
});

test("person-search: missing table degrades to empty tiers, not a 500", async () => {
  // FINDING-001: first cloud deploy, before db:load:person-search:pg:cloud has run.
  const fn = () => Promise.reject({ code: "42P01" });
  const res = await route(fn, { q: "иван" });
  // altQuery is null here for two independent reasons, and both matter: „иван" carries no
  // shliokavitsa trigger so the rewrite is never asked for, and a database missing the
  // table is also one missing migration 141.
  assert.deepEqual(res.body, {
    power: [],
    money: [],
    others: [],
    people: [],
    altQuery: null,
  });
});
