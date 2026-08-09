// Postgres gates for `funds_hub_stats()` (migration 145) — the /funds hub's one stat call.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// EVERY ASSERTION CARRIES ITS REJECTED VALUE AS AN EXPLICIT notEqual, and that is the point of
// the file rather than a flourish. The dashboard-hub skill records that a figure gate which
// re-runs the generator's own SQL proves only that the file was freshly written, and inherits
// every misunderstanding it was meant to catch — the declarations hub's first gate did exactly
// that and then PINNED the bug.
//
// So each figure here is re-derived from `fund_projects` INDEPENDENTLY of 145's body, and the
// alternative basis is asserted to be DIFFERENT. A wrong basis is usually one word away from
// the right one, and on this corpus every one of those words is a real number:
//
//   beneficiaries       47 599 by name-or-EIK   NOT 46 174 by EIK        (1 425 apart)
//   absorption          53.8% on grant          NOT 41.1% on contracted  (12.7 pts apart)
//   oblasti             28 folded               NOT 31 raw
//   Interreg partners   983 orgs                NOT 1 493 rows           (52% apart)
//   place money         €22.01 bn placed        NOT €44.07 bn contracted (half the money)
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

interface Stats {
  isun: {
    contractCount: number;
    beneficiaryCount: number;
    beneficiaryCountEikOnly: number;
    programmeCount: number;
    contractedEur: number;
    grantEur: number;
    paidEur: number;
    absorptionPctOfGrant: number;
    absorptionPctOfContracted: number;
    placedContractedEur: number;
    placedMoneyPct: number;
    oblastCount: number;
    settlementCount: number;
  };
  rrf: {
    contractCount: number;
    contractedEur: number;
    absorptionPctOfGrant: number;
  };
  interreg: {
    operationCount: number;
    bgOperationCount: number;
    bgPartnerRowCount: number;
    bgPartnerOrgCount: number;
    bgBudgetEur: number;
  };
}

const stats = async (): Promise<Stats> => {
  const [r] = await allRows<{ r: Stats }>("SELECT funds_hub_stats() AS r");
  assert.ok(
    r?.r,
    "funds_hub_stats() returned NULL — 145 not applied, or the matview is empty",
  );
  return r.r;
};

/** Re-derived from the base table, deliberately NOT by calling 145. */
const truth = async () => {
  const [r] = await allRows<Record<string, string>>(`
    SELECT count(*)::text AS contracts,
           count(DISTINCT COALESCE(beneficiary_eik, 'n:' || beneficiary_name))::text AS benef_any,
           count(DISTINCT beneficiary_eik)::text AS benef_eik,
           count(DISTINCT program_code)::text AS programmes,
           sum(total_eur)::text AS contracted,
           sum(grant_eur)::text AS grant,
           sum(paid_eur)::text AS paid,
           (sum(total_eur) FILTER (WHERE oblast IS NOT NULL))::text AS placed,
           count(DISTINCT oblast)::text AS oblast_raw,
           count(DISTINCT canon_oblast(oblast))::text AS oblast_folded,
           (count(*) FILTER (WHERE oblast IS NULL))::text AS unplaced_rows
      FROM fund_projects`);
  return r;
};

test.skipIf(skip)(
  "beneficiaries are counted EIK-or-NAME, not EIK alone",
  async () => {
    const s = await stats();
    const t = await truth();
    assert.equal(s.isun.beneficiaryCount, Number(t.benef_any));
    // THE rejected basis. 7 240 rows carry no EIK; they collapse onto 1 425 further
    // organisations, so this gap is real and the two numbers are not interchangeable.
    assert.notEqual(
      s.isun.beneficiaryCount,
      Number(t.benef_eik),
      "beneficiaryCount has fallen back to the EIK-only basis — it drops 1 425 organisations",
    );
    assert.equal(s.isun.beneficiaryCountEikOnly, Number(t.benef_eik));
    assert.ok(
      s.isun.beneficiaryCount > s.isun.beneficiaryCountEikOnly,
      "the name-or-EIK count can only be the larger of the two",
    );
  },
);

