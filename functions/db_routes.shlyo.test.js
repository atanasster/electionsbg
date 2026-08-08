// The shliokavitsa second needle, at the route level.
//
//   npm run functions:test
//
// The fold itself is gated elsewhere — scripts/db/tests/shlyo_fold_parity.data.test.ts proves
// the TS and SQL implementations agree. What ONLY a route test can establish is the wiring
// around it, and the property that matters most is the one that is invisible when it breaks:
//
//   ON A DATABASE WITHOUT MIGRATION 141, SEARCH MUST BEHAVE EXACTLY AS IT DID BEFORE.
//
// That is why the rewrite is a separate query rather than an `OR` inside each existing one.
// Inlined, a missing shlyo_query_fold raises 42883 for the WHOLE statement and the route
// returns nothing at all — turning "search is slightly worse on a stale database" into
// "search is broken on one". No row count anywhere would report it.

const test = require("node:test");
const assert = require("node:assert/strict");
const { DB_ROUTES } = require("./db_routes.js");

/** A dbRows stub that records every statement and answers from `plan`.
 *  `plan` is [predicate, rows] pairs, first match wins; unmatched → []. */
const stubDb = (plan) => {
  const calls = [];
  const dbRows = async (sql, params = []) => {
    calls.push({ sql, params });
    for (const [match, rows] of plan) {
      if (typeof match === "function" ? match(sql, params) : sql.includes(match))
        return typeof rows === "function" ? rows(sql, params) : rows;
    }
    return [];
  };
  return { dbRows, calls };
};

const isAltQuery = (sql) => sql.includes("shlyo_query_fold");
const person = (r) => ({
  key: r,
  name: r,
  tier: "P",
  firms_count: 0,
  href: `/person/${r}`,
});

test("a trigger-free query issues NO extra statement at all", async () => {
  // Two gates in series, and this asserts the outer one: the raw query carries no
  // shliokavitsa character, so the route does not even ASK Postgres for a rewrite.
  // 3 tiers x (exact + fuzzy) = 6 statements, exactly as before this change.
  const { dbRows, calls } = stubDb([["person_search", [person("Ivanov")]]]);
  const res = await DB_ROUTES["person-search"](dbRows, { q: "Ivanov" });
  assert.equal(calls.filter((c) => isAltQuery(c.sql)).length, 0);
  assert.equal(calls.length, 6, `expected 6 statements, got ${calls.length}`);
  assert.ok(res.body.power.length > 0);
});

test("a trigger-bearing query whose fold is unchanged issues no SECOND batch", async () => {
  // The inner gate: NULLIF returns null when the rewrite is a no-op, and then the six
  // expensive probes do not run again. 6 + the one alternate probe = 7.
  const { dbRows, calls } = stubDb([
    [isAltQuery, [{ alt: null }]],
    ["person_search", [person("Ivanov")]],
  ]);
  await DB_ROUTES["person-search"](dbRows, { q: "6umen" });
  assert.equal(calls.filter((c) => isAltQuery(c.sql)).length, 1);
  assert.equal(calls.length, 7, `expected 7 statements, got ${calls.length}`);
});

test("a rewrite ADDS rows and never removes or reorders the plain ones", async () => {
  const plain = [person("A"), person("B")];
  const rewritten = [person("B"), person("C")];
  const { dbRows } = stubDb([
    [isAltQuery, [{ alt: "zhelyazkov" }]],
    // The fuzzy probe answers differently depending on which needle it was given.
    [
      (sql, p) => sql.includes("%>") && p[1] === "6umen",
      [{ ...plain[0] }, { ...plain[1] }],
    ],
    [
      (sql, p) => sql.includes("%>") && p[1] === "zhelyazkov",
      [{ ...rewritten[0] }, { ...rewritten[1] }],
    ],
  ]);
  const res = await DB_ROUTES["person-search"](dbRows, { q: "6umen" });
  const keys = res.body.power.map((r) => r.key);
  // A and B keep their positions; C is appended; B is not duplicated.
  assert.deepEqual(keys, ["A", "B", "C"]);
});

test("a database without migration 141 searches exactly as it did before", async () => {
  // The degrade contract. 42883 on the alternate probe must not touch the plain result.
  const err = Object.assign(new Error("function shlyo_query_fold does not exist"), {
    code: "42883",
  });
  const { dbRows, calls } = stubDb([
    [isAltQuery, () => Promise.reject(err)],
    ["person_search", [person("Ivanov")]],
  ]);
  const res = await DB_ROUTES["person-search"](dbRows, { q: "Jelqzkov" });
  assert.deepEqual(
    res.body.power.map((r) => r.key),
    ["Ivanov"],
    "the plain probe's rows must survive a failing alternate probe",
  );
  assert.equal(calls.length, 7, "no second batch after the alternate probe failed");
  assert.equal(res.body.altQuery, null);
});

test("procurement-search: a rewrite extends each group by its own key", async () => {
  const { dbRows } = stubDb([
    [isAltQuery, [{ alt: "shumen" }]],
    [
      (sql, p) => sql.includes("search_contractors") && p[0] === "6umen",
      [{ eik: "1", name: "one" }],
    ],
    [
      (sql, p) => sql.includes("search_contractors") && p[0] === "shumen",
      [{ eik: "1", name: "one" }, { eik: "2", name: "two" }],
    ],
  ]);
  const res = await DB_ROUTES["procurement-search"](dbRows, { q: "6umen" });
  assert.deepEqual(
    res.body.companies.map((r) => r.eik),
    ["1", "2"],
    "the eik already present must not be duplicated, and the new one must be appended",
  );
});

