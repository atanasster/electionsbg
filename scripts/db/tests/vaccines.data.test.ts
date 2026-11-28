// Postgres gates for the flu-vaccine corpus (migration 206, db:load:vaccines:pg).
//
// The page answers „how far is this season behind the last one", and every way
// it can be wrong still renders a plausible number:
//
//   1. THE TWO НЗИС PRODUCTS STOP AGREEING. The monthly info-app cells and the
//      report page's year-to-date counter are the same registry; for a CLOSED
//      year they must reconcile. If they drift, one of the two parses is wrong.
//   2. AN OBLAST GOES MISSING. A 27-oblast corpus ranks perfectly well.
//   3. A VACCINE LANDS IN THE WRONG FAMILY. A flu vaccine filed under "other"
//      silently drops out of every flu figure.
//   4. THE SEASON BOUNDARY MOVES. A January shot belongs to the season that
//      began the previous August; grouping by calendar year puts the tail of one
//      campaign into the next and every comparison shifts.
//   5. A PARTIAL MONTH IS COMPARED AS WHOLE. The info-app's data stop days
//      before its fetch, so the fetch month is partial (§7.4).
//
// The monthly cells come from a gitignored cache, so a database that has the
// tables but no monthly rows SKIPS with its own reason. Postgres unreachable is
// a skip too. Everything after that is an assertion.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allRows,
  dbReachable,
  end,
  pinLocalDatabase,
  withClient,
} from "../lib/pg";
import { RECONCILE_TOLERANCE } from "../load_vaccines_pg";
import { reportSkip } from "../../lib/report_skip";
import { CACHE_DIR, CACHE_FILES } from "../../health/vaccines/snapshot";

// The mutation check below replaces flu_season() inside a rolled-back
// transaction; never let that run against the serving database.
pinLocalDatabase();

const haveDb = await dbReachable();
const monthlyRows = haveDb
  ? (
      await allRows<{ n: number | null }>(
        `SELECT CASE WHEN to_regclass('his_immunization_month') IS NULL THEN NULL
                     ELSE (SELECT count(*)::int FROM his_immunization_month) END AS n`,
      )
    )[0]?.n
  : null;
// An empty table with the cache file present is not an absent cache: the
// loader refused the file (it keeps the previous vintage, which on a first load
// is nothing). That is a failure, asserted below, never a skip.
const cachePresent = existsSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    CACHE_DIR,
    CACHE_FILES.infoapp,
  ),
);
const refused = monthlyRows === 0 && cachePresent;
const corpusSkip = !haveDb
  ? "Postgres unreachable"
  : monthlyRows === null
    ? "migration 206 not applied — run db:load:vaccines:pg"
    : monthlyRows !== 0
      ? false
      : cachePresent
        ? "the info-app cache was refused — see the failing gate"
        : "his_immunization_month is empty — the info-app cache is absent on this machine";
reportSkip(import.meta.url, corpusSkip);

test.skipIf(!refused)("a present info-app cache was loaded", () => {
  assert.fail(
    `${CACHE_FILES.infoapp} is present but his_immunization_month is empty — db:load:vaccines:pg refused it; re-run and read the refusal`,
  );
});

afterAll(async () => {
  if (haveDb) await end();
});

interface CurvePoint {
  month: string;
  m: number;
  n: number;
  cum: number;
}
interface Overview {
  season: number;
  seasons: number[];
  asOf: Record<string, string>;
  curve: { seasons: { season: number; points: CurvePoint[] }[] };
  recorded: {
    completeThrough: string | null;
    completeTotal: number | null;
    sameMonthsLastSeason: number | null;
  };
}

const overview = async (season: number | null): Promise<Overview> => {
  const [row] = await allRows<{ r: Overview | null }>(
    "SELECT vaccines_overview($1) AS r",
    [season],
  );
  assert.ok(row?.r, "vaccines_overview returned NULL on a loaded corpus");
  return row.r;
};

