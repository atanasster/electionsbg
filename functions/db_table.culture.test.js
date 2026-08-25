// The four /culture/funds source resources.
//
// ⚠️⚠️ THE INVARIANT THIS FILE EXISTS FOR: the four arms are NOT comparable
// quantities and nothing may sum across them. One is an ИСУН contract value
// reached by the sector register's EIKs, one is the SAME contract value reached
// by a name rule (the two overlap heavily and NEITHER contains the other), one is
// a ДФЗ farm SUBSIDY, one is an Interreg partner's published BUDGET. They are four
// separate resources rather than one with a `source` discriminator precisely so
// that no relation exists over which `SUM()` would even parse — and the cheapest
// way to undo that is to "consolidate" them, which is what these assertions make
// expensive.
//
// Pure unit tests over the registry — no DB. Postgres-backed reconciliation lives
// in scripts/db/tests/culture_fund_sources.data.test.ts.
// Run: cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildWhere, REGISTRY } = require("./db_table.js");

const ARMS = {
  culture_isun_eik: "culture_isun_by_eik",
  culture_isun_name: "culture_isun_by_name",
  culture_agri_chitalishta: "culture_agri_chitalishta",
  culture_interreg: "culture_interreg_thematic",
};

test("all four arms are registered, each on its own generated view", () => {
  for (const [res, base] of Object.entries(ARMS)) {
    const r = REGISTRY[res];
    assert.ok(r, `resource ${res} is missing from the registry`);
    assert.equal(
      r.base,
      base,
      `${res} must read ${base} — the view generated from cultureMatch.ts by ` +
        `npm run gen:culture-sql, not the base corpus`,
    );
  }
});

test("no arm shares a base relation with another — they are four populations", () => {
  const bases = Object.values(ARMS);
  assert.equal(
    new Set(bases).size,
    bases.length,
    "two culture arms read the same relation, so one of them is counting the " +
      "wrong population",
  );
});

test("no arm exposes a `source`-style discriminator over a unioned relation", () => {
  // The consolidation that would make summing possible. A single resource with a
  // source/arm/basis filter implies one relation carrying all four euro columns,
  // and `SUM(eur)` over it is then one keystroke from a page whose whole thesis
  // is that these do not sum.
  for (const res of Object.keys(ARMS)) {
    const cols = Object.keys(REGISTRY[res].columns);
    for (const forbidden of ["source", "arm", "basis", "corpus"])
      assert.ok(
        !cols.includes(forbidden),
        `${res} exposes a \`${forbidden}\` column — if the four arms have been ` +
          `merged into one relation, the non-summation rule no longer has a ` +
          `structural guard`,
      );
  }
});

test("each arm declares scopeCols, even though all four are empty", () => {
  // buildWhere dereferences scopeCols unguarded, so a resource that OMITS it
  // answers a scoped request with an uncaught TypeError — a 500 where the
  // engine's contract promises a 400.
  //
  // Empty is right for all four for TWO different reasons, not one: the ИСУН
  // arms carry no date column at all (fund_projects publishes none), while the
  // ДФЗ (`year`) and Interreg (`start_date`/`end_date`) arms carry time as an
  // ordinary sortable/range-filterable column rather than as a page scope. The
  // first draft of this comment generalised the ИСУН fact to all four, which
  // would tell a future author a scope is impossible where it is merely
  // unnecessary.
  for (const res of Object.keys(ARMS)) {
    assert.ok(
      Array.isArray(REGISTRY[res].scopeCols),
      `${res} must declare scopeCols (empty is correct here, omitted is a 500)`,
    );
    assert.equal(REGISTRY[res].scopeCols.length, 0);
  }
});

test("every aggregate column is also selected and summable", () => {
  for (const res of Object.keys(ARMS)) {
    const r = REGISTRY[res];
    for (const a of r.aggregates ?? []) {
      if (!a.col) continue;
      assert.ok(
        r.select.includes(a.col),
        `${res} aggregates ${a.col} but never selects it`,
      );
      assert.equal(
        r.columns[a.col]?.agg,
        "sum",
        `${res}.${a.col} is aggregated without agg:"sum" on the column`,
      );
    }
  }
});

test("every defaultSort column is sortable and selected", () => {
  for (const res of Object.keys(ARMS)) {
    const r = REGISTRY[res];
    for (const [col] of r.defaultSort ?? []) {
      assert.ok(r.columns[col]?.sort, `${res}.${col} is sorted but not sortable`);
      assert.ok(r.select.includes(col), `${res}.${col} is sorted but not selected`);
    }
  }
});

test("the two ИСУН arms rank by GRANT, not by contract value", () => {
  // The page's headline is the grant — what the public purse paid. total_eur
  // includes the beneficiary's own co-finance, so heading with one and ranking by
  // the other makes the tile's top row disagree with its own number.
  for (const res of ["culture_isun_eik", "culture_isun_name"])
    assert.deepEqual(REGISTRY[res].defaultSort, [["grant_eur", "desc"]]);
});

