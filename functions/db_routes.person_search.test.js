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

// ── MULTI-WORD NAMES (docs/plans/home-search-expansion-v1.md Phase 1) ──────────────────
//
// `%>` is word_similarity(query, name_fold), which scores the query against ONE CONTINUOUS
// EXTENT of the name — so „vassil terziev" against „vasil aleksandrov terziev" was sunk by
// the patronymic sitting between the two words the reader typed. One arm per word, ANDed.
//
// These assert the SQL the route builds, because that is the half the data test cannot see:
// a data test only reports whether a row came back, and an implementation that had silently
// stopped tokenising would still return the mayor for the single-word probe.

const fuzzySql = async (query) => {
  const seen = [];
  const fn = async (sql, params) => {
    if (sql.includes("name_fold %>")) seen.push({ sql, params });
    return [];
  };
  await route(fn, query);
  return seen;
};

// One `%>` arm per qualifying word, all against the same column and ANDed.
const armCount = (sql) => (sql.match(/name_fold %> translit_bg_latin\(\$\d+\)/g) || []).length;

/** Every `$n` in the SQL is bound, and every bound parameter is referenced.
 *
 *  This is the guard the per-shape regexes below cannot be: the canonical renumbering bug
 *  (`$${i + 2}` instead of `$${i + 3}`) leaves `$1` doing double duty and the last parameter
 *  unreferenced, and it was caught by exactly ONE assertion in this file — every test that
 *  checks `params.slice(2)` and `armCount` separately passed on a build that would have
 *  thrown `bind message supplies N parameters, but prepared statement requires M` at
 *  runtime. Applied in every probe loop, it fails six tests instead of one and covers any
 *  future renumbering without a hand-written regex per shape. */
const assertParamArity = (sql, params) => {
  const idx = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  assert.equal(
    Math.max(...idx),
    params.length,
    `highest $n must equal params.length: ${sql}`,
  );
  for (let n = 1; n <= params.length; n++)
    assert.ok(idx.includes(n), `$${n} is bound but never referenced: ${sql}`);
};

test("person-search: a two-word name ANDs one %> arm per word", async () => {
  const probes = await fuzzySql({ q: "vassil terziev" });
  assert.ok(probes.length > 0, "expected fuzzy probes");
  for (const { sql, params } of probes) {
    assert.equal(armCount(sql), 2, `expected two arms, got: ${sql}`);
    assert.ok(/\$3\)[\s\S]*AND[\s\S]*\$4\)/.test(sql), `arms must be ANDed: ${sql}`);
    assertParamArity(sql, params);
    // $1 tier, $2 limit, then one parameter per word — never the whole query as well.
    assert.deepEqual(params.slice(2), ["vassil", "terziev"]);
    assert.ok(!params.includes("vassil terziev"), "the whole query must not also be bound");
  }
});

test("person-search: a single-word query keeps the one-arm path and binds the query", async () => {
  const probes = await fuzzySql({ q: "терзиев" });
  assert.ok(probes.length > 0, "expected fuzzy probes");
  for (const { sql, params } of probes) {
    assert.equal(armCount(sql), 1, `expected one arm, got: ${sql}`);
    assert.deepEqual(params.slice(2), ["терзиев"]);
    assertParamArity(sql, params);
  }
});

test("person-search: a sub-floor second word falls back to the whole query", async () => {
  // "яв ст" clears the query-level floor only by spanning two fragments that each probe the
  // trigram index far too widely — the per-word floor is what stops that, and the fallback
  // must bind the ORIGINAL query rather than a single surviving word.
  for (const q of ["явор ст", "яв ст"]) {
    const probes = await fuzzySql({ q });
    for (const { sql, params } of probes) {
      assert.equal(armCount(sql), 1, `${q} should take the one-arm path: ${sql}`);
      assert.deepEqual(params.slice(2), [q]);
      assertParamArity(sql, params);
    }
  }
});

test("person-search: repeated words are deduped rather than ANDed against themselves", async () => {
  const probes = await fuzzySql({ q: "Стефанов стефанов Явор" });
  for (const { sql, params } of probes) {
    assert.equal(armCount(sql), 2, `case-insensitive dedup expected: ${sql}`);
    assert.deepEqual(params.slice(2), ["Стефанов", "Явор"]);
    assertParamArity(sql, params);
  }
});