test.skipIf(skip)(
  "absorption is paid over GRANT, and the contracted basis is a different number",
  async () => {
    const s = await stats();
    const t = await truth();
    const onGrant = (100 * Number(t.paid)) / Number(t.grant);
    const onContracted = (100 * Number(t.paid)) / Number(t.contracted);
    assert.ok(
      Math.abs(s.isun.absorptionPctOfGrant - onGrant) < 0.1,
      `absorptionPctOfGrant ${s.isun.absorptionPctOfGrant} != ${onGrant.toFixed(1)}`,
    );
    assert.ok(Math.abs(s.isun.absorptionPctOfContracted - onContracted) < 0.1);
    // The two must stay far apart: if they ever converge, one of the denominators has been
    // swapped and the gate would otherwise pass on either.
    assert.ok(
      Math.abs(onGrant - onContracted) > 5,
      "the two absorption bases have converged — one denominator is wrong",
    );
    assert.ok(s.isun.absorptionPctOfGrant > s.isun.absorptionPctOfContracted);
  },
);

test.skipIf(skip)(
  "oblast count is FOLDED — Sofia city is one place, not four",
  async () => {
    const s = await stats();
    const t = await truth();
    assert.equal(s.isun.oblastCount, Number(t.oblast_folded));
    assert.equal(s.isun.oblastCount, 28, "Bulgaria has 28 oblasti");
    assert.notEqual(
      s.isun.oblastCount,
      Number(t.oblast_raw),
      "oblastCount is the RAW column — S22/S23/S24/S25 split Sofia city four ways",
    );
  },
);

test.skipIf(skip)(
  "the place figure is the PLACED money, and it is about half the corpus",
  async () => {
    // The row/money inversion this hub's step 1 found. 4.6% of ROWS carry no oblast and they
    // hold 50% of the MONEY, so a place surface that declared row coverage would be telling
    // the truth and misleading the reader.
    const s = await stats();
    const t = await truth();
    assert.ok(Math.abs(s.isun.placedContractedEur - Number(t.placed)) < 1);
    assert.notEqual(
      s.isun.placedContractedEur,
      Number(t.contracted),
      "placedContractedEur is the whole corpus — the unplaced half has leaked in",
    );
    // The share must be published, and it must be the MONEY share rather than the row share.
    const rowShare = 100 * (1 - Number(t.unplaced_rows) / Number(t.contracts));
    assert.ok(
      Math.abs(s.isun.placedMoneyPct - rowShare) > 20,
      `placedMoneyPct ${s.isun.placedMoneyPct} is suspiciously close to the ROW coverage ` +
        `${rowShare.toFixed(1)} — these differ by ~45 points on this corpus, so equality means ` +
        `the money filter was dropped`,
    );
    assert.ok(s.isun.placedMoneyPct > 40 && s.isun.placedMoneyPct < 60);
  },
);

test.skipIf(skip)(
  "Interreg partners are counted as ORGS and as ROWS, and they differ",
  async () => {
    const s = await stats();
    const [t] = await allRows<{ rows: string; orgs: string; budget: string }>(`
    SELECT count(*)::text AS rows,
           count(DISTINCT COALESCE(eik, 'n:' || partner_name))::text AS orgs,
           sum(budget_eur)::text AS budget
      FROM interreg_partners WHERE country = 'Bulgaria'`);
    assert.equal(s.interreg.bgPartnerRowCount, Number(t.rows));
    assert.equal(s.interreg.bgPartnerOrgCount, Number(t.orgs));
    assert.ok(
      s.interreg.bgPartnerRowCount > s.interreg.bgPartnerOrgCount,
      "an organisation on several operations is several rows, so rows > orgs",
    );
    // 52% apart on this corpus. A surface that swaps them over-counts the partner base by half.
    assert.ok(
      s.interreg.bgPartnerRowCount / s.interreg.bgPartnerOrgCount > 1.2,
      "rows and orgs have converged — one of the two counts is wrong",
    );
  },
);

