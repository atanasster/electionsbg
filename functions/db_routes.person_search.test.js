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

// ?decl — the /governance/declarations hub's two groups.
//
// It is a RANKING device, not a filter: the hub asks for decl=1 and decl=0 as two calls and
// shows the declared group first. A single filtered call would mean a reader searching for a
// minister who has not filed is told they do not exist.
// The PREDICATE, not the word: has_declaration is now in the returned column list too, so
// a bare `includes("has_declaration")` matches every query and asserts nothing.
const hasDeclPredicate = (sql) => /AND (NOT )?has_declaration/.test(sql);

test("person-search: ?decl is absent by default — the combined box is unrestricted", async () => {
  const seen = [];
  const fn = async (sql) => {
    seen.push(sql);
    return [];
  };
  await route(fn, { q: "иван" });
  assert.ok(
    !seen.some(hasDeclPredicate),
    "no decl predicate should appear without the param",
  );
});

test("person-search: ?decl=1 restricts to filers, ?decl=0 to the rest", async () => {
  for (const [decl, needle] of [
    ["1", "AND has_declaration"],
    ["0", "AND NOT has_declaration"],
  ]) {
    const seen = [];
    const fn = async (sql) => {
      seen.push(sql);
      return [];
    };
    await route(fn, { q: "иван", decl });
    const probes = seen.filter((s) => s.includes("person_search"));
    assert.ok(probes.length > 0, "expected person_search probes");
    assert.ok(
      probes.every((s) => s.includes(needle)),
      `decl=${decl} should put "${needle}" on every probe`,
    );
  }
});

test("person-search: an unrecognised ?decl restricts nothing", async () => {
  // The param is read from a URL. "yes", "true" and "" must not silently become a filter —
  // an unrecognised value that filtered would hide people with no way to tell.
  for (const decl of ["yes", "true", "", "2", "01"]) {
    const seen = [];
    const fn = async (sql) => {
      seen.push(sql);
      return [];
    };
    await route(fn, { q: "иван", decl });
    assert.ok(
      !seen.some(hasDeclPredicate),
      `decl=${JSON.stringify(decl)} must not restrict`,
    );
  }
});

test("person-search: has_declaration is returned so the UI can label a row", async () => {
  const fn = async (sql) =>
    sql.includes("person_search")
      ? [{ key: "k", name: "n", tier: "P", firms_count: 0, href: "/p/k", has_declaration: true }]
      : [];
  const res = await route(fn, { q: "иван" });
  assert.equal(res.body.power[0].has_declaration, true);
});
