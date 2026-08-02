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
test.skipIf(skip)("matches the canonical broad-money UNION spec", async () => {
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
      WHERE m.eik IS NULL OR i.eik IS NULL
         OR m.public_money_eur IS DISTINCT FROM i.eur`,
  );
  assert.equal(
    drift,
    0,
    `${drift} eik(s) differ between company_public_money and the inline 120/resolve basis`,
  );
});