test.skipIf(skip)(
  "the two arms are separate objects with no shared money key",
  async () => {
    // `fund_projects` holds zero Interreg rows and the quantities differ (contract value vs a
    // partner's published budget), so nothing may sum across them. Structurally enforced: if the
    // two objects ever shared a key name, a consumer could add them by reaching for it.
    const s = await stats();
    const shared = Object.keys(s.isun).filter((k) =>
      Object.prototype.hasOwnProperty.call(s.interreg, k),
    );
    assert.deepEqual(
      shared,
      [],
      `isun and interreg share key(s): ${shared.join(", ")}`,
    );
    assert.ok(
      !("contractedEur" in s.interreg),
      "the Interreg arm must not name a contract value",
    );
  },
);

test.skipIf(skip)("the RRF arm declares its own absorption basis", async () => {
  const s = await stats();
  const [t] = await allRows<{
    n: string;
    grant: string;
    paid: string;
    total: string;
  }>(`
    SELECT count(*)::text AS n, sum(grant_eur)::text AS grant,
           sum(paid_eur)::text AS paid, sum(total_eur)::text AS total
      FROM fund_projects WHERE program_code LIKE '2021BG-RRP%'`);
  assert.equal(s.rrf.contractCount, Number(t.n));
  const onGrant = (100 * Number(t.paid)) / Number(t.grant);
  assert.ok(Math.abs(s.rrf.absorptionPctOfGrant - onGrant) < 0.1);
  // Same fork as the corpus figure, and it must not be resolved silently: on grant the RRF is
  // ~30%, on contracted ~21%.
  const onTotal = (100 * Number(t.paid)) / Number(t.total);
  assert.ok(
    Math.abs(onGrant - onTotal) > 5,
    "the RRF absorption bases have converged — one denominator is wrong",
  );
});

test.skipIf(skip)(
  "every ABSOLUTE figure equals its independently derived sum, not merely > 0",
  async () => {
    // The gap the review found: nine figures were gated only by `> 0` and `typeof number`, so a
    // лв/€ mix-up or a x100 error would leave every absorption RATIO correct — ratios are
    // scale-invariant — and pass the whole file. A hub's money is exactly the figure a reader
    // quotes, so each absolute value is pinned to a sum computed here rather than by 145.
    const s = await stats();
    const t = await truth();
    assert.equal(s.isun.contractCount, Number(t.contracts));
    assert.equal(s.isun.programmeCount, Number(t.programmes));
    assert.ok(Math.abs(s.isun.contractedEur - Number(t.contracted)) < 1);
    assert.ok(Math.abs(s.isun.grantEur - Number(t.grant)) < 1);
    assert.ok(Math.abs(s.isun.paidEur - Number(t.paid)) < 1);
    // Ordering, which no ratio can catch: the grant is part of the contract value, and what has
    // been paid cannot exceed what was granted.
    assert.ok(s.isun.grantEur < s.isun.contractedEur);
    assert.ok(s.isun.paidEur < s.isun.grantEur);

    const [i] = await allRows<{ ops: string; budget: string }>(`
      SELECT (SELECT count(*) FROM interreg_operations)::text AS ops,
             (SELECT sum(budget_eur) FROM interreg_partners
               WHERE country = 'Bulgaria' OR country_department = 'Bulgaria')::text AS budget`);
    assert.equal(s.interreg.operationCount, Number(i.ops));
    assert.ok(Math.abs(s.interreg.bgBudgetEur - Number(i.budget)) < 1);

    const [r] = await allRows<{ total: string; n: string }>(`
      SELECT sum(total_eur)::text AS total, count(*)::text AS n
        FROM fund_projects WHERE program_code LIKE '2021BG-RRP%'`);
    assert.equal(s.rrf.contractCount, Number(r.n));
    assert.ok(Math.abs(s.rrf.contractedEur - Number(r.total)) < 1);
    // The RRF is a subset of the corpus, so it can never exceed it — a check that survives any
    // scaling error applied to only one of the two.
    assert.ok(s.rrf.contractedEur < s.isun.contractedEur);

    const [st] = await allRows<{ n: string }>(
      `SELECT count(DISTINCT ekatte)::text AS n FROM fund_projects WHERE ekatte IS NOT NULL`,
    );
    assert.equal(s.isun.settlementCount, Number(st.n));
  },
);

