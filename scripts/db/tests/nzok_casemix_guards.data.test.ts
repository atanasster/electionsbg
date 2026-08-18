// The case-mix expected-vs-actual guards (059, plan §6b).
//
// The metric divides what НЗОК actually paid a hospital by what the НРД list
// price says its OWN case mix should have cost. Two things make that number
// meaningless rather than merely uncertain, and both look like a cheap hospital:
//
//   * a PARTIAL payment year — the actual is summed over the months the corpus
//     holds. Measured on the 2025 corpus before this guard: one facility read
//     €1.1 per case on 4 months of payments against 1,646 cases.
//   * a thinly-priced case mix — `expected` only counts cases whose procedure
//     has a tariff, so at low coverage it is a comparison against almost nothing.
//
// The guards null the RATIO and name the reason, keeping the parts visible so
// the surface can say WHY instead of silently dropping the row.
//
// Auto-skips when Postgres is down or tariffs are not loaded.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

type Casemix = {
  eik: string;
  year: number;
  expectedEur: number;
  actualEur: number | null;
  ratio: number | null;
  coverage: number;
  paymentMonths: number;
  fullYearMonths: number;
  suppressed: string | null;
};

const haveDb = await dbReachable();
const tariffed =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*) n FROM nzok_pathway_tariffs",
      ).catch(() => [{ n: "0" }])
    )[0]?.n ?? 0,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !tariffed
    ? "nzok_pathway_tariffs is empty"
    : false;

const all = async (): Promise<Casemix[]> =>
  (
    await allRows<{ j: Casemix | null }>(
      `SELECT nzok_casemix_expected_vs_actual(eik) j
         FROM (SELECT DISTINCT eik FROM nzok_activities WHERE eik IS NOT NULL) e`,
    )
  )
    .map((r) => r.j)
    .filter((j): j is Casemix => !!j);

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "a ratio is published only when nothing is suppressed",
  async () => {
    const rows = await all();
    assert.ok(rows.length > 0, "no hospitals returned a payload");
    for (const r of rows) {
      if (r.suppressed) {
        assert.equal(
          r.ratio,
          null,
          `${r.eik}: suppressed as ${r.suppressed} but still published a ratio`,
        );
      } else {
        assert.notEqual(
          r.ratio,
          null,
          `${r.eik}: nothing suppressed but no ratio`,
        );
      }
    }
  },
);

test.skipIf(skip)(
  "a partial payment year is suppressed, not rendered as a cheap hospital",
  async () => {
    const rows = await all();
    // The floor is the YEAR'S OWN full complement, never a constant: the payment
    // corpus holds 9 months for 2023, 12 for 2024, 11 for 2025 and 6 so far for
    // 2026, and since the activity corpus went multi-year the year this reads is
    // not fixed. A hard 11 would suppress every hospital in 2023 or 2026.
    for (const r of rows)
      if (r.actualEur != null && r.paymentMonths < r.fullYearMonths)
        assert.equal(
          r.suppressed,
          "partial-payment-year",
          `${r.eik} has ${r.paymentMonths} payment months but is not suppressed — ` +
            "a part-year numerator over a full-year denominator reads as absurdly cheap",
        );
    // …and the guard is not vacuous: the corpus contains such hospitals.
    const partial = rows.filter((r) => r.suppressed === "partial-payment-year");
    assert.ok(
      partial.length > 0,
      "no hospital is partial-year suppressed — the fixture no longer exercises this",
    );
  },
);

test.skipIf(skip)("a thinly-priced case mix is suppressed", async () => {
  const rows = await all();
  for (const r of rows)
    if (r.actualEur != null && r.paymentMonths >= 11 && r.coverage < 0.8)
      assert.equal(
        r.suppressed,
        "low-tariff-coverage",
        `${r.eik} has ${r.coverage} coverage but is not suppressed`,
      );
});

test.skipIf(skip)(
  "the parts stay visible so a surface can say WHY",
  async () => {
    const rows = await all();
    for (const r of rows.filter((x) => x.suppressed)) {
      assert.ok(
        Number.isFinite(r.expectedEur),
        `${r.eik}: expectedEur missing on a suppressed row`,
      );
      assert.ok(
        Number.isInteger(r.paymentMonths),
        `${r.eik}: paymentMonths missing on a suppressed row`,
      );
      assert.ok(
        ["no-payments", "partial-payment-year", "low-tariff-coverage"].includes(
          r.suppressed!,
        ),
        `${r.eik}: unrecognised suppression reason "${r.suppressed}"`,
      );
    }
  },
);

test.skipIf(skip)(
  "the full-year month count is derived from the corpus, not hard-coded",
  async () => {
    const rows = await all();
    const [truth] = await allRows<{ m: string }>(
      `SELECT max(n)::text m FROM (
         SELECT count(DISTINCT period) n FROM nzok_hospital_payments
          WHERE stream = 'bmp'
            AND EXTRACT(YEAR FROM period)
                = (SELECT EXTRACT(YEAR FROM max(period)) FROM nzok_activities)
          GROUP BY eik) x`,
    );
    for (const r of rows)
      assert.equal(
        r.fullYearMonths,
        Number(truth.m),
        `${r.eik}: fullYearMonths ${r.fullYearMonths} != the year's actual ` +
          `complement ${truth.m} — a hard-coded floor is right for one vintage only`,
      );
  },
);

test.skipIf(skip)(
  "most hospitals still get a ratio — the guards are not swallowing the metric",
  async () => {
    const rows = await all();
    const published = rows.filter((r) => r.ratio != null).length;
    assert.ok(
      published / rows.length > 0.8,
      `only ${published}/${rows.length} hospitals publish a ratio — the guards ` +
        "have stopped being exceptions",
    );
  },
);
