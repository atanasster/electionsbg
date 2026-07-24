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

// The view and the predicate must agree BOTH WAYS — the feature reads one, its tests the
// other, and a drift either direction lets a page render a gap for a person the other side
// would have excluded. The earlier version asserted only function ⊆ view, and papered over
// the missing privacy gate by adding is_public_figure to the QUERY rather than the function.
test.skipIf(skip)("the view and the predicate agree, both ways", async () => {
  const [{ n: fnNotView }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM person p
      WHERE person_is_accountability_senior(p.person_id)
        AND NOT EXISTS (SELECT 1 FROM accountability_senior a
                         WHERE a.person_id = p.person_id)`,
  );
  assert.equal(
    Number(fnNotView),
    0,
    "function includes a person the view omits",
  );
  const [{ n: viewNotFn }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM accountability_senior a
      WHERE NOT person_is_accountability_senior(a.person_id)`,
  );
  assert.equal(
    Number(viewNotFn),
    0,
    "view includes a person the function excludes",
  );
});

// THE PRIVACY GATE. A status='review' person is an unadjudicated identity merge (081) —
// publishing an enrichment figure built from two provisionally-merged people is the exact
// harm this gate exists to prevent. Neither side may admit one, nor a non-public person.
test.skipIf(skip)("the cohort admits only active, public persons", async () => {
  const [{ n: bad }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM person p
      WHERE person_is_accountability_senior(p.person_id)
        AND (p.status <> 'active' OR NOT p.is_public_figure)`,
  );
  assert.equal(
    Number(bad),
    0,
    "the predicate admits a review-status or non-public person",
  );
  const [{ n: badView }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM accountability_senior a
       JOIN person p ON p.person_id = a.person_id
      WHERE p.status <> 'active' OR NOT p.is_public_figure`,
  );
  assert.equal(
    Number(badView),
    0,
    "the view lists a review-status or non-public person",
  );
});

// qualifying_office must be deterministic: a person holding BOTH a cabinet and a
// deputy-minister role ties on source, and without the role rung DISTINCT ON picks
// arbitrarily — the caption would flip between deploys with no data change.
test.skipIf(skip)(
  "a minister who was also a deputy minister captions as minister",
  async () => {
    const rows = await allRows<{ qualifying_office: string }>(
      `SELECT a.qualifying_office FROM accountability_senior a
        WHERE EXISTS (SELECT 1 FROM person_role r WHERE r.person_id = a.person_id
                       AND r.source = 'official_exec' AND r.role = 'cabinet')
          AND EXISTS (SELECT 1 FROM person_role r WHERE r.person_id = a.person_id
                       AND r.source = 'official_exec' AND r.role = 'deputy_minister')
          AND NOT EXISTS (SELECT 1 FROM person_role r WHERE r.person_id = a.person_id
                           AND r.source IN ('mp', 'magistrate'))
        LIMIT 5`,
    );
    for (const r of rows) {
      assert.equal(
        r.qualifying_office,
        "minister",
        "the higher office must win the caption, deterministically",
      );
    }
  },
);