test.skipIf(skip)(
  "the Interreg BG predicate uses BOTH clauses, as 137 defines canonical",
  async () => {
    // 127/138/139/143 all match `country = 'Bulgaria' OR country_department = 'Bulgaria'`.
    // Identical on today's corpus, so a one-clause copy is latent rather than live — this pins
    // it before the first partner filed with only a country_department makes them disagree.
    const [t] = await allRows<{ both: string; one: string }>(`
      SELECT count(*) FILTER (WHERE country = 'Bulgaria' OR country_department = 'Bulgaria')::text AS both,
             count(*) FILTER (WHERE country = 'Bulgaria')::text AS one
        FROM interreg_partners`);
    const s = await stats();
    assert.equal(
      s.interreg.bgPartnerRowCount,
      Number(t.both),
      "145's Interreg predicate has dropped the country_department clause",
    );
    assert.ok(Number(t.both) >= Number(t.one));
  },
);

test.skipIf(skip)(
  "Interreg operations are counted both corpus-wide and BG-filtered, and they differ",
  async () => {
    // 1 954 vs 1 115. The page about Bulgarian participation must not show the corpus-wide
    // count beside a tile that filters — that shipped once, both labelled „Operations".
    const s = await stats();
    const [t] = await allRows<{ all: string; bg: string }>(`
      SELECT (SELECT count(*) FROM interreg_operations)::text AS all,
             (SELECT count(DISTINCT keep_id) FROM interreg_partners
               WHERE country = 'Bulgaria' OR country_department = 'Bulgaria')::text AS bg`);
    assert.equal(s.interreg.operationCount, Number(t.all));
    assert.equal(s.interreg.bgOperationCount, Number(t.bg));
    assert.ok(
      s.interreg.bgOperationCount < s.interreg.operationCount,
      "the BG-filtered count can only be the smaller of the two",
    );
  },
);

test.skipIf(skip)(
  "the served call is a SEEK, not the live aggregate",
  async () => {
    // 145 is materialised because the aggregate is 18 855 buffers and spills to temp — nine times
    // the ~2 000 the dashboard-hub skill allows for anything a hub calls on every view. If someone
    // replaces the matview with a live function this is the gate that notices.
    const rows = await allRows<{ line: string }>(
      "EXPLAIN (ANALYZE, BUFFERS) SELECT funds_hub_stats()",
    );
    const text = rows.map((r) => Object.values(r)[0] as string).join("\n");
    const hits = [...text.matchAll(/shared hit=(\d+)(?: read=(\d+))?/g)].reduce(
      (n, m) => n + Number(m[1]) + Number(m[2] ?? 0),
      0,
    );
    assert.ok(
      hits < 2000,
      `funds_hub_stats() touched ${hits} buffers — over the 2 000 ceiling for a hub call. ` +
        `Is funds_hub_stats_cache still a matview, and was it refreshed?`,
    );
  },
);

test.skipIf(skip)(
  "every figure is present and none is a structural zero",
  async () => {
    // The skill's rule: a figure that cannot vary should be hidden, not printed as 0. On a loaded
    // corpus every one of these is non-zero, so a 0 here means a NULL leaked through a sum.
    const s = await stats();
    for (const [k, v] of Object.entries(s.isun))
      assert.ok(typeof v === "number" && v > 0, `isun.${k} is ${v}`);
    for (const [k, v] of Object.entries(s.rrf))
      assert.ok(typeof v === "number" && v > 0, `rrf.${k} is ${v}`);
    for (const [k, v] of Object.entries(s.interreg))
      assert.ok(typeof v === "number" && v > 0, `interreg.${k} is ${v}`);
  },
);

test.skipIf(skip)(
  "money arrives as NUMBERS, not node-postgres numeric strings",
  async () => {
    // PG `numeric` serializes as a STRING through node-postgres, which renders every money cell
    // blank while the value is present in the payload — invisible to any row count. 145 rounds to
    // numeric, so the jsonb carries JSON numbers; this asserts the round trip kept them.
    const s = await stats();
    assert.equal(typeof s.isun.contractedEur, "number");
    assert.equal(typeof s.isun.placedContractedEur, "number");
    assert.equal(typeof s.interreg.bgBudgetEur, "number");
    assert.equal(typeof s.rrf.contractedEur, "number");
  },
);
