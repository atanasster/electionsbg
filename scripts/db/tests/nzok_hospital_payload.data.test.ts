// The per-EIK НЗОК reimbursement payload (065) — specifically `periodByStream`,
// the field that lets `/company/:eik` date each of the three money figures.
//
// ⚠️ WHY THIS FILE EXISTS AT ALL. The only other gate over `periodByStream` is a
// COMPONENT test whose fixture supplies the field it is testing, so deleting the
// expression from 065 leaves every test in the repo green: `tsc -b` is happy (the
// field is optional), and the tile degrades to "no caveat" by design. That is the
// exact shape this plan is about — the surface goes quiet and nothing says so.
//
// НЗОК publishes its three monthly reports (bmp / drugs / devices) on their own
// cadences and a hospital's income is their SUM, so `nzok_hospital_payments_latest_rows`
// takes each stream at its OWN latest month rather than pinning all three to one
// date — pinning would silently drop a lagging stream's money. The cost is that a
// figure can be dated differently from the page's headline, which is the БМП
// anchor. Measured before the Tier 1 parser work: devices lagged БМП by five
// months and €32,312,935 — 62.9% of that stream — was presented under a July date.
//
// Auto-skips when Postgres is down or the payments corpus is empty.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

type Payload = {
  asOf: string;
  periodByStream?: Record<string, string>;
  bmpEur: number;
  drugsEur: number;
  devicesEur: number;
  totalCumulativeEur: number;
};

const haveDb = await dbReachable();
const loaded =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*) n FROM nzok_hospital_payments",
      ).catch(() => [{ n: "0" }])
    )[0]?.n ?? 0,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !loaded
    ? "nzok_hospital_payments is empty"
    : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "the view pins each stream to exactly ONE period",
  async () => {
    // The invariant the whole `jsonb_object_agg(stream, …)` expression rests on.
    // Asserted on the VIEW rather than on the payload so that a future change to
    // the join — one that let two periods through for a stream, making the agg
    // pick arbitrarily rather than raise — fails HERE, loudly, instead of putting
    // an arbitrary month beside a real number on a named hospital's page.
    const rows = await allRows<{ stream: string; n: string }>(
      `SELECT stream, count(DISTINCT period) n
         FROM nzok_hospital_payments_latest_rows GROUP BY stream`,
    );
    assert.ok(rows.length > 0, "the latest-rows view is empty");
    for (const r of rows)
      assert.equal(
        Number(r.n),
        1,
        `stream ${r.stream} spans ${r.n} periods in nzok_hospital_payments_latest_rows — ` +
          "jsonb_object_agg would pick one of them arbitrarily",
      );
  },
);

test.skipIf(skip)(
  "every company carries a period for exactly the streams it appears in",
  async () => {
    // Re-derived from the view rather than restated, so this cannot pass on a
    // payload that emits a plausible-looking constant.
    const expected = new Map<string, Record<string, string>>();
    for (const r of await allRows<{
      eik: string;
      stream: string;
      p: string;
    }>(
      `SELECT eik, stream, to_char(period, 'YYYY-MM') p
         FROM nzok_hospital_payments_latest_rows
        WHERE eik IS NOT NULL GROUP BY 1, 2, 3`,
    ))
      expected.set(r.eik, { ...(expected.get(r.eik) ?? {}), [r.stream]: r.p });
    assert.ok(expected.size > 0, "no EIK-bearing rows in the latest-rows view");

    const got = await allRows<{ eik: string; j: Payload | null }>(
      `SELECT eik, nzok_hospital_reimbursement_by_eik(eik) j
         FROM (SELECT DISTINCT eik FROM nzok_hospital_payments_latest_rows
                WHERE eik IS NOT NULL) e`,
    );
    let checked = 0;
    for (const { eik, j } of got) {
      if (!j) continue;
      assert.deepEqual(
        j.periodByStream ?? {},
        expected.get(eik),
        `${eik}: periodByStream disagrees with the view it is derived from`,
      );
      checked++;
    }
    assert.ok(
      checked > 0,
      "no payload was returned — the gate would be vacuous",
    );
  },
);

