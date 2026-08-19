// Gates for the ЦПРС licence register (migration 170, plan P2).
//
// The failure this exists to catch is not an empty table — it is a register
// that loaded successfully while saying something false about a named company.
// „Not licensed" and „the register does not say" are different claims, and only
// one of them is safe to publish.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const [{ n } = { n: "0" }] = haveDb
  ? await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM cprs_licence",
    ).catch(() => [{ n: "0" }])
  : [{ n: "0" }];
const skip = !haveDb
  ? "Postgres unreachable"
  : n === "0"
    ? "cprs_licence is empty — run npm run db:load:cprs:pg"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)("the register is whole", async () => {
  const [r] = await allRows<Record<string, string>>(
    `SELECT count(*)::text licences, count(DISTINCT eik)::text firms,
            count(DISTINCT class_code)::text classes
       FROM cprs_licence`,
  );
  // 8,379 firms / 106,508 licences / 49 classes at the 2026-08-19 crawl. A
  // collapse means a partial crawl was loaded, which reads as „these builders
  // hold no licence" — the exact false claim the ingest's completeness guard
  // exists to prevent, asserted here on the served side too.
  assert.ok(
    Number(r.firms) > 5000,
    `only ${r.firms} firms in cprs_licence — the ЦПРС holds ~8,400. A partial ` +
      `crawl was loaded; re-run \`npm run cprs:ingest -- --apply\`.`,
  );
  assert.ok(Number(r.classes) > 20, `only ${r.classes} licence classes`);
});

test.skipIf(skip)(
  "every licence is dated, or the residue is tiny",
  async () => {
    // The DATE is why this register is worth having: without it „did they hold
    // the class on the award date?" is unanswerable. A strict dd.mm.yyyy parse
    // left 36% undated because КСБ mixes „24.04.2025г." / „…2025 г." / „1.9.2018".
    const [r] = await allRows<{ total: string; undated: string }>(
      `SELECT count(*)::text total,
            count(*) FILTER (WHERE first_protocol_date IS NULL)::text undated
       FROM cprs_licence`,
    );
    const share = Number(r.undated) / Number(r.total);
    assert.ok(
      share < 0.01,
      `${r.undated}/${r.total} licences (${(share * 100).toFixed(1)}%) have no ` +
        `date. The parser has probably met a fourth date spelling — check ` +
        `parseProtocol in scripts/procurement/cprs/parse.ts.`,
    );
  },
);

test.skipIf(skip)("оblast is a firm property, not a licence one", async () => {
  // The modelling claim 170's header rests on, re-checked against the data: if
  // a firm ever appeared under two областi, the seat would be a licence-level
  // fact and `cprs_firm.oblast` would be silently picking one at random.
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*)::text n FROM cprs_firm WHERE oblast IS NULL`,
  );
  assert.ok(
    Number(r.n) < 50,
    `${r.n} firms have no област — the seat is meant to be present for all of them`,
  );
});

test.skipIf(skip)("it joins the contracts corpus", async () => {
  // The whole point: an eligibility check needs contractors in both sets.
  const [r] = await allRows<{ n: string }>(
    `SELECT count(DISTINCT c.contractor_eik)::text n
       FROM contracts c JOIN cprs_licence l ON l.eik = c.contractor_eik
      WHERE c.tag = 'contract'`,
  );
  assert.ok(
    Number(r.n) > 1000,
    `only ${r.n} of our contractors join the ЦПРС — expected ~3,000. Either the ` +
      `register or the corpus moved under the join.`,
  );
});

test.skipIf(skip)(
  "cprs_classes_for refuses to certify what the register does not state",
  async () => {
    // ⚠️ THE SAFETY PROPERTY. A NULL date means „the register does not say
    // when", never „licensed since forever" — so an as-of query must EXCLUDE an
    // undated row rather than let it certify eligibility on a date nobody
    // recorded. Verified by construction against a real firm.
    const [firm] = await allRows<{ eik: string; d: string }>(
      `SELECT eik, first_protocol_date::text d FROM cprs_licence
        WHERE first_protocol_date IS NOT NULL AND NOT is_group
        ORDER BY first_protocol_date DESC LIMIT 1`,
    );
    const before = await allRows<{ class_code: string }>(
      "SELECT class_code FROM cprs_classes_for($1, $2::date)",
      [firm.eik, "2007-01-01"],
    );
    const ever = await allRows<{ class_code: string }>(
      "SELECT class_code FROM cprs_classes_for($1, NULL)",
      [firm.eik],
    );
    assert.ok(
      ever.length > before.length,
      `cprs_classes_for(${firm.eik}) returns the same classes as-of 2007 as it ` +
        `does for „ever" — the as-of filter is not binding, so it would certify ` +
        `a licence granted in ${firm.d} as held in 2007.`,
    );
  },
);

test.skipIf(skip)("group headers are excluded from class answers", async () => {
  // A group header (`10`, `20`…) is „licensed somewhere in group 1", not a
  // class. Leaving it in makes a firm hold both „ПЪРВА ГРУПА" and „1.2" and
  // double-counts it in any per-class tally.
  const [firm] = await allRows<{ eik: string }>(
    `SELECT eik FROM cprs_licence WHERE is_group GROUP BY eik LIMIT 1`,
  );
  if (!firm) return;
  const rows = await allRows<{ class_code: string }>(
    "SELECT class_code FROM cprs_classes_for($1, NULL)",
    [firm.eik],
  );
  assert.deepEqual(
    rows.filter((r) => /^[1-7]0$/.test(r.class_code)),
    [],
    "cprs_classes_for returned a group header as a licence class",
  );
});
