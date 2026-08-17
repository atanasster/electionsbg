// Tier 3 (Postgres-native) — the scoped beneficiary rollup behind the ranked
// /subsidies/recipients page (migration 046, `agri_beneficiary_year`).
//
//   npm run test:data
//
// These gates exist because the alternative designs are one word away and each
// fails silently:
//
//   • `scope_key` is the `agri_payloads` KEY, not a year. If the two sets drift, a
//     scope the hub happily resolves serves an EMPTY ranking at a 200 — the reader
//     sees „няма получатели“ for a year with a billion euros in it.
//   • The name and oblast are JOINED from `agri_beneficiary` rather than re-derived
//     per scope, so one EIK cannot show a different spelling on 2015 than on 2025 —
//     the exact defect 046's LONGEST-spelling rule exists to prevent. NOTE this is
//     pinned by the name-stability test below and by NOTHING ELSE: the money tests
//     agree because the two WHERE clauses are duplicated, not because of the join,
//     so a per-scope re-derivation would keep every euro correct and still ship the
//     label defect.
//   • `agri_beneficiary` must NOT gain a year dimension. It is keyed UNIQUE (eik)
//     and backs the per-keystroke typeahead; a scope column there would multiply
//     every hit by the number of years the farm appears in AND turn the finder into
//     a scope FILTER, which is the „вашата фирма не съществува“ answer the hub
//     search rule forbids.
//   • The ranked walk must stay an index scan. The whole reason this matview exists
//     rather than a live GROUP BY is that the page is a top-N per scope.
//
// Requires the Postgres store. Auto-skips when it is unreachable or the corpus has
// not been loaded, exactly like the other *.data.test.ts gates.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();

// Not loaded on this checkout: `db:load:agri:pg` reads the gitignored
// `raw_data/agri/` cache and legitimately skips a fresh clone. Absent is that
// loader's problem, not this file's — but EMPTY-when-present is exactly what this
// gate is for, so the probe is on the relation existing, never on it having rows.
const built = haveDb
  ? (
      await allRows<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ANY(current_schemas(false))
            AND c.relkind = 'm' AND c.relname = 'agri_beneficiary_year'`,
      )
    )[0].n !== "0"
  : false;

const corpusLoaded =
  haveDb && built
    ? (
        await allRows<{ n: string }>(
          "SELECT count(*)::text AS n FROM agri_subsidies",
        )
      )[0].n !== "0"
    : false;

const skip = !haveDb
  ? "Postgres unreachable"
  : !built
    ? "046 not applied"
    : !corpusLoaded
      ? "agri corpus not loaded"
      : false;

afterAll(async () => {
  if (haveDb) await end();
});

test.skipIf(skip)(
  "scope_key set equals the agri_payloads overview key set",
  async () => {
    const [row] = await allRows<{
      rollup: string[] | null;
      payload: string[] | null;
    }>(
      `SELECT (SELECT array_agg(DISTINCT scope_key ORDER BY scope_key)
                 FROM agri_beneficiary_year) AS rollup,
              (SELECT array_agg(DISTINCT key ORDER BY key)
                 FROM agri_payloads WHERE kind = 'overview') AS payload`,
    );
    // `array_agg` returns NULL over an empty relation, not `[]` — so without this
    // the headline gate reports green by comparing two NULLs on a database where
    // the matview was created and never REFRESHed.
    assert.ok(
      row.rollup?.length,
      "agri_beneficiary_year holds no scopes at all — it exists but was never REFRESHed",
    );
    assert.deepEqual(
      row.rollup,
      row.payload,
      "the ranking and the overview payloads disagree about which scopes exist — " +
        "a scope the hub resolves would serve an empty ranking at a 200",
    );
  },
);

test.skipIf(skip)(
  "the 'all' partition reconciles with agri_beneficiary",
  async () => {
    const [row] = await allRows<{
      rollup: string;
      typeahead: string;
      rollup_n: string;
      typeahead_n: string;
    }>(
      // `sum(x::numeric)`, not `sum(x)::numeric`. Both sides are `double
      // precision` and the two aggregations run in different orders, so they
      // already differ at the bit level on 8,208 of 16,701 EIKs (max 1.49e-08).
      // Casting per row accumulates in exact decimal and makes the comparison
      // independent of the plan — parallel aggregation in particular.
      `SELECT (SELECT round(sum(total_eur::numeric), 2) FROM agri_beneficiary_year
                WHERE scope_key = 'all')::text AS rollup,
              (SELECT round(sum(total_eur::numeric), 2) FROM agri_beneficiary)::text AS typeahead,
              (SELECT count(*) FROM agri_beneficiary_year WHERE scope_key = 'all')::text AS rollup_n,
              (SELECT count(*) FROM agri_beneficiary)::text AS typeahead_n`,
    );
    assert.equal(
      row.rollup,
      row.typeahead,
      "the all-time ranking and the typeahead disagree about the money — they read " +
        "the same rows under duplicated predicates, so one of them has drifted",
    );
    assert.equal(row.rollup_n, row.typeahead_n, "row counts diverged too");
  },
);

