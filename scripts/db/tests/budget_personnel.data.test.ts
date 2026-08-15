// Gates for the personnel corpus (plan T9.8).
//
// Two grains live in ONE table, distinguished only by whether `node_id` is
// NULL, and they come from DIFFERENT PUBLISHERS:
//
//   * NATIONAL (node_id IS NULL) — the annual Доклад за състоянието на
//     администрацията: щатни бройки across the whole administration.
//   * UNIT (node_id IS NOT NULL) — each ministry's own programme-budget
//     execution report: executed FTE inside that one body.
//
// They do not sum to each other and must never be added, averaged or compared.
// A query that forgets the `node_id` predicate doubles every national figure
// and the page still renders — which is why the predicate is asserted here
// rather than trusted.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const skip = !haveDb && "Postgres is not reachable";

const applied = haveDb
  ? Number(
      (
        await allRows<{ n: string }>(
          `SELECT count(*)::text n FROM information_schema.columns
            WHERE table_name = 'budget_personnel'
              AND column_name = 'positions_vacant_over_6m'`,
        )
      )[0]?.n ?? 0,
    ) > 0
  : false;

// APPLIED is not LOADED: db:load:budget:pg is a REFRESH_EXCLUSIONS member whose
// admin/programme inputs are gitignored, so a fresh clone has the columns and
// no rows — and that is not a defect.
const loaded = haveDb
  ? Number(
      (
        await allRows<{ n: string }>(
          "SELECT count(*)::text n FROM budget_personnel WHERE node_id IS NULL",
        )
      )[0]?.n ?? 0,
    ) > 0
  : false;

const stateSkip =
  skip ||
  (!applied
    ? "153's T9.8 columns are not applied here — run npm run db:load:budget:pg"
    : !loaded
      ? "budget_personnel is empty — db:load:budget:pg is in REFRESH_EXCLUSIONS"
      : false);

afterAll(async () => {
  await end();
});

test.skipIf(stateSkip)(
  "the two grains never carry each other's columns",
  async () => {
    // A national row with a unit column filled — or the reverse — means the
    // loader mixed the publishers, and every downstream figure is then a blend
    // of щатни бройки and executed FTE.
    const [bad] = await allRows<{ n: string }>(
      `SELECT count(*)::text n FROM budget_personnel
      WHERE (node_id IS NULL
             AND (headcount_executed IS NOT NULL
                  OR avg_cost_per_fte_eur IS NOT NULL
                  OR payroll_eur IS NOT NULL))
         OR (node_id IS NOT NULL
             AND (positions_total IS NOT NULL
                  OR positions_central IS NOT NULL
                  OR structures_central IS NOT NULL
                  OR nsi_headcount IS NOT NULL))`,
    );
    assert.equal(Number(bad.n), 0, "a row carries the other grain's columns");
  },
);

test.skipIf(stateSkip)(
  "central + territorial reconciles to the total",
  async () => {
    // The Доклад's own identity. `municipal` is a SUBSET of territorial, not a
    // third peer — adding all three overshoots by ~28k and the page would still
    // look plausible.
    const rows = await allRows<{ fy: number; d: string }>(
      `SELECT fiscal_year AS fy,
            (positions_total - (positions_central + positions_territorial))::text AS d
       FROM budget_personnel
      WHERE node_id IS NULL AND positions_central IS NOT NULL`,
    );
    assert.ok(rows.length >= 5, `only ${rows.length} years carry the split`);
    for (const r of rows) {
      assert.equal(Number(r.d), 0, `FY${r.fy}: central + territorial ≠ total`);
    }
  },
);

test.skipIf(stateSkip)("every subset stays inside its parent", async () => {
  const [bad] = await allRows<{ n: string }>(
    `SELECT count(*)::text n FROM budget_personnel
      WHERE node_id IS NULL
        AND (positions_municipal > positions_territorial
             OR positions_municipal_own_rev > positions_municipal
             OR positions_vacant_over_6m > positions_vacant
             OR positions_filled > positions_total)`,
  );
  assert.equal(Number(bad.n), 0, "a subset exceeds the set it belongs to");
});

