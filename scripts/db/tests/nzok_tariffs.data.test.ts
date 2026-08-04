// Gate for the НРД pathway-tariff corpus (migration 059, gaps plan T4). Empty
// is a legitimate state (the JSON is gitignored and the ingest is manual), so
// this auto-skips on an empty table like the other gates — but once tariffs
// are loaded they must be sane: a plausible code count, prices in a real range,
// and real coverage of the activity corpus. The coverage floor is the load-
// bearing one: a mis-keyed load (wrong PREFIX/PAD normalization) still inserts
// hundreds of rows, and the ONLY visible symptom is the tariff join matching
// nothing — spend silently reverts to volume-only at a 200.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const loaded =
  haveDb &&
  (
    await allRows<{ n: string }>(
      "SELECT count(*) n FROM nzok_pathway_tariffs",
    ).catch(() => [{ n: "0" }])
  ).some((r) => Number(r.n) > 0);
const skip = !haveDb
  ? "Postgres unreachable"
  : !loaded
    ? "nzok_pathway_tariffs is empty (manual ingest not run)"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "the tariff corpus is plausibly complete and priced",
  async () => {
    // Per-prefix floors, not one total: the realistic failure is losing a WHOLE
    // article table (a КП-only parse would still clear a 350 total), and the
    // 2025 tables carry 352 КП + 51 АПр + 7 КПр.
    const rows = await allRows<{ pfx: string; n: string; bad: string }>(
      `SELECT left(procedure, 1) pfx, count(*) n,
              count(*) FILTER (WHERE price_eur <= 0 OR price_eur > 30000) bad
         FROM nzok_pathway_tariff_latest
        GROUP BY 1`,
    );
    const by = Object.fromEntries(rows.map((r) => [r.pfx, r]));
    for (const [pfx, floor] of [
      ["P", 300],
      ["A", 40],
      ["K", 5],
    ] as const)
      assert.ok(
        Number(by[pfx]?.n ?? 0) >= floor,
        `${pfx}-prefixed tariffs: ${by[pfx]?.n ?? 0} < ${floor} — a whole article table was lost in the parse`,
      );
    // Ceiling €30k: the 2025 max is P118 = €19,671.96, and a parse/currency
    // defect lands orders of magnitude out, not 50% out.
    for (const r of rows)
      assert.equal(
        Number(r.bad),
        0,
        `${r.pfx}: tariffs outside (0, €30k] — a parse or currency-conversion defect`,
      );
  },
);

const haveActivities =
  haveDb &&
  (
    await allRows<{ n: string }>(
      "SELECT count(*) n FROM nzok_activities",
    ).catch(() => [{ n: "0" }])
  ).some((r) => Number(r.n) > 0);

test.skipIf(skip || (!haveActivities && "nzok_activities is empty"))(
  "tariffs actually join the activity corpus",
  async () => {
    const [row] = await allRows<{ pct: string }>(
      `WITH y AS (SELECT max(period) AS p FROM nzok_activities)
     SELECT round(100.0 * sum(a.cases) FILTER (WHERE t.price_eur IS NOT NULL)
                  / NULLIF(sum(a.cases), 0), 1) AS pct
       FROM nzok_activities a
       LEFT JOIN nzok_pathway_tariff_latest t ON t.procedure = a.procedure
      WHERE a.period = (SELECT p FROM y)`,
    );
    assert.ok(
      Number(row.pct) >= 85,
      `only ${row.pct}% of latest-period cases carry a tariff — the join keys have drifted ` +
        "(P/A/K prefix + zero-padding must match nzok_activities.procedure; measured 96.5% at first load)",
    );
  },
);
