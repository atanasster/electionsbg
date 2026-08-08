// company_public_money (127) — the ONE reusable per-eik broad money basis (contracts ∪
// agri_subsidies ∪ fund_beneficiaries), extracted from the UNION inlined in 120_person_browse.sql
// (nf_company) and resolve_persons.ts (money_eik). The connections graph (128) reads it for money
// on every company node. Plan: docs/plans/connections-engine-v1.md §P3.1.
//
// The failure this pins: this matview drifting from the CANONICAL broad-money UNION spec — a
// company node would then carry different money than the /persons browser and the Tier-V selection,
// the exact "two money bases" bug the person layer took pains to avoid. (127 EXTRACTS the basis
// additively; it does not yet REPLACE the inline copies in 120/resolve — see the 127 header.)
//
// Auto-skips when Postgres is down or the matview is unbuilt — like the other *.data.test.ts gates.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end, pinLocalDatabase } from "../lib/pg";

pinLocalDatabase();

const state = async (): Promise<"ok" | "no-server" | "missing" | "empty"> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.company_public_money') IS NOT NULL AS ok",
    );
    if (!t?.ok) return "missing";
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM company_public_money",
    );
    return Number(c.n) > 0 ? "ok" : "empty";
  } catch {
    return "no-server";
  }
};

const dbState = await state();
const skip = dbState === "no-server" || dbState === "missing" ? true : false;

const count = async (sql: string, params: unknown[] = []): Promise<number> => {
  const [r] = await allRows<{ n: string }>(sql, params);
  return Number(r.n);
};

afterAll(async () => {
  await end();
});

// It is populated to the expected order of magnitude (~81k companies that ever took public money).
test.skipIf(skip)("company_public_money is populated", async () => {
  const n = await count("SELECT count(*) n FROM company_public_money");
  assert.ok(n > 40000, `only ${n} companies (expected ~81k)`);
});

// RECONCILIATION — the top-money eiks must equal the direct contracts∪subsidies∪funds sum. Sampled
// over the largest figures, where a basis difference is both most likely and most damaging.
test.skipIf(skip)(
  "public_money_eur equals the contracts∪subsidies∪funds sum",
  async () => {
    const rows = await allRows<{ eik: string; mv: number; direct: number }>(
      `WITH sample AS (
         SELECT eik, public_money_eur FROM company_public_money
          ORDER BY public_money_eur DESC LIMIT 25
       )
       SELECT s.eik,
              s.public_money_eur AS mv,
              (
                coalesce((SELECT sum(amount_eur) FROM contracts
                           WHERE contractor_eik = s.eik AND tag='contract'
                             AND consortium_role IS DISTINCT FROM 'member'), 0)
              + coalesce((SELECT sum(total_eur) FROM agri_subsidies WHERE eik = s.eik), 0)
              + coalesce((SELECT sum(paid_eur)  FROM fund_beneficiaries WHERE eik = s.eik), 0)
              ) AS direct
         FROM sample s`,
    );
    assert.ok(rows.length > 0, "no companies to reconcile");
    // Compared as NUMBERS at cent precision — the matview ROUNDs to 2dp, the direct sum does not.
    for (const r of rows)
      assert.ok(
        Math.abs(Number(r.mv) - Number(r.direct)) < 1,
        `${r.eik}: matview ${r.mv} vs direct ${r.direct} — the broad-money basis drifted`,
      );
  },
);

