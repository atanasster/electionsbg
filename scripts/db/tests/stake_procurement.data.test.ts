// Correctness gate for declared stakes → public contracts (096).
//
// This surface publishes "this named official's company holds public contracts" off a
// declaration form THAT CARRIES NO EIK, so every link is inferred. A wrong inference is a
// fabricated conflict of interest attached to a real person's name. The controls below are
// therefore about the RESOLUTION being sound, not about the arithmetic being pretty.
//
// They deliberately assert against the LIVE CORPUS through the shipped functions rather
// than against hand-computed constants. The rejected T3.7 per-m² work carried five unit
// tests that all passed while every defect was live, precisely because they re-implemented
// the arithmetic instead of interrogating the pipeline's output. See the T3.7 note in
// docs/plans/persons-declarations-audit-v1.md.
//
// Auto-skips when Postgres is down or the stakes are not loaded.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.declaration_stake_company') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_stake_company",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / no resolved stakes";

afterAll(async () => {
  await end();
});

// GATE B is the load-bearing one: the whole defensibility of this surface rests on the
// Търговски регистър independently placing the person at the EIK. If a refactor ever lets
// a name-only match through, this catches it before it reaches a name on the site.
test.skipIf(skip)(
  "every resolved link is independently confirmed by the TR",
  async () => {
    const [r] = await allRows<{ n: string }>(`
      SELECT count(*) n
        FROM declaration_stake_company sc
        JOIN person p ON p.person_id = sc.person_id
       WHERE NOT EXISTS (SELECT 1 FROM tr_person_roles r
                          WHERE r.uic = sc.uic AND r.name_fold = p.name_fold)
         AND NOT EXISTS (SELECT 1 FROM tr_officers o
                          WHERE o.uic = sc.uic AND o.name_fold = p.name_fold)
    `);
    assert.equal(
      Number(r.n),
      0,
      "a stake→company link survived without TR confirmation — gate B is not holding",
    );
  },
);

// GATE A: an ambiguous company name must be DROPPED, never resolved to an arbitrary match.
// Asserted against tr_companies itself, so it fails if the normaliser ever starts folding
// two distinct companies onto one key.
test.skipIf(skip)(
  "no resolved company name is ambiguous in the TR",
  async () => {
    // One pass over tr_companies, grouped, then a hash join — NOT a per-name correlated
    // subquery, which seq-scans 1M rows once per name and times the gate out.
    const bad = await allRows<{ company_name: string; hits: string }>(`
      WITH resolved AS (
        SELECT DISTINCT company_name, declared_company_norm(company_name) AS norm
          FROM declaration_stake_company
      ),
      tr AS (
        SELECT declared_company_norm(name) AS norm, count(*) AS hits
          FROM tr_companies
         WHERE declared_company_norm(name) IN (SELECT norm FROM resolved)
         GROUP BY 1
      )
      SELECT r.company_name, COALESCE(tr.hits, 0) AS hits
        FROM resolved r LEFT JOIN tr USING (norm)
    `);
    const ambiguous = bad.filter((b) => Number(b.hits) !== 1);
    assert.deepEqual(
      ambiguous.map((a) => a.company_name),
      [],
      "an ambiguous company name was resolved — gate A is not holding",
    );
  },
);

// The raw parse must stay a faithful record of the XML. The form has no EIK column, so a
// non-NULL uic in declaration_stake means inference leaked back into the source table.
test.skipIf(skip)(
  "the inferred EIK never leaks into declaration_stake",
  async () => {
    const [r] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_stake WHERE uic IS NOT NULL",
    );
    assert.equal(
      Number(r.n),
      0,
      "declaration_stake.uic was written — inference must stay in the derived layer",
    );
  },
);

// THE TIME ALIGNMENT, checked through the shipped function on every person it returns
// rows for. whileDeclaredEur is a subset of totalEur by construction; if it ever exceeds
// it, the year filter is matching contracts the person did not hold the stake for.
test.skipIf(skip)(
  "whileDeclaredEur never exceeds totalEur, on every person served",
  async () => {
    const rows = await allRows<{
      slug: string;
      company_name: string;
      while_declared: number;
      total: number;
    }>(`
      -- MATERIALIZED is load-bearing: inlined, the planner is free to evaluate the
      -- function for all ~58k persons and only then filter, turning a 4ms serving call
      -- into a multi-minute scan. Pin the person set first, then call.
      WITH target AS MATERIALIZED (
        SELECT DISTINCT p.slug
          FROM declaration_stake_company sc
          JOIN person p ON p.person_id = sc.person_id
      )
      SELECT t.slug,
             (e ->> 'companyName') AS company_name,
             (e ->> 'whileDeclaredEur')::numeric AS while_declared,
             (e ->> 'totalEur')::numeric AS total
        FROM target t
        CROSS JOIN LATERAL jsonb_array_elements(person_stake_procurement(t.slug)) e
    `);
    assert.ok(
      rows.length > 0,
      "no person served any stake rows — fixture is empty",
    );
    const broken = rows.filter(
      (r) => Number(r.while_declared) > Number(r.total),
    );
    assert.deepEqual(
      broken.map((b) => `${b.slug}/${b.company_name}`),
      [],
      "aligned spend exceeded lifetime spend — the stake-year filter is wrong",
    );
  },
);

// §6 PRIVACY GATE. A person who is not active + public must get an empty payload even
// though the matview holds their rows — the gate lives in the serving function.
test.skipIf(skip)(
  "the serving function enforces the privacy gate",
  async () => {
    const hidden = await allRows<{ slug: string; r: unknown[] }>(`
    WITH target AS MATERIALIZED (
      SELECT DISTINCT p.slug
        FROM declaration_stake_company sc
        JOIN person p ON p.person_id = sc.person_id
       WHERE p.status <> 'active' OR NOT p.is_public_figure
       LIMIT 50
    )
    SELECT t.slug, person_stake_procurement(t.slug) AS r FROM target t
  `);
    const leaked = hidden.filter((h) => (h.r as unknown[]).length > 0);
    assert.deepEqual(
      leaked.map((l) => l.slug),
      [],
      "a non-public / non-active person was served stake rows",
    );
  },
);
