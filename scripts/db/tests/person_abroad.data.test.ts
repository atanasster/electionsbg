// Gate for „Пари в чужбина" — the corpus-level register of declared money held outside
// Bulgaria (169_person_abroad.sql).
//
// The per-filing lens has its own gate (declaration_held_abroad.data.test.ts, over the
// classification rule). This one covers the AGGREGATE, where the failure modes are
// different and all four are silent: a double-counted total, a headline that disagrees with
// the rows beneath it, a country breakdown presented as the whole, and a scope value that
// vanishes.
//
// Auto-skips when Postgres is down, and skips with a DISTINCT reason when the corpus has no
// held_scope stamped — „no provenance yet" must never read as „the rule is enforced".
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const n = (v: unknown): number => Number(v ?? 0);

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person_abroad_table') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const stamped = async (): Promise<boolean> => {
  const [c] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM declaration_asset WHERE held_scope IS NOT NULL",
  );
  return n(c.n) > 0;
};

const haveDb = await reachable();
const haveProvenance = haveDb ? await stamped() : false;
const skip = !haveDb
  ? "Postgres unreachable / person_abroad_table absent — apply 169_person_abroad.sql"
  : !haveProvenance
    ? "declaration_asset.held_scope is entirely NULL — run scripts/declarations/backfill_asset_held_abroad.ts --apply, then db:load:declarations:pg"
    : false;

afterAll(async () => {
  await end();
});

// ---------------------------------------------------------------------------
// 1. THE LOAD-BEARING INVARIANT. 169's header calls this "the consequence to respect":
//    person_abroad_overview() and the table's 'latest' rows must share the same anchor, or
//    the page's headline is not the sum of the rows it renders. It broke once already
//    during development — round(sum()) against sum(round()), a 32-euro gap no row count
//    can see.
// ---------------------------------------------------------------------------
test.skipIf(skip)(
  "the headline equals the sum of the rows beneath it",
  async () => {
    const [r] = await allRows<{
      headline: string;
      rows_sum: string;
      rows_n: string;
    }>(
      `SELECT (person_abroad_overview()->>'eurAbroad')::numeric AS headline,
              (SELECT sum(value_eur) FROM person_abroad_table WHERE scope='latest') AS rows_sum,
              (person_abroad_overview()->>'rowsAbroad')::numeric AS rows_n`,
    );
    assert.equal(
      n(r.headline),
      n(r.rows_sum),
      "person_abroad_overview().eurAbroad must equal the sum of scope='latest' rows — check that both round PER ROW rather than rounding the sum",
    );
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_abroad_table WHERE scope='latest'",
    );
    assert.equal(
      n(r.rows_n),
      n(c.n),
      "rowsAbroad must equal the latest-scope row count",
    );
  },
);

// ---------------------------------------------------------------------------
// 2. THE DOUBLE COUNT. A holding is re-declared on every filing that covers it, so the raw
//    rows are the same accounts counted once per filing. /declarations/crypto shipped the
//    raw version once and published €1,960,489 against a true €1,649,180. This asserts the
//    register is on the deduped basis AND that the gap is real, so the test cannot pass by
//    the two happening to agree.
// ---------------------------------------------------------------------------
test.skipIf(skip)(
  "the register is deduped through person_wealth_year",
  async () => {
    const [r] = await allRows<{
      raw: string;
      deduped: string;
      table_all: string;
    }>(
      `SELECT (SELECT count(*) FROM declaration_asset WHERE held_scope='abroad') AS raw,
            (SELECT count(*) FROM declaration_asset a
               JOIN person_wealth_year w ON w.declaration_id = a.declaration_id
              WHERE a.held_scope='abroad') AS deduped,
            (SELECT count(*) FROM person_abroad_table WHERE scope='all') AS table_all`,
    );
    assert.ok(
      n(r.raw) > n(r.deduped),
      "expected the raw row set to be strictly larger than the deduped one — if these are equal the dedup is untested, not proven",
    );
    // The table is additionally privacy-gated (active public figures), so it may be smaller
    // than the deduped set — but never larger, which is what an un-deduped build would be.
    assert.ok(
      n(r.table_all) <= n(r.deduped),
      `person_abroad_table('all') has ${r.table_all} rows against a deduped ceiling of ${r.deduped} — it is not joining person_wealth_year`,
    );
  },
);

