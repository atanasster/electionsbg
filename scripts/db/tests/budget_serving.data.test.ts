// Gate for the /budget serving layer (migration 155) and its eleven routes.
//
// Three classes of failure, and only the first is visible without a gate:
//
//   1. A FUNCTION THAT DOES NOT COMPILE. `LANGUAGE sql` bodies are validated at
//      CREATE time, so this one is loud — but only on a database where the
//      tables exist, which is why 155's applier is the IN-CHAIN loader.
//   2. A FIGURE THAT DISAGREES WITH ITS TABLE. The serving layer is where a
//      basis gets applied twice, or to the wrong denominator, and the payload
//      still looks entirely plausible.
//   3. A COVERAGE PAIR THAT GOES MISSING. `budget_variance` must ship its
//      coveredUnits/totalUnits with every ranking, in UNITS not rows — a
//      consumer that receives only rows cannot render the page honestly.
//
// Skips only when Postgres is down or 155 has not been applied.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end, withTx } from "../lib/pg";

/** Only the fields the T9.9 gate reads. `budget_admin_list` returns more; a
 *  narrow local view keeps this test honest about what it depends on. */
interface BudgetAdminRow {
  nodeId: string;
  procurementEur: number | null;
  procurementCount: number | null;
  mpContractorCount: number | null;
}

const haveDb = await dbReachable();
const applied = haveDb
  ? Number(
      (
        await allRows<{ n: string }>(
          `SELECT count(*)::text n FROM pg_proc p
             JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'public' AND p.proname = 'budget_year_summary'`,
        )
      )[0]?.n ?? 0,
    ) > 0
  : false;

const skip = !haveDb
  ? "Postgres unreachable"
  : !applied
    ? "155 not applied here — run npm run db:load:budget-muni:pg"
    : false;

/**
 * APPLIED is not LOADED, and T3 is the change that decoupled them.
 *
 * The in-chain municipal loader now applies 152 + 153's DDL so 155's bodies
 * compile — but the loader that FILLS those tables (db:load:budget:pg) is in
 * REFRESH_EXCLUSIONS and never runs on a fresh clone or on CI. So `applied` is
 * true there while budget_fiscal_year is empty, and every state-corpus
 * assertion below would fail at db:refresh's final test:data step.
 *
 * The municipal assertions need no such guard: their loader is in the chain and
 * reads committed inputs, so an empty budget_muni_transfer really is a defect.
 */
const stateLoaded =
  !skip &&
  Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*)::text n FROM budget_fiscal_year",
      )
    )[0]?.n ?? 0,
  ) > 0;
const stateSkip =
  skip ||
  (!stateLoaded
    ? "the state corpus is empty — its loader (db:load:budget:pg) is in " +
      "REFRESH_EXCLUSIONS, so a fresh clone has the tables and no rows"
    : false);

afterAll(async () => {
  await end();
});

/** Every function 155 defines, with a call that must return non-null. */
const CALLS: Array<[string, string]> = [
  ["budget_year_summary", "budget_year_summary(2024, 'eur')"],
  ["budget_series", "budget_series(2024, 2026, 'revenue', 'eur')"],
  ["budget_snapshot", "budget_snapshot(2026, NULL, 'eur')"],
  ["budget_explorer", "budget_explorer(2024, 'admin', NULL, 'eur')"],
  ["budget_admin_list", "budget_admin_list(2024, NULL, 300)"],
  [
    "budget_admin_detail",
    "budget_admin_detail('admin-ministerstvo-na-finansite', NULL)",
  ],
  ["budget_cofog_list", "budget_cofog_list(2024, 'eur')"],
  ["budget_variance", "budget_variance(2024, 20)"],
  ["budget_documents", "budget_documents(NULL)"],
  ["budget_muni_list", "budget_muni_list(2026, NULL, 300)"],
  ["budget_muni_detail", "budget_muni_detail('SFO_CITY', NULL)"],
];