test.skipIf(skip)(
  "one EIK carries one name and one oblast across every scope",
  async () => {
    // THE property the JOIN onto `agri_beneficiary` exists for, and the only test
    // that can see it. Re-derive name/oblast per scope inside the matview and every
    // money assertion in this file still passes while a farm renamed between 2015
    // and 2025 shows two different spellings depending on the pill — which is the
    // defect 046's LONGEST-spelling rule was written to end, reintroduced one table
    // over.
    const [row] = await allRows<{ n: string; sample: string | null }>(
      `SELECT count(*)::text AS n, min(eik) AS sample FROM (
         SELECT eik FROM agri_beneficiary_year
          GROUP BY eik
         HAVING count(DISTINCT name) > 1
             OR count(DISTINCT oblast COLLATE "C") > 1) t`,
    );
    assert.equal(
      row.n,
      "0",
      `${row.n} EIK(s) (e.g. ${row.sample}) show a different spelling or oblast ` +
        "depending on the scope — name/oblast are being re-derived per scope " +
        "instead of joined from agri_beneficiary",
    );
  },
);

test.skipIf(skip)(
  "the default scope names the same year as the '' overview payload",
  async () => {
    // Pinned to what `agri_payloads` DECLARES, not to a re-derivation. „Which year
    // is the latest" is already decided in `scripts/agri/ingest.ts` (max(year) over
    // every row, individuals included) and 046 mirrors that; a third max(year) here
    // would be a third opinion rather than a check on the other two, and the three
    // separate the first time a year lands whose only rows are individual payments.
    const [row] = await allRows<{
      payload_year: string | null;
      dflt: string;
      mirrored: string;
      all_eur: string;
    }>(
      `WITH py AS (
         SELECT payload->>'scopeYear' AS y
           FROM agri_payloads WHERE kind = 'overview' AND key = '')
       SELECT (SELECT y FROM py) AS payload_year,
              (SELECT round(sum(total_eur::numeric), 2) FROM agri_beneficiary_year
                WHERE scope_key = '')::text AS dflt,
              (SELECT round(sum(total_eur::numeric), 2) FROM agri_beneficiary_year
                WHERE scope_key = (SELECT y FROM py))::text AS mirrored,
              (SELECT round(sum(total_eur::numeric), 2) FROM agri_beneficiary_year
                WHERE scope_key = 'all')::text AS all_eur`,
    );
    assert.ok(
      row.payload_year,
      "the '' overview payload carries no scopeYear — nothing declares which year " +
        "the default scope means",
    );
    assert.equal(
      row.dflt,
      row.mirrored,
      `the '' partition does not mirror FY${row.payload_year} — the hub's default ` +
        "pill and the ranking beneath it would describe different windows",
    );
    // The rejected alternative, asserted explicitly: '' is NOT the corpus. Without
    // this, a build where every scope holds every row passes everything above.
    assert.notEqual(
      row.dflt,
      row.all_eur,
      "the default scope equals the whole corpus — the year partitioning is not " +
        "taking, so the hub’s „Последна година“ pill would count all eight years",
    );
  },
);

