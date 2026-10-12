// The /water hub's figures come from a COMMITTED artifact —
// data/water/derived/hub_stats.json, written by `npm run db:gen-water-hub-stats`
// — so they fail the way every committed-derived artifact fails: the corpus
// reloads underneath the file and the hub keeps stating the old number at a 200.
//
// This re-derives each figure and compares within a band (when one trips after
// an ordinary ingest, re-run the generator — do not widen the band). It holds
// the agreements docs/plans/water-hub-v1.md T2 names:
//   · KPI 1 == sector_stats.json all.water — one number, two pages;
//   · the services figures == water_stats.json, the riverbed == flood_maintenance.json;
// and asserts the REJECTED bases differ, so a regression onto one of them fails.
//
// Auto-skips only when Postgres is down; the committed inputs must exist.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { allRows, dbReachable, end } from "../lib/pg";
import {
  VIK_HOLDING_EIK,
  VIK_HOLDING_SUB_EIKS,
  WATER_OPERATORS,
  WATER_OPERATOR_TYPES,
  WATER_SECTOR_EIKS,
  operatorByEik,
} from "@/lib/vikReferenceData";
import type { WaterHubStats } from "@/data/water/hubStats";
import { CREDIT_TITLE, LOAN_TITLE } from "../../water/water_titles";
import { reportSkip } from "../../lib/report_skip";
import { assertCommitted } from "../../lib/assert_committed";

const BLOB = "data/water/derived/hub_stats.json";
const SECTOR_STATS = "data/procurement/derived/sector_stats.json";
const WATER_STATS = "data/water/water_stats.json";
const FLOOD = "data/water/flood_maintenance.json";

// The registry engine behind /procurement/contracts — CJS, so require()d.
const { runDbTable } = createRequire(import.meta.url)(
  "../../../functions/db_table.js",
) as {
  runDbTable: (
    q: (sql: string, params: unknown[]) => Promise<unknown[]>,
    req: Record<string, unknown>,
  ) => Promise<{
    total: number;
    aggregates?: { count?: number; sumAmountEur?: number };
  }>;
};

// All COMMITTED, so a missing copy is a broken checkout — fail, never skip.
assertCommitted(BLOB, SECTOR_STATS, WATER_STATS, FLOOD);

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

const read = <T>(rel: string): T =>
  JSON.parse(readFileSync(path.resolve(process.cwd(), rel), "utf8")) as T;
const blob = (): WaterHubStats => read<WaterHubStats>(BLOB);
const eiks = [...WATER_SECTOR_EIKS];

const TOLERANCE = 0.02;
const near = (actual: number, stored: number, what: string) =>
  assert.ok(
    Math.abs(actual - stored) <= Math.max(1, Math.abs(stored) * TOLERANCE),
    `${what}: database ${actual} vs blob ${stored} — re-run npm run db:gen-water-hub-stats`,
  );

/** The blob is fetched by the hub before it can paint its KPI band. */
const BYTE_BUDGET = 5_120;

test("KPI 1 is sector_stats.json's water headline, on the same basis", () => {
  const s = read<{
    all: { water: { value: number; basis: string } };
  }>(SECTOR_STATS);
  assert.equal(s.all.water.basis, "procurement");
  assert.equal(blob().procurement.eur, Math.round(s.all.water.value));
});

test.skipIf(skip)(
  "the procurement figures match a live recompute, ex-member basis",
  async () => {
    const [r] = await allRows<Record<string, string>>(
      `SELECT sum(amount_eur) eur,
              count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member') n,
              count(*) n_all,
              count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member'
                                 AND number_of_tenderers = 1) single,
              count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member'
                                 AND number_of_tenderers IS NOT NULL) known,
              count(*) FILTER (WHERE number_of_tenderers = 1) single_all
         FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
      [eiks],
    );
    const b = blob().procurement;
    near(Number(r.eur), b.eur, "€");
    near(Number(r.n), b.contracts, "contracts");
    near(Number(r.single), b.singleBid, "single-bid");
    near(Number(r.known), b.bidKnown, "bid-known");
    // Rejected basis: the member-inclusive count and pair (G3).
    assert.notEqual(Number(r.n_all), b.contracts, "count includes member rows");
    assert.notEqual(
      Number(r.single_all),
      b.singleBid,
      "single-bid includes member rows",
    );
  },
);

test.skipIf(skip)("the rejected money bases differ from KPI 1", async () => {
  const [r] = await allRows<{ all_tag: string; holding: string }>(
    `SELECT (SELECT sum(amount_eur) FROM contracts WHERE awarder_eik = ANY($1)) all_tag,
            (SELECT sum(amount_eur) FROM contracts
              WHERE tag = 'contract' AND awarder_eik = ANY($2)) holding`,
    [eiks, [VIK_HOLDING_EIK, ...VIK_HOLDING_SUB_EIKS]],
  );
  const eur = blob().procurement.eur;
  // All tags (amendments included) — €3.93bn on 2026-10-12.
  assert.ok(Math.abs(Number(r.all_tag) - eur) > eur * 0.05);
  // The holding group alone — the F1 framing the 2026-08-13 audit removed.
  assert.ok(Math.abs(Number(r.holding) - eur) > eur * 0.05);
  // The value at SIGNING — KPI 1 is current value after annexes.
  // Annex growth is ~2% of the sector — the width of the drift band — so a band
  // test cannot separate the bases. Compare both LIVE sums instead: the blob must
  // sit nearer the current-value basis than the at-signing one.
  const [sig] = await allRows<{ current: string; at_signing: string }>(
    `SELECT sum(amount_eur) current,
            sum(coalesce(signing_amount_eur, amount_eur)) at_signing
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
    [eiks],
  );
  assert.ok(
    Math.abs(eur - Number(sig.current)) <
      Math.abs(eur - Number(sig.at_signing)),
    "KPI 1 is nearer the pre-annex sum than the current value",
  );
});

