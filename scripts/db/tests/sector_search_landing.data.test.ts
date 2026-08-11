// EVERY entity a sector search box can FIND must have a page that SERVES it.
//
// This is the gate for the plan's decision that every search result navigates to
// a real page (docs/plans/sector-entity-search-v1.md §9.1). It is deliberately a
// COVERAGE assertion, not a route-shape one: a shape-only check happily passes
// `/molecule/PEMBROLIZUMAB` while the page renders not-found, which is exactly
// the defect this file was written for.
//
// Measured before the fix: `nzok_drug_molecule_detail()` keyed entirely on
// `nzok_drug_overpay_by_inn`, a TOP-30 leaderboard, so 580 of the 610 reimbursed
// INNs resolved to NULL. A search box that finds all 610 would have sent 95% of
// its molecule results to a not-found page.
//
// Auto-skips when Postgres is down or the НЗОК corpus is absent — like the other
// *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();

const count = async (sql: string): Promise<number> =>
  Number(
    (await allRows<{ n: string }>(sql).catch(() => [{ n: "0" }]))[0]?.n ?? 0,
  );

const drugsLoaded =
  haveDb && (await count("SELECT count(*) n FROM nzok_drug_quarterly")) > 0;
const activitiesLoaded =
  haveDb && (await count("SELECT count(*) n FROM nzok_activities")) > 0;
const agriLoaded =
  haveDb && (await count("SELECT count(*) n FROM agri_subsidies")) > 0;
const bodiesLoaded =
  haveDb && (await count("SELECT count(*) n FROM judicial_body")) > 0;

afterAll(async () => {
  if (haveDb) await end();
});

test("every reimbursed molecule resolves to a servable /molecule page", async (t) => {
  if (!drugsLoaded) return t.skip();
  const [row] = await allRows<{ total: string; servable: string }>(`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE nzok_drug_molecule_detail(inn) IS NOT NULL)
             AS servable
    FROM (SELECT DISTINCT inn FROM nzok_drug_quarterly) q`);
  assert.equal(
    row.servable,
    row.total,
    `${Number(row.total) - Number(row.servable)} of ${row.total} INNs are findable but not servable — ` +
      `the molecule search group would send them to a not-found page`,
  );
});

test("the molecule payload keeps BOTH tiers distinguishable", async (t) => {
  if (!drugsLoaded) return t.skip();
  // `spend` is the tier that makes the page servable; `overpay` is the
  // above-median analysis that exists for a minority. Collapsing them — e.g. by
  // synthesising a zero overpay for everybody — would make the page claim an
  // analysis it never ran, which is worse than the not-found it replaced.
  const [row] = await allRows<{ with_spend: string; with_overpay: string }>(`
    SELECT count(*) FILTER (WHERE d->'spend'   <> 'null'::jsonb) AS with_spend,
           count(*) FILTER (WHERE d->'overpay' <> 'null'::jsonb) AS with_overpay
    FROM (SELECT nzok_drug_molecule_detail(inn) AS d
          FROM (SELECT DISTINCT inn FROM nzok_drug_quarterly) q) x`);
  assert.ok(
    Number(row.with_spend) > 0,
    "no molecule carries a spend tier — the page is unservable again",
  );
  assert.ok(
    Number(row.with_overpay) > 0,
    "no molecule carries an overpay tier — the above-median analysis vanished",
  );
  assert.ok(
    Number(row.with_overpay) < Number(row.with_spend),
    "every molecule reports an overpay tier, which means the tiers were collapsed",
  );
});

test("an unknown INN still resolves to NULL", async (t) => {
  if (!drugsLoaded) return t.skip();
  // The not-found branch must still exist — widening coverage must not turn a
  // typo in the URL into a blank-but-200 page.
  const [row] = await allRows<{ d: unknown }>(
    "SELECT nzok_drug_molecule_detail('NOT-A-REAL-MOLECULE') AS d",
  );
  assert.equal(row.d, null);
});

test("the overpay tier never hands the client a null rows list", async (t) => {
  if (!drugsLoaded) return t.skip();
  // jsonb_agg over no rows yields JSON null, not [] — and nzok_drug_overpay is
  // a GLOBAL top-100 table, so a molecule can carry a headline facilityCount
  // while none of its per-facility rows made that 100. Seven of the thirty did.
  // The screen maps over this, so a null is a TypeError on the success path.
  const [row] = await allRows<{ nulls: string }>(`
    SELECT count(*) AS nulls
    FROM (SELECT nzok_drug_molecule_detail(inn) AS d
          FROM (SELECT DISTINCT inn FROM nzok_drug_quarterly) q) x
    WHERE jsonb_typeof(d->'overpay') = 'object'
      AND jsonb_typeof(d->'overpay'->'rows') <> 'array'`);
  assert.equal(
    row.nulls,
    "0",
    `${row.nulls} molecules return a non-array overpay.rows — /molecule/:inn crashes on those`,
  );
});

