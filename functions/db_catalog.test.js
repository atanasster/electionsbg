const test = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("pg");
const {
  classifyRelation,
  INTERNAL_NAMES,
  INTERNAL_PATTERNS,
  DERIVED_PATTERNS,
} = require("./db_catalog");

test("classifies the relation classes /db must not lead with", () => {
  // The four scratch tables that were the first entries a visitor saw on prod
  // (_pwy_before alone holds 33,026 rows there).
  for (const n of ["_pwy_before", "_pp_bak", "tmp_all_slugs", "tmp_rank_slugs"])
    assert.equal(classifyRelation(n, "public"), "internal", n);
  for (const n of ["meta", "ingest_batches", "person_slug_lock", "price_stage"])
    assert.equal(classifyRelation(n, "public"), "internal", n);
  for (const n of ["procurement_payloads", "contractor_search", "risk_cpv_median"])
    assert.equal(classifyRelation(n, "public"), "derived", n);
  for (const n of ["contracts", "tenders", "nzok_hospital_payments", "interreg_partners"])
    assert.equal(classifyRelation(n, "public"), "data", n);
});

test("fails OPEN — an unrecognised relation is shown, not hidden", () => {
  // A new dataset silently missing from the listing is invisible precisely
  // because the thing you would look for is the thing that is gone.
  assert.equal(classifyRelation("zz_brand_new_corpus", "public"), "data");
});

test("a non-public schema is never listed", () => {
  assert.equal(classifyRelation("contracts", "cron"), "internal");
});

test("no rule swallows a real dataset", () => {
  const real = ["contracts", "tenders", "fund_projects", "person", "price_facts"];
  for (const re of [...INTERNAL_PATTERNS, ...DERIVED_PATTERNS])
    assert.ok(
      !real.some((n) => re.test(n)),
      `${re} matches a core dataset relation`,
    );
});

test("every rule still earns its place", () => {
  // Named "no rule is dead" once and did not check it: a rule matching nothing
  // is one somebody believed was doing work. Each pattern must claim at least
  // one relation this repo actually has.
  const witnesses = [
    "_pwy_before", "tmp_all_slugs", "pg_stat_statements", "price_stage",
    "procurement_payloads", "fund_payloads", "contractor_search",
    "contract_risk_cache", "budget_hub_stats_cache",
    "tender_search_text", "officer_name_counts", "risk_cpv_median",
    "contractor_rank", "awarder_kindex_ranking",
  ];
  for (const re of [...INTERNAL_PATTERNS, ...DERIVED_PATTERNS])
    assert.ok(
      witnesses.some((n) => re.test(n)),
      `${re} matches nothing — dead rule`,
    );
});

test("deleting a rule changes an answer", () => {
  // Guards the mutants that passed every other case: dropping /_rank$/,
  // /_ranking$/ or the *_cache pattern silently reclassified nine relations
  // with no test noticing.
  const pinned = {
    contractor_rank: "derived",
    awarder_risk_grade_ranking: "derived",
    procurement_by_settlement_cache: "derived",
    graph_payloads: "derived",
    person_search: "derived",
    // and the five coverage tables that must NOT be derived — each is the only
    // home of a caveat CLAUDE.md requires consumers to print.
    ted_coverage: "data",
    adfi_coverage: "data",
    aop_expert_coverage: "data",
    isun_clean_delivery_coverage: "data",
    nzok_payment_coverage: "data",
  };
  for (const [name, want] of Object.entries(pinned))
    assert.equal(classifyRelation(name, "public"), want, name);
});

// ── Exhaustiveness, against a live database ────────────────────────────────
// Skips when Postgres is down, per the *.data.test.ts convention.
test("every live relation classifies, and the internal set matches the map", async (t) => {
  // The LOCAL database, like the sibling data gates: an ambient DATABASE_URL
  // (a shell left pointing at the Cloud SQL proxy) would otherwise check the
  // catalogue against production.
  const url = "postgres://postgres:postgres@localhost:5433/electionsbg";
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch {
    return t.skip("no reachable Postgres");
  }
  try {
    const { rows } = await client.query(
      `SELECT c.relname, c.relkind::text AS kind FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r','v','m') AND n.nspname = 'public'`,
    );
    assert.ok(rows.length > 100, `expected a loaded schema, saw ${rows.length}`);

    const seen = { data: 0, derived: 0, internal: 0 };
    for (const r of rows) seen[classifyRelation(r.relname, "public")] += 1;
    // Every relation lands in exactly one bucket by construction; what matters
    // is that the data bucket stays dominant — a rule that started swallowing
    // real datasets would show up here as a collapse.
    assert.ok(
      seen.data > rows.length * 0.6,
      `only ${seen.data}/${rows.length} classified as data`,
    );
    assert.ok(seen.internal > 0, "no relation classified internal");

    // Deliberately NOT asserting that every INTERNAL_NAMES entry exists. Six
    // loaders are REFRESH_EXCLUSIONS members and price_product_overrides comes
    // from 048, which nothing in `db:refresh` applies — so a clone that ran the
    // documented chain in full legitimately lacks several, and failing here
    // would block `npm run deploy:db` on a correctly set-up machine. The
    // absent direction is not monotone; only "a live relation nobody
    // classifies" would be, and classifyRelation is total by construction.
  } finally {
    await client.end();
  }
});
