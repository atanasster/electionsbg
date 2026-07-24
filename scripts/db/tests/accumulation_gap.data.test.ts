// Correctness gate for the accumulation gap (092). Every assertion is a defamation
// control — the metric attaches a derived "unaccounted for" figure to a named individual,
// so the rules that decide WHEN it may be computed matter more than the arithmetic.
//
// Auto-skips when Postgres is down or the declarations are not loaded.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person_wealth_year') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_wealth_year",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / wealth matview empty";

afterAll(async () => {
  await end();
});

// THE COHORT GATE. Nobody outside accountability_senior may get a figure — this is the
// same boundary 091 defines, asserted at the point the number is actually produced.
test.skipIf(skip)("no gap is computed outside the senior cohort", async () => {
  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM person p
      WHERE NOT person_is_accountability_senior(p.person_id)
        AND person_accumulation_gap(p.slug) IS NOT NULL`,
  );
  assert.equal(
    Number(n),
    0,
    "a non-cohort person received an accumulation gap",
  );
});

// COMPLETE COVERAGE. Δ net worth spans fromYear→toYear; comparing it against income from
// only some of those years manufactures a difference. Every published figure must cover
// its own span.
test.skipIf(skip)("every published gap covers its whole span", async () => {
  const bad = await allRows<{ slug: string; years: number; span: number }>(
    `SELECT a.slug,
            (g->>'years')::int AS years,
            (g->>'toYear')::int - (g->>'fromYear')::int + 1 AS span
       FROM accountability_senior a
       JOIN LATERAL (SELECT person_accumulation_gap(a.slug) g) x ON true
      WHERE x.g IS NOT NULL
        AND (x.g->>'years')::int
            <> (x.g->>'toYear')::int - (x.g->>'fromYear')::int + 1
      LIMIT 5`,
  );
  assert.equal(
    bad.length,
    0,
    `gap published over an incomplete span: ${JSON.stringify(bad)}`,
  );
});

// A zero income total is a DATA ABSENCE, not a finding — it would publish the person's
// whole wealth change as unaccounted for.
test.skipIf(skip)(
  "no gap is published against zero declared income",
  async () => {
    const [{ n }] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM accountability_senior a
       JOIN LATERAL (SELECT person_accumulation_gap(a.slug) g) x ON true
      WHERE x.g IS NOT NULL
        AND (x.g->>'declaredIncomeEur')::numeric <= 0`,
    );
    assert.equal(
      Number(n),
      0,
      "a gap was published against zero declared income",
    );
  },
);

// THE OFF-BY-ONE. Income is summed strictly AFTER the opening snapshot, so it can never
// include the from-year. Re-derive and compare.
test.skipIf(skip)("income excludes the opening year", async () => {
  const bad = await allRows<{ slug: string }>(
    `SELECT a.slug FROM accountability_senior a
       JOIN LATERAL (SELECT person_accumulation_gap(a.slug) g) x ON true
       JOIN LATERAL (
         SELECT COALESCE(SUM(w.income_eur), 0) expected
           FROM person_wealth_year w
          WHERE w.person_id = a.person_id
            AND w.declaration_year > (x.g->>'fromYear')::int
       ) e ON true
      WHERE x.g IS NOT NULL
        AND round((x.g->>'declaredIncomeEur')::numeric) <> round(e.expected)
      LIMIT 5`,
  );
  assert.equal(
    bad.length,
    0,
    `declared income does not match the post-opening sum: ${JSON.stringify(bad)}`,
  );
});

// THE DENOMINATOR. Counted on the CLOSING filing only, and "unvalued" includes €0-priced
// rows — the zero-priced ones outnumber the NULLs, and counting only NULLs suppressed the
// caveat for hundreds of people.
test.skipIf(skip)(
  "the unvalued count is the closing filing's, NULL or zero priced",
  async () => {
    const bad = await allRows<{ slug: string }>(
      `SELECT a.slug FROM accountability_senior a
         JOIN LATERAL (SELECT person_accumulation_gap(a.slug) g) x ON true
         JOIN LATERAL (
           SELECT w.declaration_id
             FROM person_wealth_year w
            WHERE w.person_id = a.person_id
            ORDER BY w.declaration_year DESC LIMIT 1
         ) last ON true
         JOIN LATERAL (
           SELECT count(*) expected FROM declaration_asset d
            WHERE d.declaration_id = last.declaration_id
              AND d.category = 'real_estate'
              AND (d.value_eur IS NULL OR d.value_eur = 0)
         ) u ON true
        WHERE x.g IS NOT NULL
          AND (x.g->>'unvaluedRealEstate')::int <> u.expected
        LIMIT 5`,
    );
    assert.equal(
      bad.length,
      0,
      `unvalued count is not the closing filing's: ${JSON.stringify(bad)}`,
    );
  },
);

// The arithmetic itself: gap = Δnet − income, and Δnet = toNet − fromNet.
test.skipIf(skip)("the gap arithmetic is internally consistent", async () => {
  const bad = await allRows<{ slug: string }>(
    `SELECT a.slug FROM accountability_senior a
       JOIN LATERAL (SELECT person_accumulation_gap(a.slug) g) x ON true
      WHERE x.g IS NOT NULL
        AND ( (x.g->>'deltaNetEur')::numeric
                <> round((x.g->>'toNetEur')::numeric - (x.g->>'fromNetEur')::numeric)
           OR (x.g->>'gapEur')::numeric
                <> round((x.g->>'deltaNetEur')::numeric
                         - (x.g->>'declaredIncomeEur')::numeric) )
      LIMIT 5`,
  );
  assert.equal(
    bad.length,
    0,
    `inconsistent arithmetic: ${JSON.stringify(bad)}`,
  );
});