test.skipIf(stateSkip)(
  "structure counts are bodies, and are NULL where unpublished",
  async () => {
    // 114 + 467 = 581 in FY2025. And 2017-2020 publish none: a stored 0 would
    // draw „no administrative structures", which is a claim about a state that
    // has none.
    const [r] = await allRows<{ c: number; t: number; total: number }>(
      `SELECT structures_central AS c, structures_territorial AS t,
            (structures_central + structures_territorial) AS total
       FROM budget_personnel WHERE node_id IS NULL AND fiscal_year = 2025`,
    );
    assert.equal(r.total, 581, "FY2025 structure count moved");
    assert.ok(r.c > 0 && r.t > 0);

    const [zeros] = await allRows<{ n: string }>(
      `SELECT count(*)::text n FROM budget_personnel
      WHERE node_id IS NULL AND (structures_central = 0 OR structures_territorial = 0)`,
    );
    assert.equal(
      Number(zeros.n),
      0,
      "an unpublished structure count stored as 0",
    );
  },
);

test.skipIf(stateSkip)("unit rows join a real spending unit", async () => {
  // `adminId` in the source is `budget_admin_node.node_id`. An orphan renders
  // as a nameless row in a leaderboard.
  const [bad] = await allRows<{ n: string }>(
    `SELECT count(*)::text n FROM budget_personnel p
      WHERE p.node_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM budget_admin_node n WHERE n.node_id = p.node_id)`,
  );
  assert.equal(Number(bad.n), 0, "a unit row names no spending unit");
});

test.skipIf(stateSkip)(
  "the published average agrees with spend ÷ headcount",
  async () => {
    // Stored from the source rather than derived, so this checks the SOURCE is
    // internally consistent — a report whose own average contradicts its own
    // totals is one we should not be quoting.
    const rows = await allRows<{ node: string; fy: number; d: string }>(
      `SELECT node_id AS node, fiscal_year AS fy,
            abs(avg_cost_per_fte_eur - payroll_eur / headcount_executed)::text AS d
       FROM budget_personnel
      WHERE node_id IS NOT NULL
        AND headcount_executed > 0 AND payroll_eur IS NOT NULL
        AND avg_cost_per_fte_eur IS NOT NULL`,
    );
    assert.ok(rows.length > 0, "no unit rows carry an average");
    for (const r of rows) {
      // One euro of rounding each side.
      assert.ok(Number(r.d) <= 1, `${r.node} FY${r.fy}: average off by ${r.d}`);
    }
  },
);

test.skipIf(stateSkip)(
  "coverage is stated against the WHOLE state budget",
  async () => {
    // The denominator that looked natural — executed expenditure in
    // budget_admin_fact — is 8 of 48 units for FY2024, so a share against it is
    // 7 units measured against 8. §II is complete and checkable.
    const [r] = await allRows<{
      units: number;
      unitsExp: number;
      stateExp: number;
    }>(
      `SELECT (budget_personnel_series()->'unitsCoverage'->>'units')::int AS units,
            (budget_personnel_series()->'unitsCoverage'->>'unitsExpenditureEur')::float AS "unitsExp",
            (budget_personnel_series()->'unitsCoverage'->>'stateExpenditureEur')::float AS "stateExp"`,
    );
    assert.ok(r.units > 0, "no covered units");
    assert.ok(
      r.stateExp > r.unitsExp,
      "the covered set exceeds the state budget",
    );
    // THE DENOMINATOR MUST BE §II, asserted by equality rather than by a band.
    // A band cannot do this job: the pre-migration tile's own denominator —
    // `sum(planned_eur)` over all 48 FY2024 admin nodes, €8.935bn — also clears
    // `< 0.5`, so swapping to it passed every assertion here. §II is a
    // published figure, so it can be named and compared.
    const [sec] = await allRows<{ v: number }>(
      `SELECT amount_eur AS v FROM budget_fiscal_year_figure
        WHERE series = 'expenditure' AND basis = 'actual'
          AND fiscal_year = (budget_personnel_series()->>'unitsFiscalYear')::int`,
    );
    assert.ok(sec?.v, "no §II figure for the units' fiscal year");
    assert.equal(
      Math.round(r.stateExp),
      Math.round(sec.v),
      "the coverage denominator is not §II of the state budget",
    );
    // A partial set, and it must LOOK partial: if this ever approaches 1 the
    // caption „only some ministries" has stopped being true.
    assert.ok(
      r.unitsExp / r.stateExp < 0.5,
      `covered units are ${((r.unitsExp / r.stateExp) * 100).toFixed(1)}% of §II — recheck the caption`,
    );
  },
);