test("the ДФЗ arm keeps scheme_desc out of the global search", () => {
  // Inherited from the agri_subsidies resource: scheme_desc has no trigram index,
  // so OR-ing it into the global search forces a full scan of the 2.48M-row BASE
  // table per keystroke. Narrowing the rows with a view does not narrow the index
  // the search has to use.
  const r = REGISTRY.culture_agri_chitalishta;
  assert.ok(!r.columns.scheme_desc.search, "scheme_desc must not be searchable");
  assert.ok(r.columns.name.search, "the ДФЗ search must still reach the name");
  const { whereSql } = buildWhere(r, { filters: { global: "просвета" } });
  assert.ok(
    !whereSql.includes("scheme_desc"),
    `the ДФЗ global search reached scheme_desc: ${whereSql}`,
  );
});

test("the Interreg arm searches the ENGLISH title, not the Bulgarian one", () => {
  // keep.eu publishes 86% of these titles in English only, so a Bulgarian-only
  // search arm would match almost nothing — the same reason
  // functions/interreg_topics.js bridges the query for /api/db/funds-fit.
  //
  // Asserted on the EMITTED SQL rather than on the registry flags, matching the
  // ДФЗ test above: a flag assertion re-states the config back to itself and
  // would still pass if the engine stopped honouring `search`.
  const r = REGISTRY.culture_interreg;
  const { whereSql } = buildWhere(r, { filters: { global: "heritage" } });
  assert.ok(
    whereSql.includes("title_en"),
    `the Interreg global search never reached title_en: ${whereSql}`,
  );
  assert.ok(
    whereSql.includes("partner_name"),
    `the Interreg global search never reached partner_name: ${whereSql}`,
  );
  assert.ok(
    !whereSql.includes("title_bg"),
    `the Interreg global search reached title_bg, which 86% of rows lack: ${whereSql}`,
  );
});

test("every arm carries its own deep-link key as a filter", () => {
  // Each row links somewhere, and the key is what the page filters on to prove a
  // row is reachable before rendering it as a link.
  assert.equal(REGISTRY.culture_isun_eik.columns.contract_number.filter, "in");
  assert.equal(REGISTRY.culture_isun_name.columns.contract_number.filter, "in");
  assert.equal(REGISTRY.culture_interreg.columns.keep_id.filter, "in");
  // ДФЗ has no per-payment page; its link is the recipient's, and 27 of 264 rows
  // carry no EIK at all — so `eik` is a filter, not a promise that every row has one.
  assert.equal(REGISTRY.culture_agri_chitalishta.columns.eik.filter, "in");
});

// ── paging determinism, per arm ─────────────────────────────────────────────
//
// `buildOrder` appends ONE tiebreak: `key` when the resource declares one, else
// `select[0]`. If that column is not unique the sort leaves rows in unordered tie
// groups, and a page turn repeats or skips them — silently, at a 200.
//
// ⚠️ Interreg is the arm this caught. Its select[0] was `keep_id`, the OPERATION
// id, 144 distinct over 202 partner rows: 4 rows sat in tie groups under the
// default budget sort and 97 of 202 under a programme_code sort. The view now
// composes `keep_id || ':' || partner_seq`, unique 202/202, because the tiebreak
// is a single column and (keep_id, partner_seq) cannot be declared as a pair.
//
// These assert the DECLARATION; the uniqueness of each column against the live
// corpus is asserted in scripts/db/tests/culture_fund_sources.data.test.ts.
const TIEBREAK = {
  culture_isun_eik: "contract_number",
  culture_isun_name: "contract_number",
  culture_agri_chitalishta: "id",
  culture_interreg: "key",
};

test("every arm names a unique paging tiebreak", () => {
  for (const [res, col] of Object.entries(TIEBREAK)) {
    const r = REGISTRY[res];
    // Mirrors buildOrder's own rule so the two cannot drift apart.
    const tie = r.columns.key ? "key" : r.select[0];
    assert.equal(
      tie,
      col,
      `${res} would page on \`${tie}\`, which is not the unique column this ` +
        `arm was measured against (${col}). A non-unique tiebreak repeats or ` +
        `skips rows at a page boundary, at a 200.`,
    );
    assert.ok(r.select.includes(tie), `${res} pages on ${tie} but never selects it`);
  }
});

test("the Interreg tiebreak is the composed key, never the operation id", () => {
  // keep_id is 144 distinct over 202 rows — it identifies the OPERATION, and an
  // operation has many partners. Declaring it the tiebreak is the specific
  // mistake this arm shipped with.
  const r = REGISTRY.culture_interreg;
  assert.ok(r.columns.key, "culture_interreg must declare a `key` column");
  assert.notEqual(
    r.columns.key ? "key" : r.select[0],
    "keep_id",
    "culture_interreg is paging on the operation id, which repeats per partner",
  );
});

// ── the two ИСУН arms are one contract ──────────────────────────────────────