// It matches the CANONICAL broad-money UNION spec, eik-for-eik. This re-derives the UNION and
// FULL-JOINs it, so it catches (a) a STALE matview (REFRESH not run after a contracts change) and
// (b) an edit to 127 that diverges from the spec. It CANNOT catch a change to 120's `nf_company`
// inline copy — 120's basis is an inline expression inside a matview, not a queryable object — so
// while 120/resolve keep their own copies (see the 127 header, "ADDITIVE for now"), the guard
// against those three drifting apart is that they are byte-identical text, not this test. The true
// single-source fix is the deferred 120/resolve→JOIN refactor.
//
// THE FOURTH (INTERREG) ARM DELIBERATELY BREAKS THAT BYTE-IDENTITY, so this test now pins TWO
// things instead of one. 127 gained `interreg_partners.budget_eur`; the inline copies did NOT.
// There are THREE of them, not the two 127's header names — 120's `nf_company`,
// resolve_persons' `money_eik`, and load_person_search_pg.ts's own `money_eik` — and since the
// entire drift defence IS "the text is identical", an uncounted copy is the precise failure that
// note exists to prevent.
//
// Widening them is a separate decision with a different blast radius: `money_eik` decides who
// counts as money-linked at Tier V, so an arm there changes WHICH PEOPLE are published, not merely
// a figure. The observable consequence of leaving them: the ~71 companies whose ONLY public money
// is Interreg carry money on graph_company_node while person_search classifies their officers as
// money-less, so a person can appear on /connections with a figure and be absent from the
// money-linked tier everywhere else.
//
// Both bases are therefore asserted: the THREE-arm subtotal still equals the inline basis
// (120/resolve/person_search remain correct for their own definition), and the Interreg column
// equals its own scoped source.
test.skipIf(skip)("matches the canonical broad-money UNION spec", async () => {
  // The three-arm basis — still byte-identical to 120's nf_company and
  // resolve_persons' money_eik — must equal public_money_eur MINUS the Interreg
  // column. A drift here means 127 changed one of the shared arms.
  const drift = await count(
    `WITH inline AS (
       SELECT eik, round(sum(eur)::numeric, 2)::double precision AS eur FROM (
         SELECT contractor_eik AS eik, amount_eur AS eur FROM contracts
          WHERE contractor_eik <> '' AND tag='contract' AND consortium_role IS DISTINCT FROM 'member'
         UNION ALL SELECT eik, total_eur FROM agri_subsidies     WHERE eik IS NOT NULL
         UNION ALL SELECT eik, paid_eur  FROM fund_beneficiaries WHERE eik IS NOT NULL
       ) x WHERE eur IS NOT NULL GROUP BY eik
     )
     SELECT count(*) n FROM company_public_money m
       FULL JOIN inline i ON i.eik = m.eik
      -- PRESENCE is tested by presence, never by amount: 3,520 matview rows sum
      -- to exactly 0, and an "AND eur <> 0" guard would stop flagging a MISSING
      -- one — losing the staleness detection this test exists for.
      WHERE m.eik IS NULL
         -- An eik present ONLY in the matview is legitimate now — a company
         -- whose sole public money is Interreg has no row in the three-arm
         -- basis — but only if its three-arm REMAINDER is zero. Testing
         -- "interreg_eur > 0" instead would let a stale contract ride along
         -- unnoticed on any company that also has Interreg money.
         OR (i.eik IS NULL
             AND abs(m.public_money_eur - m.interreg_eur) > 0.011)
         -- 0.011, not exact: the remainder subtracts two independently-rounded
         -- doubles, so a legitimate 1-cent gap is reachable (10.004 + 20.004 →
         -- 30.01 - 20.00 = 10.01 against a 10.00 three-arm sum). Measured gap
         -- today is 0.00; the tolerance is against a future corpus, and is far
         -- below any real drift.
         OR (m.eik IS NOT NULL AND i.eik IS NOT NULL
             AND abs((m.public_money_eur - m.interreg_eur) - i.eur) > 0.011)`,
  );
  assert.equal(
    drift,
    0,
    `${drift} eik(s) differ between company_public_money's shared arms and the inline 120/resolve basis`,
  );

  // And the Interreg column must equal its own source, scoped to Bulgaria. The
  // scope is the point: `interreg_partners.eik` is a NAMESPACE holding whatever
  // national id each country published — 321 foreign values are exactly nine
  // digits and two collide with a live tr_companies.uic — so an unscoped arm
  // would publish a Georgian body's budget as a Bulgarian company's public
  // money. interreg_by_eik shipped without this predicate once.
  const hasInterreg = await count(
    `SELECT count(*) n FROM pg_class
      WHERE oid = to_regclass('public.interreg_partners')`,
  );
  if (hasInterreg === 0) return; // a database before 137: the arm is empty by design
  const armDrift = await count(
    `WITH src AS (
       SELECT eik, round(sum(budget_eur)::numeric, 2)::double precision AS eur
         FROM interreg_partners
        WHERE eik IS NOT NULL
          AND (country = 'Bulgaria' OR country_department = 'Bulgaria')
          AND budget_eur IS NOT NULL
        GROUP BY eik
     )
     SELECT count(*) n FROM company_public_money m
       FULL JOIN src s ON s.eik = m.eik
      WHERE (s.eik IS NOT NULL AND abs(COALESCE(m.interreg_eur, -1) - s.eur) > 0.011)
         OR (s.eik IS NULL AND COALESCE(m.interreg_eur, 0) <> 0)`,
  );
  assert.equal(armDrift, 0, `${armDrift} eik(s) differ on the Interreg arm`);

  // THE COLLIDERS, named. `interreg_partners.eik` holds every country's national
  // id: 321 foreign values are exactly nine digits and two of them ARE live
  // Bulgarian company UICs. Without the country predicate this matview would
  // publish a Georgian body's budget as a Bulgarian company's public money —
  // which interreg_by_eik shipped once, so it is a regression, not a hypothesis.
  const georgian = await count(
    `SELECT count(*) n FROM company_public_money
      WHERE eik IN ('204426451', '204911337') AND interreg_eur <> 0`,
  );
  assert.equal(
    georgian,
    0,
    "a foreign national id was attributed Interreg money",
  );

  // Floors on the arm itself. The re-derivation above follows the matview into
  // any shared spec change; a floor does not, so it is what catches an arm that
  // silently stopped contributing.
  const armRows = await count(
    `SELECT count(*) n FROM company_public_money WHERE interreg_eur > 0`,
  );
  assert.ok(armRows > 150, `only ${armRows} companies carry Interreg money`);
  const armSum = await count(
    `SELECT round(sum(interreg_eur))::bigint n FROM company_public_money`,
  );
  assert.ok(armSum > 90_000_000, `the Interreg arm is only €${armSum}`);

  // NULL is not a value here: the column is COALESCEd to 0, so a consumer doing
  // `public_money_eur - interreg_eur` never gets NULL.
  const nulls = await count(
    `SELECT count(*) n FROM company_public_money WHERE interreg_eur IS NULL`,
  );
  assert.equal(nulls, 0, "interreg_eur should be 0, never NULL");

  // The ceiling, asserted so a source change that starts publishing 2014-2020
  // national ids is NOTICED — every "Tier L only" caption on the site is
  // calibrated on this arm covering the later period alone.
  const older = await count(
    `SELECT count(*) n FROM interreg_partners p
       JOIN interreg_operations o USING (keep_id)
      WHERE p.eik IS NOT NULL AND o.period = '2014-2020'
        AND (p.country = 'Bulgaria' OR p.country_department = 'Bulgaria')`,
  );
  assert.equal(
    older,
    0,
    "keep.eu is now publishing 2014-2020 national ids — the Tier L ceiling moved",
  );
});
