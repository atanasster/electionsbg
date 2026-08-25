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
  "the streams really do disagree, so the footnote is not decorative",
  async () => {
    // ⚠️ Non-vacuity for the TILE. If every stream shared one month, the caveat it
    // renders would never fire and the component test would be exercising a case
    // the corpus does not contain. Measured 2026-08-25: bmp/drugs at 2026-07 and
    // devices at 2026-02. If this ever fails because the reports have converged,
    // that is good news and the assertion should be relaxed deliberately — not
    // because the field stopped being emitted.
    const rows = await allRows<{ stream: string; p: string }>(
      `SELECT stream, to_char(max(period), 'YYYY-MM') p
         FROM nzok_hospital_payments GROUP BY stream`,
    );
    assert.ok(rows.length >= 2, "fewer than two streams are loaded");
    const months = new Set(rows.map((r) => r.p));
    assert.ok(
      months.size > 1,
      `all streams are at ${[...months][0]} — the mixed-months caveat is currently unreachable`,
    );
  },
);