/** Per (season, month) flu shots, recounted from the cells with the season
 *  rule written out here rather than borrowed from flu_season(). */
const recountCurve = async (): Promise<Map<string, number>> => {
  const rows = await allRows<{ s: number; p: string; n: number }>(
    `SELECT (EXTRACT(year FROM m.period)::int
             - CASE WHEN EXTRACT(month FROM m.period) < 8 THEN 1 ELSE 0 END) AS s,
            to_char(m.period, 'YYYY-MM') AS p, sum(m.n)::int AS n
       FROM his_immunization_month m
       JOIN his_vaccine_dim d USING (vaccine_code)
      WHERE d.family IN ('flu', 'flu_nasal')
      GROUP BY 1, 2`,
  );
  return new Map(rows.map((r) => [`${r.s}|${r.p}`, r.n]));
};

/** Both directions: every emitted point matches the recount, every recount
 *  month of an emitted season is emitted, and `cum` is the running sum. */
const curveMatches = (o: Overview, recount: Map<string, number>): boolean =>
  o.curve.seasons.every((s) => {
    const emitted = s.points.map((p) => p.month).sort();
    const expected = [...recount.keys()]
      .filter((k) => Number(k.split("|")[0]) === s.season)
      .map((k) => k.split("|")[1] ?? "")
      .sort();
    if (emitted.join() !== expected.join()) return false;
    let running = 0;
    return [...s.points]
      .sort((a, b) => a.month.localeCompare(b.month))
      .every((p) => {
        running += p.n;
        return (
          recount.get(`${s.season}|${p.month}`) === p.n && p.cum === running
        );
      });
  });

test.skipIf(corpusSkip)(
  "a closed year's monthly cells reconcile with the report page",
  async () => {
    // Latest capture per (closed year, vaccine) of the report page's counter,
    // against the same year's monthly cells. "Closed" is on the loader's UTC
    // clock, so the two cannot disagree on 1 January. "other" exists only in the
    // info-app; the page has no such row (the loader's own exemption).
    const rows = await allRows<{
      year: number;
      key: string;
      page: number;
      cells: number;
    }>(
      `WITH page AS (
         SELECT DISTINCT ON (year, key) year, key, n_ytd
           FROM his_immunization_daily
          WHERE scope = 'vaccine'
            AND year < EXTRACT(year FROM now() AT TIME ZONE 'UTC')::int
          ORDER BY year, key, valid_from DESC
       ),
       cells AS (
         SELECT EXTRACT(year FROM period)::int AS year, vaccine_code AS key,
                sum(n)::int AS n
           FROM his_immunization_month GROUP BY 1, 2
       )
       -- Keys from BOTH products, as the loader compares them: a vaccine with
       -- cells in a closed year but no page row is a dropped page row.
       SELECT year, key, coalesce(p.n_ytd, 0) AS page, coalesce(c.n, 0) AS cells
         FROM page p FULL JOIN cells c USING (year, key)
        WHERE year IN (SELECT year FROM page) AND key <> 'other'`,
    );
    assert.ok(
      rows.length > 0,
      "no closed year has a captured report page — nothing reconciled",
    );
    const off = rows.filter(
      (r) =>
        Math.abs(r.page - r.cells) > Math.max(2, r.page * RECONCILE_TOLERANCE),
    );
    assert.deepEqual(
      off.map((r) => `${r.year} ${r.key}: page ${r.page}, cells ${r.cells}`),
      [],
    );
  },
);