test.skipIf(stateSkip)(
  "the national series is NATIONAL — one point per year",
  async () => {
    // THE property this file's header names, and it was not covered: dropping
    // `WHERE node_id IS NULL` from the `points` arm gives 23 points instead of 9
    // and every other assertion here still passed. A duplicated year renders as
    // two bars for 2024 and a headline that picks whichever sorted last.
    const [r] = await allRows<{ points: number; years: number }>(
      `SELECT jsonb_array_length(budget_personnel_series()->'points') AS points,
            (SELECT count(DISTINCT (p->>'fiscalYear'))
               FROM jsonb_array_elements(budget_personnel_series()->'points') p)::int AS years`,
    );
    assert.equal(
      r.points,
      r.years,
      `${r.points} points for ${r.years} years — the unit rows leaked into the national series`,
    );
    const [t] = await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM budget_personnel WHERE node_id IS NULL",
    );
    assert.equal(r.points, Number(t.n));
  },
);

test.skipIf(stateSkip)(
  "central and territorial are not transposed",
  async () => {
    // Both reconcile to the total either way round, so the identity gate cannot
    // see a swap. Central is the larger of the two in every year on file — 108k
    // against 37k in FY2025 — and a transposition would put three quarters of
    // the establishment in the territorial administration.
    const rows = await allRows<{ fy: number; c: number; t: number }>(
      `SELECT fiscal_year AS fy, positions_central AS c, positions_territorial AS t
       FROM budget_personnel
      WHERE node_id IS NULL AND positions_central IS NOT NULL`,
    );
    assert.ok(rows.length > 0, "no year carries the split");
    for (const r of rows) {
      assert.ok(
        r.c > r.t,
        `FY${r.fy}: central ${r.c} <= territorial ${r.t} — transposed?`,
      );
    }
    // Same for the structure counts, where the ratio runs the OTHER way: 114
    // central bodies against 467 territorial ones.
    const st = await allRows<{ fy: number; c: number; t: number }>(
      `SELECT fiscal_year AS fy, structures_central AS c, structures_territorial AS t
       FROM budget_personnel
      WHERE node_id IS NULL AND structures_central IS NOT NULL`,
    );
    assert.ok(st.length > 0, "no year carries structure counts");
    for (const r of st) {
      assert.ok(
        r.t > r.c,
        `FY${r.fy}: territorial bodies ${r.t} <= central ${r.c} — transposed?`,
      );
    }
  },
);

test.skipIf(stateSkip)(
  "the series exposes both grains without mixing them",
  async () => {
    const [r] = await allRows<{
      points: number;
      units: number;
      uy: number;
      nationalInUnits: string;
    }>(
      `SELECT jsonb_array_length(budget_personnel_series()->'points') AS points,
            jsonb_array_length(budget_personnel_series()->'units')  AS units,
            (budget_personnel_series()->>'unitsFiscalYear')::int    AS uy,
            (SELECT count(*)::text FROM jsonb_array_elements(budget_personnel_series()->'units') u
              WHERE u->>'nodeId' IS NULL) AS "nationalInUnits"`,
    );
    assert.ok(r.points >= 5, `only ${r.points} national points`);
    assert.ok(r.units > 0, "no unit rows in the payload");
    assert.equal(
      Number(r.nationalInUnits),
      0,
      "a national row leaked into units",
    );
    assert.ok(r.uy > 2000, "unitsFiscalYear is not a year");
  },
);