// ---------------------------------------------------------------------------
// 3. THE SCOPE FAN-OUT. Rows in a person's latest filing are emitted in BOTH buckets, so an
//    unscoped query is their UNION — 3,810 rows and €189.9m against a true 1,022 / €46.8m,
//    with count and sum inflated to match and nothing erroring. The registry entry's
//    defaultScope is what prevents it; this pins the shape that makes it necessary.
// ---------------------------------------------------------------------------
test.skipIf(skip)(
  "the scope buckets overlap, which is why defaultScope is mandatory",
  async () => {
    const rows = await allRows<{ scope: string; n: string }>(
      "SELECT scope, count(*) n FROM person_abroad_table GROUP BY 1 ORDER BY 1",
    );
    assert.deepEqual(rows.map((r) => r.scope).sort(), ["all", "latest"]);
    const all = n(rows.find((r) => r.scope === "all")?.n);
    const latest = n(rows.find((r) => r.scope === "latest")?.n);
    assert.ok(
      latest > 0 && all > latest,
      `expected latest ⊂ all, got ${latest} / ${all}`,
    );
    // Every latest row must exist in `all` — the buckets are a fan-out of one set, not two.
    const [c] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person_abroad_table l
      WHERE l.scope='latest'
        AND NOT EXISTS (SELECT 1 FROM person_abroad_table a
                         WHERE a.scope='all' AND a.holding_key = l.holding_key)`,
    );
    assert.equal(
      n(c.n),
      0,
      "a 'latest' holding_key with no 'all' twin means the fan-out is not over one set",
    );
  },
);

// ---------------------------------------------------------------------------
// 4. „WHERE" IS A SUBSET OF A SUBSET. „да" in the „В чужбина" column says abroad and names
//    nowhere. If a country breakdown is ever built, it speaks for a minority of the money
//    and must say so — this asserts the gap stays real so the copy cannot quietly stop
//    being true.
// ---------------------------------------------------------------------------
test.skipIf(skip)("a country is named on a minority of the money", async () => {
  const [r] = await allRows<{
    named: string;
    total: string;
    eur_named: string;
    eur: string;
  }>(
    `SELECT (person_abroad_overview()->>'countryNamedRows')::numeric AS named,
            (person_abroad_overview()->>'rowsAbroad')::numeric       AS total,
            (person_abroad_overview()->>'eurCountryNamed')::numeric  AS eur_named,
            (person_abroad_overview()->>'eurAbroad')::numeric        AS eur`,
  );
  assert.ok(n(r.named) > 0, "some abroad rows must name a country");
  assert.ok(
    n(r.named) < n(r.total) / 2,
    `a country is named on ${r.named}/${r.total} rows — if this ever becomes a majority, every "where is the money" caption has to be revisited`,
  );
  assert.ok(
    n(r.eur_named) < n(r.eur),
    "the named-country money must be a strict subset of the abroad money",
  );
  // …and country_named must agree with held_country, not drift from it.
  const [c] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM person_abroad_table
      WHERE country_named <> (held_country IS NOT NULL)`,
  );
  assert.equal(
    n(c.n),
    0,
    "country_named disagrees with held_country IS NOT NULL",
  );
});

// ---------------------------------------------------------------------------
// 5. THE DENOMINATOR IS PUBLISHED, AND IT IS THE NARROW ONE. 169's header exists because
//    the same numerator is 5.9% of bank+investment money and 2.3% of declared holdings.
//    A payload that dropped `eurInScope` would leave a consumer to pick a denominator by
//    accident, which is the failure the shape prevents.
// ---------------------------------------------------------------------------
test.skipIf(skip)("the overview names its basis", async () => {
  const [r] = await allRows<{ payload: Record<string, unknown> }>(
    "SELECT person_abroad_overview() AS payload",
  );
  for (const k of [
    "peopleAbroad",
    "rowsAbroad",
    "eurAbroad",
    "eurInScope",
    "pctOfInScope",
    "unresolvedRows",
    "unvaluedRowsAbroad",
    "countryNamedRows",
    "eurCountryNamed",
  ])
    assert.ok(k in r.payload, `person_abroad_overview() must publish ${k}`);
  const eur = n(r.payload.eurAbroad);
  const scope = n(r.payload.eurInScope);
  assert.ok(
    scope > eur,
    "eurInScope is the denominator and must exceed the abroad money",
  );
  assert.ok(
    Math.abs(n(r.payload.pctOfInScope) - (100 * eur) / scope) < 0.05,
    "pctOfInScope must be eurAbroad / eurInScope — not a share of declared wealth, which is ~2.5x smaller",
  );
});

// ---------------------------------------------------------------------------
// 6. COVERAGE. The register spans tables 5 and 8 only — table 4 (cash) has no such column,
//    so „money" here is bank + investment. A row from any other table would mean the
//    parser has started reading the pair off a table that does not carry it.
// ---------------------------------------------------------------------------
test.skipIf(skip)(
  "the register spans only the two tables that carry the pair",
  async () => {
    const rows = await allRows<{ table_num: string }>(
      `SELECT DISTINCT a.table_num FROM person_abroad_table t
       JOIN declaration_asset a
         ON a.declaration_id = t.declaration_id
        AND a.seq = split_part(t.holding_key, '-', 2)::int
      ORDER BY 1`,
    );
    assert.deepEqual(
      rows.map((r) => r.table_num),
      ["5", "8"],
      "held_scope exists only on tables 5 and 8 — anything else means the pair was read off a table without it (table 4's Cell 7 is „Произход на средствата\")",
    );
  },
);