test.skipIf(corpusSkip)(
  "all 28 oblasts are in the corpus and on the page",
  async () => {
    const [c] = await allRows<{ cells: number; dim: number; missing: number }>(
      `SELECT (SELECT count(DISTINCT oblast_code)::int FROM his_immunization_month) AS cells,
            (SELECT count(*)::int FROM place_dim WHERE kind = 'oblast') AS dim,
            (SELECT count(DISTINCT oblast_code)::int FROM his_immunization_month m
              WHERE NOT EXISTS (SELECT 1 FROM place_dim d
                                 WHERE d.kind = 'oblast' AND d.code = m.oblast_code)) AS missing`,
    );
    assert.equal(c?.dim, 28);
    assert.equal(c?.cells, 28);
    assert.equal(
      c?.missing,
      0,
      "a monthly cell names an oblast place_dim lacks",
    );
    // Per SEASON, for the season the page serves: an all-history count stays 28
    // when one oblast drops out of this season, and vaccines_oblast() returns 28
    // rows whatever the cells say (it drives from place_dim).
    const o = await overview(null);
    const [s] = await allRows<{ n: number }>(
      `SELECT count(DISTINCT m.oblast_code)::int AS n
         FROM his_immunization_month m JOIN his_vaccine_dim d USING (vaccine_code)
        WHERE d.family IN ('flu', 'flu_nasal') AND flu_season(m.period) = $1`,
      [o.season],
    );
    assert.equal(
      s?.n,
      28,
      `season ${o.season} has flu cells for ${s?.n} of 28 oblasts`,
    );
    const rows = await allRows<{
      oblast_code: string;
      pop60: number | null;
      per1000: number | null;
      complete_through: string | null;
    }>(
      "SELECT oblast_code, pop60, per1000, complete_through FROM vaccines_oblast($1, 'flu_all')",
      [o.season],
    );
    assert.equal(rows.length, 28);
    assert.deepEqual(
      rows.filter((r) => r.pop60 === null).map((r) => r.oblast_code),
      [],
      "an oblast has no population denominator",
    );
    assert.deepEqual(
      rows
        .filter((r) => r.complete_through !== null && r.per1000 === null)
        .map((r) => r.oblast_code),
      [],
      "an oblast has no rate although the season has a complete month",
    );
  },
);

test.skipIf(corpusSkip)("no vaccine is unclassified or misfiled", async () => {
  // Every key either НЗИС product carries must be in the dimension…
  const unknown = await allRows<{ key: string }>(
    `SELECT DISTINCT key FROM his_immunization_daily h
      WHERE scope = 'vaccine'
        AND NOT EXISTS (SELECT 1 FROM his_vaccine_dim d WHERE d.vaccine_code = h.key)`,
  );
  assert.deepEqual(unknown, []);
  // …and a vaccine whose own label names influenza or COVID must be in that
  // family, or it silently leaves every flu figure.
  const misfiled = await allRows<{ vaccine_code: string; family: string }>(
    `SELECT vaccine_code, family FROM his_vaccine_dim
      WHERE (label_en ~* 'influenza' AND family NOT IN ('flu', 'flu_nasal'))
         OR (label_en ~* 'covid' AND family <> 'covid')`,
  );
  assert.deepEqual(misfiled, []);
  const [f] = await allRows<{ n: number }>(
    "SELECT count(*)::int AS n FROM his_vaccine_dim WHERE family IN ('flu', 'flu_nasal')",
  );
  assert.ok(
    (f?.n ?? 0) >= 2,
    "the flu family is empty — every flu figure is 0",
  );
});

test.skipIf(corpusSkip)(
  "a season runs 1 August – 31 July, named by its start year",
  async () => {
    const [r] = await allRows<Record<string, number>>(
      `SELECT flu_season('2025-07-31') AS jul, flu_season('2025-08-01') AS aug,
              flu_season('2025-12-31') AS dec, flu_season('2026-01-15') AS jan`,
    );
    assert.deepEqual(r, { jul: 2024, aug: 2025, dec: 2025, jan: 2025 });
  },
);

const dailyPairs =
  corpusSkip || !haveDb
    ? 0
    : ((
        await allRows<{ n: number }>(
          `SELECT count(*)::int AS n FROM (
             SELECT lag(valid_from) OVER (PARTITION BY year, scope, key ORDER BY valid_from) AS prev
               FROM his_immunization_daily) x
            WHERE prev IS NOT NULL`,
        )
      )[0]?.n ?? 0);
