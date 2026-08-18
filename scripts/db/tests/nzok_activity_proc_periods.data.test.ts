// The MONTHLY activity panel (053, `nzok_activity_proc_periods`).
//
// Four properties, each with a silent failure mode:
//
//  1. It reconciles EXACTLY to the annual matrix per year. The two are the same
//     rows either side of the fold across months, so any drift means one
//     aggregation lost or double-counted a period — and nothing else would show
//     it, since both tables would still be internally consistent.
//  2. `nzok_activities` stays ANNUAL. Ten call sites across five migrations read
//     `max(period) FROM nzok_activities` meaning "the latest annual matrix";
//     re-graining it to months would silently turn every one of them into a
//     one-month figure — the case-mix ratio would compare one month of cases to
//     a full year of payments, wrong by ~12x at a 200 (plan §8e hazard 2).
//  3. The panel is keyed on the ENTITY, not the facility name. НЗОК renames
//     facilities mid-year; two folds resolving to one entity must be summed, not
//     inserted twice.
//  4. Its changelog key carries the PERIOD. `nzok_activities` keys on
//     EXTRACT(YEAR FROM period), which for a monthly table would collapse twelve
//     rows into one first-seen key and report eleven months as nothing new
//     (plan §10c-4).
//
// Auto-skips when Postgres is down or the panel has never been loaded.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const loaded =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*) n FROM nzok_activity_proc_periods",
      ).catch(() => [{ n: "0" }])
    )[0]?.n ?? 0,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !loaded
    ? "nzok_activity_proc_periods is empty (run db:load:nzok-activities:pg)"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "the monthly panel reconciles to the annual matrix, per year",
  async () => {
    const rows = await allRows<{ yr: number; monthly: string; annual: string }>(
      `SELECT y.yr,
              (SELECT COALESCE(sum(cases),0) FROM nzok_activity_proc_periods p
                 WHERE EXTRACT(YEAR FROM p.period) = y.yr) AS monthly,
              (SELECT COALESCE(sum(cases),0) FROM nzok_activities a
                 WHERE EXTRACT(YEAR FROM a.period) = y.yr) AS annual
         -- Years come from nzok_activities, NOT the panel. Driven from the
         -- panel, a year whose rows were wiped simply disappears from the list
         -- and the test passes — which is the exact failure it exists to catch.
         FROM (SELECT DISTINCT EXTRACT(YEAR FROM period)::int yr
                 FROM nzok_activities) y
        ORDER BY 1`,
    );
    assert.ok(rows.length > 0, "no years in the panel");
    for (const r of rows)
      assert.equal(
        r.monthly,
        r.annual,
        `${r.yr}: monthly ${r.monthly} != annual ${r.annual} — one aggregation ` +
          "lost or double-counted a period",
      );
  },
);

test.skipIf(skip)(
  "nzok_activities stays ANNUAL — one period per year",
  async () => {
    const [r] = await allRows<{ periods: string; years: string }>(
      `SELECT count(DISTINCT period) periods,
              count(DISTINCT EXTRACT(YEAR FROM period)) years
         FROM nzok_activities`,
    );
    assert.equal(
      r.periods,
      r.years,
      "nzok_activities carries more than one period per year — it has been " +
        "re-grained to months, which silently redefines `max(period)` for the " +
        "ten call sites that read it as the latest ANNUAL matrix (plan §8e hazard 2)",
    );
    // …and every label is a January 1st, so max(period) orders by year.
    const [j] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM nzok_activities WHERE EXTRACT(MONTH FROM period) <> 1",
    );
    assert.equal(j.n, "0", "an annual row is not labelled on 1 January");
  },
);

test.skipIf(skip)(
  "the panel is keyed on the entity, so a mid-year rename is one row",
  async () => {
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM (
         SELECT 1 FROM nzok_activity_proc_periods
          GROUP BY period, entity_key, procedure HAVING count(*) > 1) d`,
    );
    assert.equal(
      r.n,
      "0",
      "a (period, entity, procedure) triple carries more than one row — the " +
        "entity re-key did not collapse two facility spellings",
    );
    // The panel must see the SAME entity universe as the annual matrix.
    const [e] = await allRows<{ panel: string; annual: string }>(
      `SELECT (SELECT count(DISTINCT entity_key) FROM nzok_activity_proc_periods) panel,
              (SELECT count(DISTINCT entity_key) FROM nzok_activities) annual`,
    );
    assert.equal(e.panel, e.annual, "entity universes disagree");
  },
);

test.skipIf(skip)("the panel records NO changelog of its own", async () => {
  // Deliberate, and it supersedes plan §10c-4. The panel is the same corpus
  // change `nzok_activities` already reports — same loader, same transaction,
  // same file — so a second batch reports one event twice. It also cost: 291,414
  // extra ingest_first_seen rows on a two-year load, 94% of everything the
  // one-day window holds, which failed recent_updates_plan.data.test.ts at
  // 308,980 rows scanned. Summary mode does not help; the branch still scans.
  const [r] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM ingest_first_seen WHERE source = 'nzok_activity_proc_periods'",
  );
  assert.equal(
    r.n,
    "0",
    "the monthly panel is recording a changelog again — it double-reports the " +
      "nzok_activities batch and permanently inflates every recent-window scan",
  );
});