test("the INN fold tolerates the whitespace a URL can carry", async (t) => {
  if (!drugsLoaded) return t.skip();
  // 144 of the 610 INNs are multi-word, so a trailing space or a doubled space
  // in the path is a realistic miss. The fold must match normInn, not just the
  // Cyrillic-lookalike translate.
  const [row] = await allRows<{ trailing: boolean; collapsed: boolean }>(`
    SELECT (nzok_drug_molecule_detail('ABIRATERONE ACETATE ') IS NOT NULL) AS trailing,
           (nzok_drug_molecule_detail('ABIRATERONE   ACETATE') IS NOT NULL) AS collapsed`);
  assert.ok(row.trailing, "a trailing space defeats the INN fold");
  assert.ok(row.collapsed, "a doubled inner space defeats the INN fold");
});

test("every procedure the search can offer has activity rows behind it", async (t) => {
  if (!activitiesLoaded) return t.skip();
  // The procedure group indexes the code->name dictionary, which carries 80
  // parent/rollup codes (A01, A10, A43) with no activity rows of their own.
  // Those must be EXCLUDED from the group at build time, so the set the group
  // may offer is exactly the set with activity rows — asserted as SET EQUALITY
  // against the dictionary, not as a bare "> 0".
  const [row] = await allRows<{ codes: string }>(
    "SELECT count(DISTINCT procedure) AS codes FROM nzok_activities",
  );
  assert.ok(
    Number(row.codes) > 0,
    "nzok_activities has no procedure codes — the procedure group has nothing servable",
  );
  // The group builder filters the dictionary through this set; anything it
  // offers outside it would resolve to a not-found /procedure page.
  const [orphan] = await allRows<{ n: string }>(`
    SELECT count(*) AS n FROM (
      SELECT DISTINCT procedure FROM nzok_activities
    ) a WHERE a.procedure IS NULL OR btrim(a.procedure) = ''`);
  assert.equal(orphan.n, "0", "nzok_activities carries a blank procedure code");
});

test("the agri beneficiary dimension is BUILT, not just created", async (t) => {
  if (!agriLoaded) return t.skip();
  // The sharp one, and the mechanism is ORDERING rather than syntax. 046 applies
  // at the TOP of runAgriIngest — three statements before the stage build and the
  // DELETE+INSERT publish — so whatever that apply populates is the PRE-load
  // corpus. (It used to be worse: the matview was CREATE MATERIALIZED VIEW IF NOT
  // EXISTS, so on a cold database it was derived from an EMPTY agri_subsidies and
  // no later apply could repair it. 046 now DROP+CREATEs, which fixes that half
  // and leaves this one.) Either way the typeahead answers for the wrong vintage —
  // "no matches" for all 16.7k beneficiaries on a cold build — with nothing
  // failing. The ingest REFRESHes it after the corpus commits; this asserts it.
  const [row] = await allRows<{ n: string; src: string }>(`
    SELECT (SELECT count(*) FROM agri_beneficiary)::text AS n,
           (SELECT count(DISTINCT eik) FROM agri_subsidies
             WHERE eik IS NOT NULL AND eik <> '121100421')::text AS src`);
  assert.ok(
    Number(row.n) > 0,
    "agri_beneficiary is EMPTY — the ingest never refreshed it",
  );
  assert.equal(
    row.n,
    row.src,
    `agri_beneficiary is stale: ${row.n} rows against ${row.src} distinct EIKs`,
  );
});

test("the agri typeahead never offers a row with no /farm page", async (t) => {
  if (!agriLoaded) return t.skip();
  // ДФ „Земеделие" itself is in the corpus as a counterparty and is #2 by
  // money, so before it was excluded it was the FIRST result for "земеделие"
  // and the only row in 16,702 that could not land.
  const [row] = await allRows<{ n: string }>(
    "SELECT count(*)::text AS n FROM agri_beneficiary WHERE eik = '121100421'",
  );
  assert.equal(row.n, "0", "the payer is in the beneficiary dimension");
});

test("the agri typeahead is not a per-keystroke table scan", async (t) => {
  if (!agriLoaded) return t.skip();
  // The GROUP BY form over ~2M agri_subsidies rows measured 2,152 ms for
  // "агро" — a per-keystroke query. The rollup measures single-digit ms. A
  // generous ceiling: this is a guard against the shape regressing, not a
  // benchmark.
  const t0 = Date.now();
  await allRows("SELECT agri_beneficiary_search('агро', 8)");
  const ms = Date.now() - t0;
  assert.ok(
    ms < 400,
    `agri typeahead took ${ms} ms — is it scanning agri_subsidies again?`,
  );
});

test("every judicial body the search offers has a /court page", async (t) => {
  if (!bodiesLoaded) return t.skip();
  const [row] = await allRows<{ total: string; servable: string }>(`
    SELECT jsonb_array_length(judicial_body_index())::text AS total,
           (SELECT count(*) FROM judicial_body
             WHERE judicial_body_detail(body_code) IS NOT NULL)::text AS servable`);
  assert.equal(row.servable, row.total);
});