test("the two ИСУН arms share one column contract", () => {
  // They read the SAME physical table through two views and front two arms of one
  // page family, so a shared component must be able to send the same filter to
  // both. The copy-pasted first cut had already drifted — `program_code` was `eq`
  // on one and `in` on the other — and the consequence was not a type error but a
  // silent empty set: buildFilter's `eq` branch binds a JS array as a Postgres
  // array literal against a text column and matches nothing, with an exact count
  // of 0, at a 200.
  const a = REGISTRY.culture_isun_eik;
  const b = REGISTRY.culture_isun_name;
  assert.notEqual(a.base, b.base, "the two arms must read DIFFERENT views");
  assert.deepEqual(
    Object.keys(a.columns).sort(),
    Object.keys(b.columns).sort(),
    "the two ИСУН arms expose different columns",
  );
  for (const c of Object.keys(a.columns))
    assert.deepEqual(
      a.columns[c],
      b.columns[c],
      `the two ИСУН arms disagree about the \`${c}\` column — a shared UI cannot ` +
        `express that, and an array sent to an \`eq\` arm returns 0 rows at a 200`,
    );
  assert.deepEqual(a.select, b.select);
  assert.deepEqual(a.defaultSort, b.defaultSort);
  assert.deepEqual(a.aggregates, b.aggregates);
});

test("a multi-value programme filter reaches both ИСУН arms as an IN", () => {
  // The concrete shape of the drift above: the same request against both arms.
  for (const res of ["culture_isun_eik", "culture_isun_name"]) {
    const { whereSql } = buildWhere(REGISTRY[res], {
      filters: { columns: [{ id: "program_code", value: ["A", "B"] }] },
    });
    assert.ok(
      /ANY|IN\s*\(/i.test(whereSql),
      `${res} did not build a set predicate for a multi-value program_code: ${whereSql}`,
    );
    assert.ok(
      !/program_code\s*=\s*\$/.test(whereSql),
      `${res} bound an array to a scalar equality — matches nothing at a 200: ${whereSql}`,
    );
  }
});

// ── no two arms share a money column, or an oblast vocabulary ───────────────

test("each arm's money column is named for what it measures", () => {
  // ⚠️ THE SUBTLE ROUTE TO THE CROSS-ARM ADDITION THE DESIGN FORBIDS. runDbTable
  // camelCases every column into the payload and buildAggSelect derives each
  // aggregate key from it, so two arms both calling their money `total_eur` hand
  // a shared row renderer, CSV export or tile ONE `row.totalEur` /
  // `aggregates.sumTotalEur` over two incomparable quantities. That is a far more
  // likely mistake than the `source`-discriminator consolidation guarded above,
  // and it is the one that was actually present: ДФЗ's subsidy shared the ИСУН
  // arms' `total_eur`.
  const MONEY = {
    culture_isun_eik: ["total_eur", "grant_eur", "own_cofinance_eur", "paid_eur"],
    culture_isun_name: ["total_eur", "grant_eur", "own_cofinance_eur", "paid_eur"],
    culture_agri_chitalishta: ["subsidy_eur"],
    culture_interreg: ["budget_eur", "eu_funding_eur"],
  };
  for (const [res, cols] of Object.entries(MONEY)) {
    const actual = Object.keys(REGISTRY[res].columns).filter((c) =>
      c.endsWith("_eur"),
    );
    assert.deepEqual(
      actual.sort(),
      [...cols].sort(),
      `${res}'s money columns changed — check no other arm now shares one`,
    );
  }
  // The two ИСУН arms SHARE their names deliberately: same quantity, two
  // overlapping populations. No other pair may.
  const bases = ["culture_agri_chitalishta", "culture_interreg", "culture_isun_eik"];
  for (let i = 0; i < bases.length; i++)
    for (let j = i + 1; j < bases.length; j++) {
      const shared = MONEY[bases[i]].filter((c) => MONEY[bases[j]].includes(c));
      assert.deepEqual(
        shared,
        [],
        `${bases[i]} and ${bases[j]} share the money column(s) ${shared.join(", ")} — ` +
          `they measure different things (contract value / farm subsidy / published ` +
          `budget) and would collide on one API key`,
      );
    }
});

test("oblast is named for the vocabulary it carries, per arm", () => {
  // Measured: ИСУН codes (S22, BGS), Interreg codes with a divergent Sofia
  // (SOFIA_CITY beside SFO), ДФЗ Bulgarian names („София (област)"). Under one
  // bare `oblast` id a facet offered „S22" as a place to filter by, and a shared
  // `?oblast=BGS` link matched nothing on the ДФЗ arm — silently, at a 200.
  // Convention: persons.oblast_code / companies.oblast_name.
  for (const res of ["culture_isun_eik", "culture_isun_name", "culture_interreg"])
    assert.ok(
      REGISTRY[res].columns.oblast_code && !REGISTRY[res].columns.oblast,
      `${res} carries oblast CODES and must declare them as oblast_code`,
    );
  const agri = REGISTRY.culture_agri_chitalishta;
  assert.ok(
    agri.columns.oblast_name && !agri.columns.oblast && !agri.columns.oblast_code,
    "the ДФЗ arm carries Bulgarian oblast NAMES and must declare oblast_name",
  );
});