test.skipIf(skip)(
  "the '' and latest-year partitions are the same rows, not merely the same total",
  async () => {
    const [row] = await allRows<{ diff: string; year: string | null }>(
      `WITH py AS (
         SELECT payload->>'scopeYear' AS y
           FROM agri_payloads WHERE kind = 'overview' AND key = ''),
       d AS (
         -- total_eur ROUNDED to the 2 dp the page renders. The two arms of the
         -- UNION reach the same figure by different aggregation orders — one
         -- groups by (year, eik), the other filters the year and groups by eik —
         -- so sum(double precision) differs in the last bits on 2,920 of 8,396
         -- rows here, max 4.66e-10 and ZERO once rounded. Comparing raw doubles
         -- makes this gate fail on arithmetic noise rather than on drift.
         SELECT eik, name, oblast, round(total_eur::numeric, 2) AS eur, payment_count
           FROM agri_beneficiary_year WHERE scope_key = ''
         EXCEPT
         SELECT eik, name, oblast, round(total_eur::numeric, 2), payment_count
           FROM agri_beneficiary_year WHERE scope_key = (SELECT y FROM py))
       SELECT (SELECT count(*) FROM d)::text AS diff, (SELECT y FROM py) AS year`,
    );
    assert.equal(
      row.diff,
      "0",
      `${row.diff} row(s) differ between the '' partition and FY${row.year}. They ` +
        "are the same GROUP BY over the same rows, so any divergence means the two " +
        "arms of the UNION have drifted apart",
    );
  },
);

test.skipIf(skip)(
  "agri_beneficiary stays all-time and holds exactly one row per EIK",
  async () => {
    const cols = await allRows<{ column_name: string }>(
      `SELECT a.attname AS column_name
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY(current_schemas(false))
          AND c.relkind = 'm' AND c.relname = 'agri_beneficiary'
          AND a.attnum > 0 AND NOT a.attisdropped`,
    );
    const names = cols.map((c) => c.column_name);
    for (const banned of ["year", "scope_key", "scope"])
      assert.ok(
        !names.includes(banned),
        `agri_beneficiary grew a \`${banned}\` column. The typeahead reads this ` +
          "matview, so a scope dimension here turns the finder into a filter — " +
          "„вашата фирма не съществува“ instead of „няма плащания през 2025“. The " +
          "scoped rollup is agri_beneficiary_year; keep them separate.",
      );

    // The PROPERTY, not a proxy for it. Counting unique indexes is satisfied by a
    // unique index on anything at all — including (eik, name), which is exactly
    // what a year dimension would need.
    const [dupes] = await allRows<{ n: string; sample: string | null }>(
      `SELECT count(*)::text AS n, min(eik) AS sample FROM (
         SELECT eik FROM agri_beneficiary GROUP BY eik HAVING count(*) > 1) t`,
    );
    assert.equal(
      dupes.n,
      "0",
      `agri_beneficiary holds ${dupes.n} EIK(s) more than once (e.g. ${dupes.sample}) — ` +
        "one row per EIK is what makes the typeahead's cap mean 8 farms rather " +
        "than 8 farm-years",
    );
  },
);