test.skipIf(skip)(
  "a stream with money carries a period, so no figure is undateable",
  async () => {
    // The consumer-facing invariant: the tile can only footnote a stream it has a
    // month for. A non-zero figure with no period would render undated under the
    // БМП headline — the defect this field exists to end — and would do so at a
    // 200 with every row count reconciling.
    const got = await allRows<{ eik: string; j: Payload | null }>(
      `SELECT eik, nzok_hospital_reimbursement_by_eik(eik) j
         FROM (SELECT DISTINCT eik FROM nzok_hospital_payments_latest_rows
                WHERE eik IS NOT NULL) e`,
    );
    const pairs = [
      ["bmpEur", "bmp"],
      ["drugsEur", "drugs"],
      ["devicesEur", "devices"],
    ] as const;
    let withMoney = 0;
    for (const { eik, j } of got) {
      if (!j) continue;
      for (const [key, stream] of pairs) {
        if (j[key] <= 0) continue;
        withMoney++;
        assert.ok(
          j.periodByStream?.[stream],
          `${eik}: ${key} is €${j[key]} but no ${stream} period — the page would date it as БМП's`,
        );
      }
    }
    assert.ok(
      withMoney > 0,
      "no stream carried money — the gate would be vacuous",
    );
  },
);

test.skipIf(skip)(
  "the coverage table and the payments table agree about which months exist",
  async () => {
    // ⚠️ The two are written by ONE loader in ONE transaction, so a disagreement
    // means the coverage table is lying about what was published — the precise
    // failure the table exists to prevent, since its whole job is to make an
    // omission a queryable fact rather than a line in a log. Checked from outside
    // the loader deliberately: the loader's own three-way check cannot fire on a
    // database where the loader was never run, or was run partially.
    const [pay, cov] = await Promise.all([
      allRows<{ k: string }>(
        `SELECT stream || ' ' || to_char(period,'YYYY-MM') k
           FROM nzok_hospital_payments GROUP BY 1 ORDER BY 1`,
      ),
      allRows<{ k: string }>(
        `SELECT stream || ' ' || to_char(period,'YYYY-MM') k
           FROM nzok_payment_coverage WHERE status = 'loaded' ORDER BY 1`,
      ),
    ]);
    assert.ok(pay.length > 0, "no payment months — the gate would be vacuous");
    assert.deepEqual(
      cov.map((r) => r.k),
      pay.map((r) => r.k),
      "nzok_payment_coverage's 'loaded' months differ from the months that actually have rows",
    );
    // …and a refused month must publish nothing, which is the other half of the
    // claim. (187 has a CHECK for it; this proves the CHECK is doing its job on
    // real data rather than on a shape no row reaches.)
    const leaked = await allRows<{ k: string }>(
      `SELECT c.stream || ' ' || to_char(c.period,'YYYY-MM') k
         FROM nzok_payment_coverage c
         JOIN nzok_hospital_payments h
           ON h.stream = c.stream AND h.period = c.period
        WHERE c.status = 'refused' GROUP BY 1`,
    );
    assert.deepEqual(
      leaked.map((r) => r.k),
      [],
      "a month marked refused has per-facility rows published anyway",
    );
  },
);

// ⚠️ WHAT IS DELIBERATELY *NOT* ASSERTED HERE, and why.
//
// An earlier cut of this file required the three streams to sit at DIFFERENT
// months, as non-vacuity for the tile's mixed-months caveat. On 2026-08-25 that
// assertion failed — for the good reason. Before the parser work devices stopped
// at 2026-02 while bmp/drugs ran to 2026-07, because the five 2026-03..07 devices
// files were among the 24 the old completeness asserts rejected; loading them
// brought all three streams to 2026-07 and recovered €32,312,938. The caveat is
// therefore currently UNREACHABLE on this corpus, and re-asserting divergence
// would now be asserting that the defect is still present.
//
// It is not re-armed as an inverse ("the streams agree") either: a lag is
// LEGITIMATE — НЗОК publishes the three reports on their own schedules — so a
// future divergence is normal operation, not a regression. The tile's caveat is
// guarded by NzokHospitalReimbursementTile.test.tsx, which supplies its own
// fixtures for both directions and is mutation-checked, so it needs no support
// from whatever the corpus happens to hold today.