const dailySkip =
  corpusSkip ||
  (dailyPairs === 0
    ? "his_immunization_daily has one capture per counter — nothing to order yet"
    : false);
if (!corpusSkip) reportSkip(import.meta.url, dailySkip);

test.skipIf(dailySkip)(
  "the daily counter only moves forward within a year, in an unbroken chain",
  async () => {
    const bad = await allRows<{ year: number; key: string; why: string }>(
      `SELECT year, key, CASE WHEN prev IS NOT NULL AND n_ytd < prev THEN 'decrease'
                              ELSE 'broken valid_to chain' END AS why
         FROM (
           SELECT year, scope, key, n_ytd, valid_to,
                  lag(n_ytd) OVER w AS prev, lead(valid_from) OVER w AS next_from
             FROM his_immunization_daily
           WINDOW w AS (PARTITION BY year, scope, key ORDER BY valid_from)) x
        WHERE (prev IS NOT NULL AND n_ytd < prev)
           OR valid_to IS DISTINCT FROM next_from`,
    );
    assert.deepEqual(bad, []);
  },
);

test.skipIf(corpusSkip)(
  "the overview's curve groups by the season rule, and the check discriminates",
  async () => {
    const recount = await recountCurve();
    const o = await overview(null);
    assert.ok(
      o.curve.seasons.some((s) => s.points.length > 0),
      "the curve is empty — nothing to compare",
    );
    assert.ok(curveMatches(o, recount), "curve disagrees with the recount");

    // Mutation: with a calendar-year flu_season() the curve must STOP matching,
    // or the assertion above would pass on an implementation that ignored the
    // season boundary. Rolled back; nothing persists.
    const mutated = await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(
          `CREATE OR REPLACE FUNCTION flu_season(d date) RETURNS integer
             LANGUAGE sql IMMUTABLE PARALLEL SAFE
             AS $$ SELECT EXTRACT(year FROM d)::int $$`,
        );
        const r = await c.query<{ r: Overview }>(
          "SELECT vaccines_overview($1) AS r",
          [o.season],
        );
        return r.rows[0]?.r ?? null;
      } finally {
        await c.query("ROLLBACK");
      }
    });
    assert.ok(mutated, "mutated overview returned NULL");
    assert.equal(
      curveMatches(mutated, recount),
      false,
      "a calendar-year season still matched the recount — the check is vacuous",
    );
  },
);

test.skipIf(corpusSkip)(
  "complete months stop before the fetch month, and both seasons are cut there",
  async () => {
    const o = await overview(null);
    const r = o.recorded;
    if (r.completeThrough === null) {
      // No complete month (or no fetch stamp): every to-date figure is NULL
      // rather than a partial month read as whole.
      assert.equal(r.completeTotal, null);
      assert.equal(r.sameMonthsLastSeason, null);
      return;
    }
    const fetched = o.asOf.his_monthly;
    assert.ok(fetched, "a cut with no his_monthly fetch stamp");
    assert.ok(
      r.completeThrough < fetched.slice(0, 7),
      `completeThrough ${r.completeThrough} is not before the fetch month ${fetched.slice(0, 7)}`,
    );
    const recount = await recountCurve();
    const sum = (season: number, through: string) =>
      [...recount]
        .filter(([k]) => {
          const [s, p] = k.split("|");
          return Number(s) === season && p <= through;
        })
        .reduce((a, [, n]) => a + n, 0);
    // The oblast map's copy of the cut must land on the same month.
    const cuts = await allRows<{ c: string | null }>(
      "SELECT DISTINCT complete_through AS c FROM vaccines_oblast($1, 'flu_all')",
      [o.season],
    );
    assert.deepEqual(
      cuts.map((x) => x.c),
      [r.completeThrough],
    );
    const [y, mo] = r.completeThrough.split("-");
    assert.equal(r.completeTotal, sum(o.season, r.completeThrough));
    assert.equal(
      r.sameMonthsLastSeason,
      sum(o.season - 1, `${Number(y) - 1}-${mo}`),
    );
  },
);