test.skipIf(skip)(
  "membership is re-derived from agri_subsidies, not inherited from the join",
  async () => {
    // Deliberately compared against the BASE table rather than against
    // `agri_beneficiary`. The matview ends in an INNER JOIN onto that sibling,
    // which already excludes NULL EIKs and the paying agency — so asserting those
    // two properties on the output cannot fail no matter what happens to the `src`
    // predicates, and reads as a gate while being incapable of firing. Re-deriving
    // the expected membership here makes those predicates load-bearing again.
    const [row] = await allRows<{ got: string; want: string }>(
      `SELECT (SELECT count(*) FROM agri_beneficiary_year WHERE scope_key = 'all')::text AS got,
              (SELECT count(DISTINCT eik) FROM agri_subsidies
                WHERE eik IS NOT NULL AND eik <> '121100421')::text AS want`,
    );
    assert.equal(
      row.got,
      row.want,
      "the all-time ranking does not hold one row per EIK-bearing, non-payer " +
        "beneficiary of agri_subsidies — /farm/:eik is the only destination, so a " +
        "row that is not in that set cannot land, and one that is missing is a " +
        "farm the page silently omits",
    );
  },
);

test.skipIf(skip)(
  "payment_count counts the rows behind the money",
  async () => {
    // The rollup's second measure. Without this it is written, served and never
    // checked — and it is the one column whose aggregate differs from `total_eur`'s,
    // so a copy-paste that summed money into it would look right in every other test.
    const [row] = await allRows<{ mismatched: string; scope: string | null }>(
      `SELECT count(*)::text AS mismatched, min(y.scope_key) AS scope
       FROM agri_beneficiary_year y
       JOIN LATERAL (
         SELECT count(*) AS n FROM agri_subsidies a
          WHERE a.eik = y.eik
            AND (y.scope_key = 'all' OR a.year::text = y.scope_key)
       ) src ON true
      WHERE y.scope_key <> '' AND src.n <> y.payment_count`,
    );
    assert.equal(
      row.mismatched,
      "0",
      `${row.mismatched} row(s) (e.g. scope ${row.scope}) carry a payment_count that ` +
        "does not match the agri_subsidies rows behind them",
    );
  },
);

test.skipIf(skip)("the ranked page walk stays an index scan", async () => {
  const plan = await allRows<{ "QUERY PLAN": string }>(
    // `NULLS LAST` must match idx_agri_beneficiary_year_rank's null ordering. An
    // ORDER BY that disagrees cannot be served by the index and silently
    // reintroduces a Sort over every row in the scope — which is what this test
    // exists to catch, so the query it measures has to be the one the page runs.
    `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
       SELECT eik, name, oblast, total_eur, payment_count
         FROM agri_beneficiary_year
        WHERE scope_key = ''
        ORDER BY total_eur DESC NULLS LAST, eik
        LIMIT 50`,
  );
  const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
  assert.ok(
    /Index Scan using idx_agri_beneficiary_year_rank/.test(text),
    `the ranking stopped using its covering index — a Sort here means every scope's ` +
      `rows are read and ordered per request:\n${text}`,
  );
  assert.ok(
    !/\bSort\b/.test(text),
    `the ranked walk is sorting rather than reading the index in order:\n${text}`,
  );
  // EXECUTION buffers only. PG 13+ always emits a `Planning:` block under BUFFERS,
  // and it is the larger of the two here (~140 against 52) — so taking a max across
  // the whole text pins the ceiling to catalog-cache warmth and stays green through
  // exactly the execution regression this gate is for. Matching either half of the
  // hit/read pair matters too: a cold run prints `shared read=52` with no `hit=`,
  // which a hit-only pattern scores as 0 and passes vacuously.
  const execText = text.split(/^Planning:/m)[0] ?? text;
  const buffers = [
    ...execText.matchAll(/shared(?: hit=(\d+))?(?: read=(\d+))?/g),
  ].reduce((max, m) => Math.max(max, Number(m[1] ?? 0) + Number(m[2] ?? 0)), 0);
  assert.ok(buffers > 0, `no execution buffers parsed from:\n${text}`);
  // Measured 2026-08-17: 52 execution buffers. The dashboard-hub skill's ceiling
  // for anything served live is ~2,000; tightened here because 52 leaves the room.
  assert.ok(
    buffers < 200,
    `the ranked walk touched ${buffers} execution buffers (was 52) — check the ` +
      `index still leads with scope_key:\n${text}`,
  );
});