test.skipIf(skip)(
  "the „Всички договори“ tile opens a browser that counts what the hub counts",
  async () => {
    // /procurement/contracts?sector=water sends tag + the pack's awarder set +
    // not_consortium_member (excludeConsortiumMembers, G1). Run through the real
    // engine, not a restated WHERE; waterRegistry.test.ts pins the pack's flag.
    const q = (sql: string, params: unknown[]) => allRows(sql, params);
    const run = (extra: Record<string, unknown>[]) =>
      runDbTable(q, {
        resource: "contracts",
        page: 0,
        pageSize: 1,
        filters: {
          columns: [
            { id: "tag", value: ["contract"] },
            { id: "awarder_eik", value: eiks },
            { id: "not_consortium_member", value: "member" },
            ...extra,
          ],
        },
      });
    const b = blob().procurement;
    // Within the file's band, like every recompute here: the corpus moves under
    // the committed blob between regenerations. The member-inclusive count is
    // ~6% away, so the band still tells the two bases apart (asserted below).
    const all = await run([]);
    near(all.aggregates?.count ?? all.total, b.contracts, "browser count");
    const single = await run([{ id: "number_of_tenderers", min: 1, max: 1 }]);
    near(
      single.aggregates?.count ?? single.total,
      b.singleBid,
      "browser single-bid",
    );
    const withMembers = await runDbTable(q, {
      resource: "contracts",
      page: 0,
      pageSize: 1,
      filters: {
        columns: [
          { id: "tag", value: ["contract"] },
          { id: "awarder_eik", value: eiks },
        ],
      },
    });
    const n = withMembers.aggregates?.count ?? withMembers.total;
    assert.ok(
      Math.abs(n - b.contracts) > b.contracts * TOLERANCE,
      `without the member filter the browser counts ${n} — the band must reject it`,
    );
  },
);

test("the register counts are the reference data's", () => {
  const ops = WATER_OPERATORS.filter((o) =>
    WATER_OPERATOR_TYPES.includes(o.type),
  );
  const r = blob().register;
  assert.equal(r.eiks, WATER_SECTOR_EIKS.length);
  assert.equal(r.operators, ops.length);
  assert.equal(r.liveOperators, ops.filter((o) => !o.status).length);
});

test.skipIf(skip)(
  "the operator index and the rail are the per-operator sums, operators only on the rail",
  async () => {
    const rows = await allRows<{ eik: string; eur: string }>(
      `SELECT awarder_eik eik, sum(amount_eur) eur FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1)
        GROUP BY 1 ORDER BY sum(amount_eur) DESC NULLS LAST, 1`,
      [eiks],
    );
    const live = new Map(rows.map((r) => [r.eik, Number(r.eur)]));
    const b = blob();
    for (const o of b.operatorIndex)
      near(live.get(o.eik) ?? 0, o.eur, `operator ${o.eik}`);
    assert.equal(b.operatorIndex.length, rows.length);
    const expected = rows
      .filter((r) => {
        const type = operatorByEik(r.eik)?.type;
        return !!type && WATER_OPERATOR_TYPES.includes(type);
      })
      .slice(0, b.topOperators.length)
      .map((r) => r.eik);
    assert.deepEqual(
      b.topOperators.map((o) => o.eik),
      expected,
    );
    assert.equal(b.topOperators.length, 5);
  },
);

test.skipIf(skip)(
  "the national baseline is migration 167's ex-member pair",
  async () => {
    const [n] = await allRows<{
      r: Record<string, number>;
    }>("SELECT national_competition(NULL, NULL) AS r");
    const b = blob().procurement;
    near(n.r.singleBidExMembers, b.nationalSingleBid, "national single-bid");
    near(n.r.bidKnownExMembers, b.nationalBidKnown, "national bid-known");
    assert.notEqual(n.r.singleBid, b.nationalSingleBid);
  },
);

