// The editorial gate for the accumulation-gap metric (091_accountability_gate.sql). The
// cohort it defines is a defamation control: computing a declared-vs-audited discrepancy
// for the wrong person is exactly the harm the gate exists to prevent, so these pin the
// boundary — MPs/ministers/mayors/magistrates in, councillors and lower officials out.
// See docs/methodology/accumulation-gap.md.
//
// Auto-skips when Postgres is down or unresolved — like the other *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.accountability_senior') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person WHERE is_public_figure",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / person table empty";

afterAll(async () => {
  await end();
});

// A municipal councillor whose ONLY office is the council seat must NOT be in the cohort —
// this is the exclusion the whole gate is for.
test.skipIf(skip)("municipal councillors are excluded", async () => {
  const bad = await allRows<{ slug: string }>(
    `SELECT p.slug FROM person p
      WHERE person_is_accountability_senior(p.person_id)
        AND EXISTS (SELECT 1 FROM person_role r
                     WHERE r.person_id = p.person_id
                       AND r.source = 'official_muni' AND r.role = 'councillor')
        AND NOT EXISTS (SELECT 1 FROM person_role r
                         WHERE r.person_id = p.person_id
                           AND (r.source = 'mp'
                             OR (r.source = 'official_exec' AND r.role IN ('cabinet','deputy_minister'))
                             OR (r.source = 'official_muni' AND r.role = 'mayor')
                             OR r.source = 'magistrate'))
      LIMIT 5`,
  );
  assert.equal(
    bad.length,
    0,
    `councillor(s) wrongly in the cohort: ${JSON.stringify(bad)}`,
  );
});

// A deputy mayor / chief architect is NOT a mayor — only the mayor role qualifies under
// official_muni.
test.skipIf(skip)("only mayors qualify under the municipal tier", async () => {
  const bad = await allRows<{ slug: string }>(
    `SELECT p.slug FROM person p
      WHERE person_is_accountability_senior(p.person_id)
        AND NOT EXISTS (SELECT 1 FROM person_role r
                         WHERE r.person_id = p.person_id
                           AND (r.source = 'mp'
                             OR (r.source = 'official_exec' AND r.role IN ('cabinet','deputy_minister'))
                             OR (r.source = 'official_muni' AND r.role = 'mayor')
                             OR r.source = 'magistrate'))
      LIMIT 5`,
  );
  assert.equal(
    bad.length,
    0,
    `non-qualifying person in cohort: ${JSON.stringify(bad)}`,
  );
});

// The cohort must actually contain the senior offices — a gate that excludes everyone is
// as broken as one that includes everyone.
test.skipIf(skip)(
  "the cohort contains MPs, ministers, mayors and magistrates",
  async () => {
    const offices = await allRows<{ qualifying_office: string; n: string }>(
      "SELECT qualifying_office, count(*) n FROM accountability_senior GROUP BY 1",
    );
    const byOffice = new Map(
      offices.map((o) => [o.qualifying_office, Number(o.n)]),
    );
    for (const office of [
      "mp",
      "minister",
      "deputy_minister",
      "mayor",
      "magistrate",
    ]) {
      assert.ok(
        (byOffice.get(office) ?? 0) > 0,
        `no ${office} in the accountability cohort`,
      );
    }
  },
);

// The convenience view and the function must agree on membership — the feature reads one,
// its tests the other, and a drift between them would let a page render a gap for a person
// the function would have excluded.
test.skipIf(skip)(
  "the view and the predicate agree on membership",
  async () => {
    const [{ n }] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person p
      WHERE person_is_accountability_senior(p.person_id) AND p.is_public_figure
        AND NOT EXISTS (SELECT 1 FROM accountability_senior a WHERE a.person_id = p.person_id)`,
    );
    assert.equal(Number(n), 0, "function includes a person the view omits");
  },
);