test.skipIf(stateSkip)("every serving function answers", async () => {
  for (const [name, call] of CALLS) {
    const [r] = await allRows<{ r: unknown }>(`SELECT ${call} AS r`);
    assert.notEqual(r?.r, null, `${name} returned NULL`);
  }
  // The list must not silently shrink: 155 defines eleven plus the basis helper.
  const [n] = await allRows<{ n: string }>(
    `SELECT count(*)::text n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public' AND p.proname LIKE 'budget\\_%'`,
  );
  assert.ok(
    Number(n.n) >= CALLS.length + 1,
    `only ${n.n} budget_* functions exist; expected at least ${CALLS.length + 1}`,
  );
});

test.skipIf(stateSkip)(
  "budget_admin_list carries the procurement cross-link (T9.9)",
  async () => {
    // ── the precompute reconciles with its source ───────────────────────────
    // Money and count are additive across the year rows; the CONTRACTOR COUNT
    // is not, which is the whole reason 'all' is stored rather than derived.
    // Measured: МО is 8 distinct politician-linked contractors against a naive
    // per-year sum of 38, and 28 of 46 units differ.
    const [recon] = await allRows<{
      nodes: string;
      eur_bad: string;
      cnt_bad: string;
      mp_over: string;
    }>(
      `WITH y AS (SELECT node_id, sum(eur) e, sum(contract_count) n,
                         sum(mp_contractor_count) mps
                    FROM budget_admin_procurement WHERE scope <> 'all'
                   GROUP BY node_id),
            a AS (SELECT node_id, eur e, contract_count n, mp_contractor_count mps
                    FROM budget_admin_procurement WHERE scope = 'all')
       SELECT count(*)::text nodes,
              count(*) FILTER (WHERE abs(y.e - a.e) > 0.01)::text eur_bad,
              count(*) FILTER (WHERE y.n <> a.n)::text            cnt_bad,
              count(*) FILTER (WHERE y.mps > a.mps)::text         mp_over
         FROM y JOIN a USING (node_id)`,
    );
    assert.ok(Number(recon.nodes) > 0, "budget_admin_procurement is empty");
    assert.equal(recon.eur_bad, "0", "year rows do not sum to the 'all' money");
    assert.equal(recon.cnt_bad, "0", "year rows do not sum to the 'all' count");
    // …and the non-additivity is REAL in this corpus, so the stored 'all' row
    // is doing work rather than duplicating a sum.
    assert.ok(
      Number(recon.mp_over) > 0,
      "no unit has a contractor active in two years — the 'all' row is untested",
    );

    // ── it is the SAME money the awarder page shows ─────────────────────────
    // The figure links to /awarder/:eik, so it has to be that page's sum: a
    // cross-link a reader cannot check is worse than none.
    const [drift] = await allRows<{ n: string }>(
      `SELECT count(*)::text n
         FROM budget_admin_procurement ap
         JOIN LATERAL (
           SELECT coalesce(sum(c.amount_eur), 0) eur, count(*) n
             FROM contracts c
            WHERE c.awarder_eik = ap.eik AND c.tag = 'contract'
              AND c.date ~ '^\\d{4}-'
              AND (ap.scope = 'all' OR left(c.date, 4) = ap.scope)
         ) live ON true
        WHERE abs(ap.eur - live.eur) > 0.01 OR ap.contract_count <> live.n`,
    );
    assert.equal(drift.n, "0", "the precompute has drifted from `contracts`");

    // ── the serving function returns it, scoped to ITS year ─────────────────
    const [fy] = await allRows<{ y: number }>(
      `SELECT max(scope::int) AS y FROM budget_admin_procurement
        WHERE scope <> 'all'`,
    );
    const [served] = await allRows<{ r: { rows: BudgetAdminRow[] } }>(
      `SELECT budget_admin_list($1::int, NULL, 300) AS r`,
      [fy.y],
    );
    const withProc = served.r.rows.filter((r) => r.procurementEur != null);
    assert.ok(withProc.length > 0, `no row carried a footprint for FY${fy.y}`);
    // Scoped, NOT all-time. The retired artifact carried an all-time total,
    // which put a €2.9bn figure beside one year's budget line.
    const [stored] = await allRows<{ eur: number }>(
      `SELECT eur FROM budget_admin_procurement WHERE node_id = $1 AND scope = $2`,
      [withProc[0].nodeId, String(fy.y)],
    );
    assert.ok(
      Math.abs((withProc[0].procurementEur ?? 0) - stored.eur) < 0.01,
      "the served figure is not the year's stored one",
    );

    // ── and it stays cheap ──────────────────────────────────────────────────
    // This call fires on every /budget/ministries view. Joining `contracts`
    // live was 8,665 buffers for one year and 104,214 for all of them, against
    // the ~2,000 a per-view call may spend on a db-g1-small.
    // ⚠️ The column is "QUERY PLAN", not `line`. Read as `line` every row is
    // `undefined`, every regex misses, and the sum is 0 — which passes any
    // "under N buffers" assertion for the wrong reason.
    const plan = await allRows<Record<string, string>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT budget_admin_list($1::int, NULL, 300)`,
      [fy.y],
    );
    // ⚠️ THE ROOT NODE'S LINE, NOT A SUM OF ALL OF THEM. Per-node `Buffers:` are
    // CUMULATIVE — a parent already includes its children — so summing every
    // line double-counts the moment the plan grows a second node, against a
    // fixed ceiling, and reads as a performance regression that is not one.
    // Everything after the `Planning:` marker is catalog I/O that varies with
    // backend cache warmth and was never part of the live-join comparison.
    const lines = plan.map((p) => p["QUERY PLAN"] ?? "");
    const planningAt = lines.findIndex((l) => /^Planning:/.test(l));
    const execLines = planningAt >= 0 ? lines.slice(0, planningAt) : lines;
    const root = execLines
      .map((l) => /shared hit=(\d+)(?: read=(\d+))?/.exec(l))
      .find((m): m is RegExpExecArray => m != null);
    const buffers = root ? Number(root[1]) + Number(root[2] ?? 0) : 0;
    assert.ok(
      buffers > 0,
      'parsed 0 buffers — the EXPLAIN column is "QUERY PLAN", and any ' +
        "ceiling assertion passes vacuously when the parse misses",
    );
    // The ceiling is against the NON-SARGABLE live-join form (17,331 buffers),
    // which is what this table primarily replaced for the one-year path — NOT
    // against a sargable live join, which measures about the same as reading
    // this table. The headline justification is the non-summable distinct count
    // above, not this number. See 157's header.
    assert.ok(
      buffers < 6000,
      `budget_admin_list touched ${buffers} buffers (non-sargable live join was 17,331)`,
    );
  },
);

test.skipIf(stateSkip)(
  "rebuild_budget_admin_procurement is a no-op without a contracts corpus",
  async () => {
    // The budget loader applies 157 and calls this, and it knows nothing about
    // whether the procurement corpus was ever loaded. Rolled back, so the real
    // table survives.
    await withTx(async (c) => {
      await c.query("ALTER TABLE contracts RENAME TO contracts__hidden");
      const r = await c.query("SELECT rebuild_budget_admin_procurement() AS n");
      assert.equal(
        String(r.rows[0].n),
        "0",
        "the rebuild did not skip a missing contracts table",
      );
      throw new Error("rollback");
    }).catch((e: Error) => {
      if (e.message !== "rollback") throw e;
    });
    // …and the table is untouched afterwards.
    const [after] = await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM budget_admin_procurement",
    );
    assert.ok(Number(after.n) > 0, "the rollback lost the table's contents");
  },
);

test.skipIf(stateSkip)(
  "budget_documents carries the year's OWN КФП coverage (T9.11)",
  async () => {
    // The journey's middle stage. It rides this call rather than a second route
    // because the page already makes it — but that means a payload change here
    // reaches production only through `apply_functions.ts`, with no loader and
    // no row count to notice its absence.
    const [open] = await allRows<{ r: Record<string, unknown> | null }>(
      `SELECT budget_documents(y.fiscal_year)->'coverage' AS r
         FROM budget_fiscal_year y WHERE y.complete = false
        ORDER BY y.fiscal_year DESC LIMIT 1`,
    );
    assert.ok(open?.r, "an open year returned no coverage object");
    const cov = open.r as Record<string, unknown>;
    assert.equal(cov.complete, false);
    assert.ok(
      typeof cov.monthsAvailable === "number" && cov.monthsAvailable > 0,
      `monthsAvailable was ${JSON.stringify(cov.monthsAvailable)}`,
    );

    // ⚠️ THE COUNT IS READ, NEVER DERIVED — and it is a count of КФП
    // observations CAPTURED, which 152's COMMENT ON COLUMN says outright is
    // false to render as coverage. FY2021 is `complete` with SIX, because the
    // feed is cumulative year-to-date and its December row IS the whole year.
    // Asserted against the table so the function cannot start computing it.
    const rows = await allRows<{
      fy: number;
      months: number;
      complete: boolean;
      payload: number;
    }>(
      `SELECT y.fiscal_year AS fy, y.months_available AS months, y.complete,
              (budget_documents(y.fiscal_year)->'coverage'->>'monthsAvailable')::int AS payload
         FROM budget_fiscal_year y ORDER BY y.fiscal_year`,
    );
    assert.ok(rows.length > 0, "budget_fiscal_year is empty");
    for (const r of rows) {
      assert.equal(r.payload, r.months, `FY${r.fy} month count drifted`);
    }
    // …and the corpus really does contain the year that makes the rule
    // non-trivial. `months < 12` alone is satisfied by the OPEN year too, where
    // `12 − months` is an ordinary „how much is left" and nothing is at stake;
    // only a CLOSED year with a partial feed can catch the misreading.
    assert.ok(
      rows.some((r) => r.complete && r.months < 12),
      "no COMPLETE year with a partial feed — the read-not-derive rule is untested",
    );

    // A DOCUMENT YEAR THE FEED DOES NOT REACH RETURNS NULL, not a zero. The
    // documents start at 2018 and `budget_fiscal_year` at 2021, so a zero here
    // would say „nothing was executed in 2018" on a page whose subject is what
    // was published.
    const [early] = await allRows<{ fy: number; cov: unknown }>(
      `SELECT d.fiscal_year AS fy, budget_documents(d.fiscal_year)->'coverage' AS cov
         FROM budget_document d
        WHERE d.fiscal_year IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM budget_fiscal_year y
                           WHERE y.fiscal_year = d.fiscal_year)
        ORDER BY d.fiscal_year LIMIT 1`,
    );
    if (early) {
      assert.equal(early.cov, null, `FY${early.fy} invented a coverage object`);
    }

    // Dates are serialized by POSTGRES (ISO-8601), not by node-postgres, whose
    // PG-`date` conversion uses the server process's timezone and lands a day
    // early under TZ=Europe/Sofia — migration 144's `funds_wire` is the worked
    // example, and there the fix was to leave the type as text.
    const asOf = cov.asOf;
    assert.ok(
      typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf),
      `asOf was ${JSON.stringify(asOf)}`,
    );
  },
);

test.skipIf(stateSkip)(
  "the basis control divides by the right denominator",
  async () => {
    // Applied ONCE, server-side, and each basis over its own denominator. A
    // second implementation in the screens is what the plan's §7.1 forbids, and
    // the way it goes wrong is arithmetic that still renders.
    const [r] = await allRows<{
      eur: number;
      gdp: number;
      gdp_eur: number;
      capita: number;
    }>(
      `SELECT (budget_year_summary(2024,'eur')    -> 'figures' -> 'expenditure' ->> 'actual')::float8 eur,
            (budget_year_summary(2024,'gdp')    -> 'figures' -> 'expenditure' ->> 'actual')::float8 gdp,
            (budget_year_summary(2024,'eur')    ->> 'gdpEur')::float8 gdp_eur,
            (budget_year_summary(2024,'capita') -> 'figures' -> 'expenditure' ->> 'actual')::float8 capita`,
    );
    assert.ok(r.eur > 0, "no expenditure figure to test the basis against");
    assert.ok(
      Math.abs(r.gdp - (r.eur / r.gdp_eur) * 100) < 1e-6,
      `gdp basis is ${r.gdp}, expected ${(r.eur / r.gdp_eur) * 100}`,
    );
    // `population` is deliberately NULL on every row today (the national
    // denominator is an open decision with three defensible answers), so the
    // capita basis must resolve to NULL rather than to the raw euro figure —
    // which is what an unguarded division would leave behind.
    assert.equal(r.capita, null);
  },
);

test.skipIf(stateSkip)(
  "an unknown basis falls through to EUR rather than blanking the page",
  async () => {
    const [r] = await allRows<{ same: boolean }>(
      `SELECT (budget_year_summary(2024,'banana') -> 'figures' -> 'expenditure' ->> 'actual')
            = (budget_year_summary(2024,'eur')    -> 'figures' -> 'expenditure' ->> 'actual') AS same`,
    );
    assert.equal(r.same, true);
  },
);

test.skipIf(stateSkip)(
  "budget_variance ships its coverage, in UNITS, with every ranking",
  async () => {
    for (const fy of [2023, 2024]) {
      const [r] = await allRows<{
        covered: number;
        total: number;
        rows: number;
      }>(
        `SELECT (budget_variance($1,20) ->> 'coveredUnits')::int covered,
                (budget_variance($1,20) ->> 'totalUnits')::int   total,
                jsonb_array_length(budget_variance($1,20) -> 'rows') rows`,
        [fy],
      );
      assert.ok(
        r.covered != null,
        `FY${fy} shipped a ranking with no coverage`,
      );
      assert.ok(r.total != null, `FY${fy} shipped no denominator`);
      assert.ok(r.covered <= r.total, `FY${fy} covered > total`);
      // UNITS, not rows — and the discriminating comparison is against the
      // ALL-KINDS row count, not the kind-filtered one.
      //
      // Measured while writing this gate: with `kind = 'expenditure'` there is
      // exactly one row per node, so count(*) and count(DISTINCT node_id) are
      // EQUAL and a gate comparing them proves nothing. The (nodeId × kind)
      // fan-out only bites when the kind filter is dropped — 14 rows against 8
      // units on FY2024 — so that is what this asserts against.
      const [u] = await allRows<{ units: number; all_kinds: number }>(
        `SELECT (SELECT count(DISTINCT node_id)::int FROM budget_admin_fact
                  WHERE fiscal_year = $1 AND kind = 'expenditure'
                    AND executed_eur IS NOT NULL) units,
                (SELECT count(*)::int FROM budget_admin_fact
                  WHERE fiscal_year = $1 AND executed_eur IS NOT NULL) all_kinds`,
        [fy],
      );
      assert.equal(
        r.covered,
        u.units,
        `FY${fy} coveredUnits is not a unit count`,
      );
      // Only meaningful when there IS coverage: on a zero-coverage year both
      // sides are 0 and the assertion would fail on a corpus that is simply
      // honest about having no reports (six of nine years).
      if (u.all_kinds > 0)
        assert.notEqual(
          r.covered,
          u.all_kinds,
          `FY${fy}: coveredUnits equals the un-filtered row count (${u.all_kinds}) — the ` +
            "function has dropped its kind filter and is counting (nodeId × kind) rows",
        );
    }
  },
);

test.skipIf(stateSkip)(
  "budget_variance names BOTH deltas — the law and the amendment",
  async () => {
    // „A ministry overspent its appropriation" and „parliament re-voted the
    // appropriation" are different findings; one „отклонение" collapses them.
    const [r] = await allRows<{ keys: string[] }>(
      `SELECT array(SELECT jsonb_object_keys(budget_variance(2024,5) -> 'rows' -> 0)) AS keys`,
    );
    for (const k of ["deltaVsLawEur", "deltaVsAmendedEur"]) {
      assert.ok(r.keys.includes(k), `budget_variance rows lack ${k}`);
    }
  },
);

test.skipIf(stateSkip)(
  "the snapshot payload keeps what `kind` cannot express",
  async () => {
    // Sections II and III are both kind = 'expenditure'; III is the EU
    // contribution. Without `series` the two are separable only by hardcoding a
    // roman numeral. And III/IV publish a total with zero lines, so they must
    // still appear.
    const [r] = await allRows<{ codes: string[]; sers: string[] }>(
      `SELECT array(SELECT jsonb_array_elements(budget_snapshot(2026) -> 'sections') ->> 'sectionCode') codes,
              array(SELECT jsonb_array_elements(budget_snapshot(2026) -> 'sections') ->> 'series')      sers`,
    );
    assert.equal(r.codes.length, 5);
    for (const c of ["III", "IV"])
      assert.ok(r.codes.includes(c), `section ${c}`);
    assert.ok(r.sers.includes("euContribution"), "the EU contribution series");
    assert.equal(new Set(r.sers).size, 5, "two sections share a series");
  },
);

test.skipIf(stateSkip)(
  "the COFOG payload declares the perimeter it is NOT",
  async () => {
    // S13 general government includes municipalities and the social funds, so
    // this is not a decomposition of the КФП state-budget expenditure it will be
    // rendered beside. The payload says so; a caption cannot silently swap them.
    const [r] = await allRows<{ perimeter: string; source: string }>(
      `SELECT budget_cofog_list(2024) ->> 'perimeter' perimeter,
              budget_cofog_list(2024) ->> 'source'    source`,
    );
    assert.match(r.perimeter, /general government/i);
    assert.match(r.source, /Eurostat/i);
  },
);

test.skipIf(stateSkip)(
  "the explorer returns ONE level and names its source",
  async () => {
    // One level per call is what keeps the drill cheap; a payload carrying the
    // whole tree is the thing being avoided.
    const [top] = await allRows<{ n: number; source: string }>(
      `SELECT jsonb_array_length(budget_explorer(2024,'admin') -> 'rows') n,
              budget_explorer(2024,'admin') ->> 'source' source`,
    );
    assert.ok(top.n > 0 && top.n < 200, `top level has ${top.n} rows`);
    assert.match(top.source, /МФ/);
    // The functional arm is a different corpus and must say so.
    const [fn] = await allRows<{ source: string }>(
      "SELECT budget_explorer(2024,'functional') ->> 'source' source",
    );
    assert.match(fn.source, /Eurostat/i);
    assert.notEqual(fn.source, top.source);
  },
);

test.skipIf(skip)(
  "the municipal functions never reach municipal_fiscal",
  async () => {
    // The boundary, asserted on the stored function bodies rather than on the
    // file — so a later CREATE OR REPLACE against a live database cannot cross
    // it without this failing.
    const bodies = await allRows<{ proname: string; def: string }>(
      `SELECT proname, pg_get_functiondef(p.oid) def FROM pg_proc p
         JOIN pg_namespace ns ON ns.oid = p.pronamespace
        WHERE ns.nspname = 'public' AND p.proname LIKE 'budget\\_%'`,
    );
    assert.ok(bodies.length > 0, "no budget_* functions found");
    // ONE deliberate exception, named rather than pattern-matched. T5.6 added
    // `budget_muni_commitments_national()` to put the LIABILITY figure on the
    // /budget hub — as its own line, beside the state deficit and explicitly
    // never added to it. It is the one function whose job is to read that
    // corpus, and it was tripping this gate from the day it shipped: the suite
    // went red at T5.6 and stayed red, because the steps after it ran the
    // budget SCREEN tests and this file's siblings but never this file.
    const ALLOWED = new Set(["budget_muni_commitments_national"]);
    assert.ok(
      bodies.some((b) => ALLOWED.has(b.proname)),
      "the allowlisted function is gone — drop it from ALLOWED rather than " +
        "leaving an entry that exempts nothing",
    );
    for (const b of bodies) {
      if (ALLOWED.has(b.proname)) continue;
      assert.ok(
        !/municipal_fiscal/i.test(b.def),
        `${b.proname} reads municipal_fiscal — that corpus is what municipalities OWE ` +
          "and this one is what the state SENDS; they are never combined",
      );
    }
  },
);

test.skipIf(stateSkip)(
  "the KFP series payload declares itself cumulative",
  async () => {
    // Summing periods double-counts by roughly n(n+1)/2, so the flag travels with
    // the data rather than living in a consumer's memory.
    const [r] = await allRows<{ cumulative: boolean }>(
      "SELECT (budget_series(2024,2024,'revenue') ->> 'cumulative')::boolean cumulative",
    );
    assert.equal(r.cumulative, true);
  },
);