test("procurement-search degrades to today's behaviour without 141", async () => {
  const err = Object.assign(new Error("no shlyo_query_fold"), { code: "42883" });
  const { dbRows } = stubDb([
    [isAltQuery, () => Promise.reject(err)],
    ["search_contractors", [{ eik: "1", name: "one" }]],
  ]);
  const res = await DB_ROUTES["procurement-search"](dbRows, { q: "remont" });
  assert.deepEqual(res.body.companies.map((r) => r.eik), ["1"]);
});

test("the alternate needle is passed to EVERY procurement group, not just the first", async () => {
  // A merge that paired groups by index would still look right if only one group were
  // re-queried; this asserts all six actually receive the rewritten needle.
  const seen = new Set();
  const { dbRows } = stubDb([
    [isAltQuery, [{ alt: "shumen" }]],
    [
      (sql, p) => {
        if (p[0] === "shumen") {
          for (const fn of [
            "search_contractors",
            "search_awarders",
            "search_contract_titles",
            "search_tender_subjects",
            "search_fund_projects",
            "search_interreg_operations",
          ])
            if (sql.includes(fn)) seen.add(fn);
        }
        return false;
      },
      [],
    ],
  ]);
  await DB_ROUTES["procurement-search"](dbRows, { q: "6umen" });
  assert.equal(seen.size, 6, `only ${seen.size}/6 groups got the rewrite: ${[...seen]}`);
});

test("ordinary Cyrillic never fires the rewrite", async () => {
  // THE REGRESSION THAT MATTERED MOST. `y(?![aeiou]) -> a` cannot tell a typed „y" (ъ) from
  // the one translit_bg_latin emits for й — so „Бойко Борисов" folds to `boyko borisov` and
  // rewrites to `boako borisov`. Measured before the gate: 13.64% of 539,985 indexed names
  // rewrite, 97.4% of them containing no shliokavitsa character at all, and 6 of 8 ordinary
  // Cyrillic queries fired a full second batch that injected 31 unrelated rows.
  for (const q of ["Бойко Борисов", "Иван Иванов", "Желязков", "ремонт"]) {
    const { dbRows, calls } = stubDb([["person_search", []]]);
    await DB_ROUTES["person-search"](dbRows, { q });
    assert.equal(
      calls.filter((c) => c.sql.includes("shlyo_query_fold")).length,
      0,
      `${q} must not even ASK for a rewrite`,
    );
  }
});

test("a Latin query with a trigger does ask", async () => {
  for (const q of ["6umen", "4erven", "sofiq", "jelezopyten", "plowdiw", "xubav"]) {
    const { dbRows, calls } = stubDb([["person_search", []]]);
    await DB_ROUTES["person-search"](dbRows, { q });
    assert.equal(
      calls.filter((c) => c.sql.includes("shlyo_query_fold")).length,
      1,
      `${q} should ask for a rewrite`,
    );
  }
});

test("the back-compat `people` array keeps every plain row", async () => {
  // It concatenates the three tiers, so appending alt rows to `power` in place pushed plain
  // money/others rows past its slice. Measured on the first draft: 4 plain rows lost.
  const mk = (k, tier) => ({ key: k, name: k, tier, firms_count: 0, href: `/p/${k}` });
  const { dbRows } = stubDb([
    [isAltQuery, [{ alt: "shumen" }]],
    [
      (sql, p) => sql.includes("%>") && p[1] === "6umen",
      (sql, p) => [mk(`plain-${p[0]}-1`, p[0]), mk(`plain-${p[0]}-2`, p[0])],
    ],
    [
      (sql, p) => sql.includes("%>") && p[1] === "shumen",
      (sql, p) => [mk(`alt-${p[0]}-1`, p[0])],
    ],
  ]);
  const res = await DB_ROUTES["person-search"](dbRows, { q: "6umen", limit: "6" });
  const names = res.body.people.map((r) => r.name);
  const plainCount = names.filter((n) => n.startsWith("plain-")).length;
  assert.equal(plainCount, 6, `all six plain rows must survive, got ${plainCount}`);
});

test("a failure in the ALTERNATE batch cannot 500 a request that has an answer", async () => {
  // tierRows swallows only 42883/42P01; a pool timeout in the second batch would otherwise
  // reject a request whose plain rows are already computed.
  const timeout = Object.assign(new Error("canceling statement"), { code: "57014" });
  let seen = 0;
  const { dbRows } = stubDb([
    [isAltQuery, [{ alt: "shumen" }]],
    [
      (sql, p) => sql.includes("person_search") && p[1] === "shumen",
      () => Promise.reject(timeout),
    ],
    [
      "person_search",
      () => (++seen, [{ key: "A", name: "A", tier: "P", firms_count: 0, href: "/p/A" }]),
    ],
  ]);
  const res = await DB_ROUTES["person-search"](dbRows, { q: "6umen" });
  assert.deepEqual(res.body.power.map((r) => r.key), ["A"]);
});

test("altQuery is returned so a see-all link can reach a servable page", async () => {
  const { dbRows } = stubDb([
    [isAltQuery, [{ alt: "shumen" }]],
    ["person_search", []],
  ]);
  const a = await DB_ROUTES["person-search"](dbRows, { q: "6umen" });
  assert.equal(a.body.altQuery, "shumen");

  const { dbRows: d2 } = stubDb([["person_search", []]]);
  const b = await DB_ROUTES["person-search"](d2, { q: "Ivanov" });
  assert.equal(b.body.altQuery, null, "null when no rewrite fired");
});
