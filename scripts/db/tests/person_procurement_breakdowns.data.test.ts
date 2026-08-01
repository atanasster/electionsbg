// The person page's procurement cuts must count the SAME contracts as its headline.
//
// person_procurement (024) returns the KPI rollup (Σ€, contract count). Three other paths
// re-slice that identical portfolio, and if any diverges the page shows one total in the
// cards and a different one in a tile or the contracts browser beneath — silently, at a 200:
//
//   1. person_procurement_by_company (125)   — the person's firms, ranked by €.
//   2. person_procurement_by_settlement (125) — the awarder settlements, ranked by €.
//   3. the `contractor_of_person_name` SEMI-JOIN (functions/db_table.js) that scopes the
//      /person/:name/contracts DbDataTable browser.
//
// All four must agree on total € and contract count. The reconciliation rests on three
// things staying aligned, each checked here:
//   • the EIK set (tr_officers.name_fold), identical across all four;
//   • the count basis — person_procurement EXCLUDES €0 consortium-member rows (024:47-48),
//     so the browser must too, via the `not_consortium_member` filter (consortium_role IS
//     DISTINCT FROM 'member'). A plain tag='contract' scope would over-count;
//   • the redaction sentinel 'заличено обстоятелство' (1,966 firms) must resolve to NOTHING,
//     or a placeholder "person" shows 12,967 contracts across 777 unrelated firms.
//
// The semi-join is read from the live REGISTRY, not copied, so a drift in db_table.js fails
// here rather than silently unreconciling prod. Auto-skips when Postgres is down / no corpus.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const corpusLoaded =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        `SELECT count(*) n FROM tr_officers o
          WHERE EXISTS (SELECT 1 FROM contracts c
                         WHERE c.contractor_eik = o.uic AND c.tag = 'contract')`,
      ).catch(() => [{ n: "0" }])
    )[0]?.n ?? 0,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !corpusLoaded
    ? "no tr_officers with contracts loaded"
    : false;

afterAll(async () => {
  await end();
});

const num = (v: unknown): number => Number(v ?? 0);
type Agg = { n: number; eur: number; awarders: number };
type BreakdownRow = {
  totalEur: number;
  contractCount: number;
  awarderCount: number;
};
const sumArr = (arr: BreakdownRow[]): Agg => ({
  n: arr.reduce((s, x) => s + Number(x.contractCount ?? 0), 0),
  eur: arr.reduce((s, x) => s + Number(x.totalEur ?? 0), 0),
  awarders: arr.reduce((s, x) => s + Number(x.awarderCount ?? 0), 0),
});
// amount_eur is double precision; per-row rounding never happens in these functions (raw
// SUM), so the sums are exact, but compare within a cent to be immune to float re-summation.
const close = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;

const headline = async (name: string): Promise<Agg> => {
  const r = (
    await allRows<{
      j: {
        contractCount: number;
        totalEur: number;
        awarderCount: number;
      } | null;
    }>("SELECT person_procurement($1, NULL, NULL) AS j", [name])
  )[0]?.j;
  return {
    n: num(r?.contractCount),
    eur: num(r?.totalEur),
    awarders: num(r?.awarderCount),
  };
};

const breakdown = async (fn: string, name: string): Promise<Agg> =>
  sumArr(
    (
      await allRows<{ j: BreakdownRow[] }>(
        `SELECT ${fn}($1, NULL, NULL) AS j`,
        [name],
      )
    )[0]?.j ?? [],
  );

// The semi-join EXACTLY as functions/db_table.js emits it — read from the registry so a
// drift there fails here. `not_consortium_member` (isdistinct) mirrors the count basis.
const { REGISTRY } = await import("../../../functions/db_table.js");
const semiJoinSql = String(
  REGISTRY.contracts.columns.contractor_of_person_name.semiJoinSql,
);
const semiJoinPred = `contractor_eik IN (${semiJoinSql.replace("?", "$1")})`;

const viaSemiJoin = async (name: string): Promise<{ n: number; eur: number }> =>
  await allRows<{ n: unknown; eur: unknown }>(
    `SELECT count(*) n, sum(amount_eur) eur FROM contracts
       WHERE tag = 'contract'
         AND consortium_role IS DISTINCT FROM 'member'
         AND ${semiJoinPred}`,
    [name],
  ).then((rows) => ({ n: num(rows[0]?.n), eur: num(rows[0]?.eur) }));

// A single-firm person and a dense multi-firm portfolio (14 firms / 377 contracts locally).
const NAMES = ["ЯВОР ЧАВДАРОВ СТЕФАНОВ", "ПЕТЪР ИВАНОВ ПЕТРОВ"];

test.skipIf(skip)(
  "by_company and by_settlement each reconcile with the person_procurement headline",
  async () => {
    for (const name of NAMES) {
      const head = await headline(name);
      if (head.n === 0) continue; // no procurement → nothing to reconcile
      for (const fn of [
        "person_procurement_by_company",
        "person_procurement_by_settlement",
      ]) {
        const b = await breakdown(fn, name);
        assert.equal(b.n, head.n, `${name}: ${fn} count ${b.n} != ${head.n}`);
        assert.ok(
          close(b.eur, head.eur),
          `${name}: ${fn} total ${b.eur} != ${head.eur}`,
        );
      }
      // NOTE (why there is no Σ awarderCount == headline check): the breakdowns count only
      // buyers with a REAL (non-member) contract, while person_procurement's awarder_count
      // (024:51) also counts member-only (€0) awarders. The two are different questions, so
      // the sums legitimately differ — asserting equality here is wrong. The 1:1 awarder→seat
      // PK join is instead guarded by the totalEur/contractCount reconciliation above (a
      // duplicate awarder_seats row would double-count a bucket's money and break it).
    }
  },
);

test.skipIf(skip)(
  "the contracts semi-join browser scope reconciles with the headline",
  async () => {
    for (const name of NAMES) {
      const head = await headline(name);
      if (head.n === 0) continue;
      const a = await viaSemiJoin(name);
      assert.equal(a.n, head.n, `${name}: semi-join count ${a.n} != ${head.n}`);
      assert.ok(
        close(a.eur, head.eur),
        `${name}: semi-join total ${a.eur} != ${head.eur}`,
      );
    }
  },
);

test.skipIf(skip)(
  "the SLUG-path breakdowns reconcile with the 082 EIK-set basis",
  async () => {
    // A public-figure slug that actually holds TR procurement (else nothing to reconcile).
    const slug = (
      await allRows<{ slug: string }>(
        `SELECT p.slug
           FROM person p
          WHERE p.status = 'active' AND p.is_public_figure
            AND EXISTS (
              SELECT 1 FROM person_role r JOIN contracts c ON c.contractor_eik = r.ref
               WHERE r.person_id = p.person_id AND r.source = 'tr'
                 AND r.confidence IN ('exact_id','high','manual') AND c.tag = 'contract')
          LIMIT 1`,
      )
    )[0]?.slug;
    if (!slug) return; // corpus has no public figure with TR procurement — nothing to test

    // Expected: the 082 EIK-set basis, inlined here (NOT via person_slug_tr_eiks) so a drift
    // of the helper away from 082 is CAUGHT rather than mirrored.
    const exp = (
      await allRows<{ n: unknown; eur: unknown }>(
        `SELECT count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member') n,
                sum(amount_eur) eur
           FROM contracts
          WHERE tag = 'contract'
            AND contractor_eik IN (
              SELECT r.ref FROM person_role r JOIN person p ON p.person_id = r.person_id
               WHERE p.slug = $1 AND p.status = 'active' AND p.is_public_figure
                 AND r.source = 'tr' AND r.confidence IN ('exact_id','high','manual'))`,
        [slug],
      )
    )[0];
    const expN = num(exp?.n);
    const expEur = num(exp?.eur);
    for (const fn of [
      "person_procurement_by_company_slug",
      "person_procurement_by_settlement_slug",
    ]) {
      const b = await breakdown(fn, slug);
      assert.equal(
        b.n,
        expN,
        `${slug}: ${fn} count ${b.n} != 082-basis ${expN}`,
      );
      assert.ok(
        close(b.eur, expEur),
        `${slug}: ${fn} total ${b.eur} != 082-basis ${expEur}`,
      );
    }
  },
);

test.skipIf(skip)(
  "the TR redaction sentinel resolves to zero contracts, not a 777-firm portfolio",
  async () => {
    // Fold-EXACT input: 'ЗАЛИЧЕНО ОБСТОЯТЕЛСТВО.' (trailing period) folds to
    // 'zalicheno obstoyatelstvo.' — the STORED sentinel fold. The no-period spelling folds
    // to 'zalicheno obstoyatelstvo' and matches nothing regardless of the guard, so it would
    // pass even with the guard deleted; this input is what actually exercises the guard.
    const SENTINEL = "ЗАЛИЧЕНО ОБСТОЯТЕЛСТВО.";
    // Prove the guard is doing work: without it, this fold matches thousands of firms.
    const stored = Number(
      (
        await allRows<{ n: string }>(
          "SELECT count(*) n FROM tr_officers WHERE name_fold = translit_bg_latin($1)",
          [SENTINEL],
        )
      )[0]?.n ?? 0,
    );
    assert.ok(
      stored > 100,
      `precondition: the sentinel fold should match many officer rows (got ${stored}) — ` +
        `if this is 0 the test no longer exercises the guard`,
    );
    for (const fn of [
      "person_procurement_by_company",
      "person_procurement_by_settlement",
    ]) {
      const b = await breakdown(fn, SENTINEL);
      assert.equal(
        b.n,
        0,
        `${fn}: sentinel should yield 0 contracts, got ${b.n}`,
      );
    }
    const a = await viaSemiJoin(SENTINEL);
    assert.equal(a.n, 0, `sentinel semi-join should yield 0, got ${a.n}`);
  },
);
