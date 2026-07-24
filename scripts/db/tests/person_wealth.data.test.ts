// Correctness gate for the wealth series (090_person_wealth.sql). The matview and
// its serving functions are what the /person profile and the trajectory chart read,
// so a regression in the net-worth definition or the representative-filing pick
// misstates a public figure's declared wealth — the most defamation-sensitive number
// on the page. These assert the invariants against the resolved corpus.
//
// Auto-skips when Postgres is down or the matview is empty — like the other
// *.data.test.ts gates, so CI (no container) skips it.
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

// net_eur = (every non-debt category) − debt, exactly as src/lib/declarations.ts
// declarationTotals computes it. Re-derive from the child rows and compare.
test.skipIf(skip)("net_eur equals non-debt assets minus debt", async () => {
  const bad = await allRows<{ person_id: string; period_year: number }>(
    `SELECT w.person_id, w.period_year
       FROM person_wealth_year w
       JOIN LATERAL (
         SELECT
           COALESCE(SUM(value_eur) FILTER (WHERE category <> 'debt'), 0) a,
           COALESCE(SUM(value_eur) FILTER (WHERE category =  'debt'), 0) d
           FROM declaration_asset WHERE declaration_id = w.declaration_id
       ) t ON true
      WHERE round(w.assets_eur) <> round(t.a)
         OR round(w.debts_eur)  <> round(t.d)
         OR round(w.net_eur)    <> round(t.a - t.d)
      LIMIT 5`,
  );
  assert.equal(bad.length, 0, `net worth mismatch: ${JSON.stringify(bad)}`);
});

// One row per (person, year): the matview must collapse multiple filings in a year
// to the single representative snapshot, not emit one row per filing.
test.skipIf(skip)("one wealth row per person-year", async () => {
  const dups = await allRows<{ person_id: string; period_year: number }>(
    `SELECT person_id, period_year FROM person_wealth_year
      GROUP BY person_id, period_year HAVING count(*) > 1 LIMIT 5`,
  );
  assert.equal(
    dups.length,
    0,
    `duplicate person-year: ${JSON.stringify(dups)}`,
  );
});

// The representative filing for a year must be the LATEST asset-bearing one — so a
// year is never represented by an empty incompatibility (Other) filing when an
// asset-bearing filing exists that year.
test.skipIf(skip)(
  "the representative filing bears assets whenever the year has one that does",
  async () => {
    const bad = await allRows<{ person_id: string; year: number }>(
      `SELECT w.person_id, w.period_year AS year
         FROM person_wealth_year w
        WHERE NOT EXISTS (
                SELECT 1 FROM declaration_asset a
                 WHERE a.declaration_id = w.declaration_id)
          AND EXISTS (
                SELECT 1 FROM declaration d
                  JOIN declaration_asset a ON a.declaration_id = d.declaration_id
                 WHERE d.person_id = w.person_id
                   AND COALESCE(d.fiscal_year, d.declaration_year)
                         = w.period_year)
        LIMIT 5`,
    );
    assert.equal(
      bad.length,
      0,
      `year represented by an assetless filing despite an asset-bearing one: ${JSON.stringify(bad)}`,
    );
  },
);

// The serving function is public-safe and well-formed: a known public figure's
// series is non-empty and ascending by year.
test.skipIf(skip)(
  "person_wealth_series returns an ascending series",
  async () => {
    // Иван Петев Демерджиев — the audit's worked example (mp-5104), an executive
    // filer whose Vacate carries 25 asset rows.
    const [row] = await allRows<{ s: { series: { year: number }[] } }>(
      "SELECT person_wealth_series('mp-5104') AS s",
    );
    const years = (row?.s?.series ?? []).map((p) => p.year);
    assert.ok(years.length > 0, "expected a non-empty series for mp-5104");
    const sorted = [...years].sort((a, b) => a - b);
    assert.deepEqual(years, sorted, "series must be ascending by year");
  },
);

// declaration_detail(id) takes an enumerable bigserial, so it MUST enforce the
// §6 gate itself — an unresolved (person_id NULL) or non-public subject's filing
// must not be served even when its id is guessed.
test.skipIf(skip)(
  "declaration_detail is gated on a public, resolved person",
  async () => {
    // An unresolved filing (person_id NULL) — the id exists, the person does not.
    const [orphan] = await allRows<{ declaration_id: string }>(
      "SELECT declaration_id FROM declaration WHERE person_id IS NULL LIMIT 1",
    );
    if (orphan) {
      const [row] = await allRows<{ r: unknown }>(
        "SELECT declaration_detail($1) AS r",
        [orphan.declaration_id],
      );
      assert.equal(
        row?.r ?? null,
        null,
        "an unresolved filing must not be served",
      );
    }
    // A resolved, public filing IS served — the gate is not over-broad.
    const [ok] = await allRows<{ declaration_id: string }>(
      `SELECT d.declaration_id FROM declaration d
       JOIN person p ON p.person_id = d.person_id
      WHERE p.is_public_figure AND p.status = 'active' LIMIT 1`,
    );
    if (ok) {
      const [row] = await allRows<{ r: { id: number } | null }>(
        "SELECT declaration_detail($1) AS r",
        [ok.declaration_id],
      );
      assert.equal(
        row?.r?.id,
        Number(ok.declaration_id),
        "a public person's filing must be served",
      );
    }
  },
);

// A private (non-public) person must never be served, even by a valid slug — the
// §6 privacy gate, mirrored from person_by_slug.
test.skipIf(skip)("the series never serves a non-public person", async () => {
  const [priv] = await allRows<{ slug: string }>(
    `SELECT slug FROM person WHERE NOT is_public_figure AND slug IS NOT NULL LIMIT 1`,
  );
  if (!priv) return; // no private persons in this corpus — nothing to prove
  const [row] = await allRows<{ s: { series: unknown[] } }>(
    "SELECT person_wealth_series($1) AS s",
    [priv.slug],
  );
  // pick found nothing → the function returns SQL NULL, or an empty series.
  assert.ok(
    row?.s == null || (row.s.series ?? []).length === 0,
    "a non-public person's wealth series must be empty",
  );
});