test("person-search: the word count is capped", async () => {
  const { MAX_SEARCH_WORDS } = require("./db_table.js");
  const q = Array.from({ length: MAX_SEARCH_WORDS + 3 }, (_, i) => `word${i}`).join(" ");
  const probes = await fuzzySql({ q });
  for (const { sql, params } of probes) {
    assert.equal(armCount(sql), MAX_SEARCH_WORDS, `capped at MAX_SEARCH_WORDS: ${sql}`);
    assert.equal(params.length, 2 + MAX_SEARCH_WORDS);
    assertParamArity(sql, params);
  }
});

test("person-search: ?decl still applies to a multi-word query", async () => {
  // The decl predicate is appended after the arms — a refactor that built the arms into the
  // WHERE without re-appending it would drop the declarations hub's two-group split with
  // nothing failing, because both groups would then return the same rows.
  const probes = await fuzzySql({ q: "vassil terziev", decl: "1" });
  assert.ok(probes.length > 0);
  for (const { sql } of probes) assert.ok(hasDeclPredicate(sql), `decl lost: ${sql}`);
});

test("person-search: the alternate shliokavitsa needle is tokenised too", async () => {
  // The rewrite runs the SAME tiers on a second needle, and `tierRows` merges the two by
  // key — so an alternate that took the whole-query path while the plain one tokenised
  // would answer half the query with a predicate the other half cannot reproduce.
  //
  // `shlyoAlt` asks the DB for the rewrite, so the mock has to answer that probe: with an
  // unconditional [] the alternate is null and this test passes vacuously.
  const seen = [];
  const fn = async (sql, params) => {
    if (sql.includes("shlyo_query_fold")) return [{ alt: "шумен желязков" }];
    if (sql.includes("name_fold %>")) seen.push({ sql, params });
    return [];
  };
  await route(fn, { q: "6umen jelqzkov" });
  const alternate = seen.filter(({ params }) =>
    params.slice(2).some((p) => /[Ѐ-ӿ]/.test(String(p))),
  );
  assert.ok(alternate.length > 0, "expected an alternate-needle probe");
  for (const { sql, params } of alternate) {
    assert.equal(armCount(sql), 2, `alternate needle must tokenise too: ${sql}`);
    assert.deepEqual(params.slice(2), ["шумен", "желязков"]);
    assertParamArity(sql, params);
  }
  // …and the plain needle is still tokenised on its own terms.
  const plain = seen.filter(({ params }) => params.slice(2).includes("6umen"));
  assert.ok(plain.length > 0, "expected a plain-needle probe");
  for (const { sql } of plain) assert.equal(armCount(sql), 2);
});

test("person-search: rank_static ordering survives the multi-word rewrite", async () => {
  // The early-stop on idx_person_search_rank is what keeps the most common name in the
  // corpus at single-digit milliseconds; a dynamic similarity sort over the full match set
  // was measured at 231 ms.
  const probes = await fuzzySql({ q: "ivan ivanov" });
  for (const { sql } of probes) {
    assert.ok(
      /ORDER BY rank_static DESC LIMIT \$2/.test(sql),
      `rank_static early-stop must stay byte-visible: ${sql}`,
    );
  }
});

test("person-search: the per-word floor counts CHARACTERS, not UTF-16 code units", async () => {
  // "👍👍" is 4 UTF-16 code units and 2 characters, and `show_trgm('👍👍')` is the EMPTY set —
  // so a `.length` floor would admit it as a qualifying word and probe the gin index on a
  // pattern with no trigram in it at all, which is the worst case the floor exists for.
  // Measured before this test existed: swapping termLength for .length inside
  // qualifyingSearchWords produced ZERO failures across all 542 functions/ tests.
  for (const { sql, params } of await fuzzySql({ q: "👍👍 терзиев" })) {
    assert.equal(armCount(sql), 1, `the emoji fragment must not become an arm: ${sql}`);
    assert.deepEqual(params.slice(2), ["👍👍 терзиев"]);
    assertParamArity(sql, params);
  }
});

test("person-search: the term is capped before it is split", async () => {
  // This route does not go through buildWhere, so it never inherited MAX_SEARCH_TERM's
  // slice — and the splitter walks the term three times per request.
  const { MAX_SEARCH_TERM } = require("./db_table.js");
  const q = "терзиев ".repeat(200);
  const probes = await fuzzySql({ q });
  assert.ok(probes.length > 0);
  for (const { sql, params } of probes) {
    for (const p of params.slice(2))
      assert.ok(
        String(p).length <= MAX_SEARCH_TERM,
        `a bound word outran the cap: ${String(p).length}`,
      );
    assertParamArity(sql, params);
  }
});