test.skipIf(skip)(
  "the intra-group line is every contract whose supplier is a water EIK",
  async () => {
    // Independent of the generator's single aggregate: per-pair rows, summed here.
    const rows = await allRows<{
      awarder: string;
      contractor: string;
      eur: string;
      n: string;
    }>(
      `SELECT awarder_eik awarder, contractor_eik contractor,
              sum(amount_eur) eur, count(*) n
         FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1) AND contractor_eik = ANY($1)
        GROUP BY 1, 2`,
      [eiks],
    );
    const b = blob().intraGroup;
    near(
      rows.reduce((s, r) => s + Number(r.eur), 0),
      b.eur,
      "intra-group €",
    );
    near(
      rows.reduce((s, r) => s + Number(r.n), 0),
      b.contracts,
      "intra-group n",
    );
    const self = rows.filter((r) => r.awarder === r.contractor);
    near(
      self.reduce((s, r) => s + Number(r.n), 0),
      b.selfContracts,
      "self n",
    );
    assert.ok(b.loansToHoldingEur <= b.eur && b.selfEur <= b.eur);
    // Non-vacuity: the line exists because this money exists.
    assert.ok(b.contracts > 0);
  },
);

test.skipIf(skip)(
  "the credit and loan lines match a recompute and catch no accreditation",
  async () => {
    const [r] = await allRows<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM contracts WHERE tag = 'contract'
            AND awarder_eik = ANY($1) AND NOT (contractor_eik = ANY($1))
            AND ${CREDIT_TITLE}) credit_n,
         (SELECT coalesce(sum(amount_eur), 0) FROM contracts WHERE tag = 'contract'
            AND awarder_eik = ANY($1) AND NOT (contractor_eik = ANY($1))
            AND ${CREDIT_TITLE}) credit_eur,
         (SELECT count(*) FROM contracts WHERE tag = 'contract'
            AND awarder_eik = ANY($1) AND NOT (contractor_eik = ANY($1))
            AND ${CREDIT_TITLE} AND title ~* 'акредит') accredited,
         (SELECT count(*) FROM contracts WHERE tag = 'contract'
            AND awarder_eik = ANY($1) AND contractor_eik = $2
            AND ${LOAN_TITLE}) loan_n`,
      [eiks, VIK_HOLDING_EIK],
    );
    const b = blob();
    near(Number(r.credit_n), b.credits.contracts, "credit contracts");
    near(Number(r.credit_eur), b.credits.eur, "credit €");
    near(
      Number(r.loan_n),
      b.intraGroup.loansToHoldingContracts,
      "loans to holding",
    );
    // An unanchored `кредит` matched „акредитирана лаборатория" (8 of 17 rows).
    assert.equal(
      Number(r.accredited),
      0,
      "the credit predicate matches accreditation",
    );
  },
);

test.skipIf(skip)("the EU-funds figures match fund_beneficiaries", async () => {
  const [r] = await allRows<Record<string, string>>(
    `SELECT count(*) n, sum(contracted_eur) c, sum(paid_eur) p
       FROM fund_beneficiaries WHERE eik = ANY($1)`,
    [eiks],
  );
  const b = blob().euFunds;
  near(Number(r.n), b.beneficiaries, "beneficiaries");
  near(Number(r.c), b.contractedEur, "contracted €");
  near(Number(r.p), b.paidEur, "paid €");
});

test("the services figures are water_stats.json's latest year", () => {
  const s = read<{
    latestYear: number;
    years: { year: number; rationingPct: number | null }[];
  }>(WATER_STATS);
  const latest = s.years.find((y) => y.year === s.latestYear);
  assert.equal(blob().services?.year, s.latestYear);
  assert.equal(blob().services?.rationingPct, latest?.rationingPct ?? null);
});

test("the riverbed figure is flood_maintenance.json's own total", () => {
  const f = read<{ totalEur: number; contractCount: number }>(FLOOD);
  assert.equal(blob().riverbed.eur, f.totalEur);
  assert.equal(blob().riverbed.contracts, f.contractCount);
});

test("the function split reconciles to KPI 1", () => {
  const b = blob();
  const sum = b.functions.reduce((s, f) => s + f.eur, 0);
  assert.ok(
    Math.abs(sum - b.procurement.eur) <= b.procurement.eur * 1e-6,
    `Σ functions ${sum} vs ${b.procurement.eur}`,
  );
});

test("the blob stays inside its byte budget", () => {
  const size = statSync(path.resolve(process.cwd(), BLOB)).size;
  assert.ok(size <= BYTE_BUDGET, `${size} B > ${BYTE_BUDGET} B`);
});
