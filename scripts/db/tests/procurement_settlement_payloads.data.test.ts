// procurement_settlement_payloads (123) must be COMPLETE, CURRENT and PLACED.
//
// WHY: /api/db/procurement-settlement used to run procurement_settlement_detail() live on
// every settlement page load and every My-Area tile. That is a GROUP BY over the
// settlement's whole contract set — 401 ms locally for София and 10.009 s on a cold Cloud
// SQL buffer cache, which is the /api/db statement_timeout exactly. It returned 500. The
// route now reads this matview and falls back to the live function on a miss.
//
// That trades a slow query for a STALENESS risk, and here the failure is quieter than
// usual, because the fallback is correct: a stale row serves last month's totals at a 200
// and a missing one is merely slow. Nothing on the serving side can detect either — the
// route has nothing to compare against at request time — so this gate has to.
//
// Auto-skips when Postgres is down or the matview has not been built, like the other
// *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { SCOPED_MATVIEWS } from "../lib/scopedMatviews";

// SKIP ON THE SOURCE, NEVER ON THE TARGET. Probing procurement_settlement_payloads to
// decide whether to run would make this gate skip green in the three states it exists to
// catch: the migration never applied, applied WITH NO DATA and never refreshed (exactly what
// an aborted scopes load leaves behind), or a loader that died mid-run. `dbReachable`'s own
// contract in lib/pg.ts is the rule here — SKIP when no server is reachable, FAIL on a
// reachable-but-broken install — and cpv_catalog / procurement_settlement_scope both gate on
// their inputs for the same reason.
const haveDb = await dbReachable();
const corpusLoaded =
  haveDb &&
  (
    await allRows<{ ok: boolean }>(
      `SELECT (SELECT count(*) FROM contracts) > 0
          AND (SELECT count(*) FROM procurement_scopes) > 0
          AND (SELECT count(*) FROM awarder_seats
                WHERE source = 'geo' AND is_local_hq AND ekatte IS NOT NULL) > 0 AS ok`,
    ).catch(() => [{ ok: false }])
  )[0]?.ok === true;

const skip = !haveDb
  ? "Postgres unreachable"
  : !corpusLoaded
    ? "no contracts / scopes / awarder_seats loaded"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "carries a row for every (scope × seated settlement), with no NULL payloads",
  async () => {
    const [r] = await allRows<{
      rows: string;
      expected: string;
      nulls: string;
    }>(
      `SELECT (SELECT count(*) FROM procurement_settlement_payloads) AS rows,
              (SELECT count(*) FROM procurement_scopes)
              * (SELECT count(DISTINCT ekatte) FROM awarder_seats
                  WHERE source = 'geo' AND is_local_hq AND ekatte IS NOT NULL) AS expected,
              (SELECT count(*) FROM procurement_settlement_payloads
                WHERE payload IS NULL) AS nulls`,
    );

    assert.equal(
      r.rows,
      r.expected,
      `procurement_settlement_payloads holds ${r.rows} rows for ${r.expected} ` +
        "(scope × settlement) pairs — a scope or a settlement gained rows without a " +
        "refresh. Run `npm run db:load:procurement-scopes:pg`. A partial matview does " +
        "not fail the route, it silently serves the LIVE function for whatever is " +
        "missing, which is the 10 s timeout this table was created to end",
    );
    // NULL means "no seated buyer at all" — a property of awarder_seats, never of the
    // window — so a NULL here means the fan-out picked up an ekatte the function rejects.
    assert.equal(r.nulls, "0", "no NULL payloads");
  },
);

test.skipIf(skip)(
  "the stored payload equals a live call, across all three scope kinds",
  async () => {
    // THE staleness check, and the one a row count cannot make: a matview refreshed before
    // the last contracts load has exactly the right number of rows and the wrong numbers in
    // them. Sampled across the size range — the three settlements that used to 500, one
    // mid-size, and a random tail — and across `all` / `ns:` / `y:`, because the windowed
    // scopes exercise the date bounds the unwindowed one does not.
    //
    // EXACT jsonb equality is safe despite contracts.amount_eur being double precision: the
    // function ROUNDs every money field to whole euro before emitting it and orders every
    // array by the rounded key with an eik/year tiebreak, so a parallel SUM's last-bit
    // noise cannot reach the output. That is the determinism convention 119 and the risk
    // indexes already follow.
    const rows = await allRows<{
      scope_key: string;
      ekatte: string;
      stale: boolean;
      contracts: number;
    }>(
      `WITH sample AS (
         (SELECT scope_key FROM procurement_scopes WHERE scope_key = 'all')
         UNION ALL
         -- ORDER BY date_from, not sort_ord: sort_ord is a DISPLAY order and runs the
         -- opposite way for the two families, so ordering by it DESC picks the newest YEAR
         -- but the OLDEST parliament — a 2005 window against a corpus that starts in 2011,
         -- i.e. eight empty comparisons and no aggregation checked at all for the ns: kind.
         -- The newest parliament is also the one that matters: open-ended upper bound, and
         -- the page's default scope.
         (SELECT scope_key FROM procurement_scopes WHERE scope_key LIKE 'ns:%'
           ORDER BY date_from DESC LIMIT 1)
         UNION ALL
         (SELECT scope_key FROM procurement_scopes WHERE scope_key LIKE 'y:%'
           ORDER BY date_from DESC LIMIT 1)
       ),
       places AS (
         -- The three that used to time out — by far the heaviest aggregates — plus five
         -- arbitrary-but-deterministic others for breadth.
         SELECT ekatte FROM (VALUES ('68134'), ('10135'), ('07079')) v(ekatte)
         UNION
         (SELECT ekatte FROM procurement_settlement_payloads
           WHERE scope_key = 'all' ORDER BY ekatte LIMIT 5)
       )
       SELECT p.scope_key, p.ekatte,
              (p.payload IS DISTINCT FROM
               procurement_settlement_detail(p.ekatte, sc.date_from, sc.date_to)) AS stale,
              (p.payload->>'contractCount')::int AS contracts
       FROM procurement_settlement_payloads p
       JOIN sample s  ON s.scope_key = p.scope_key
       JOIN places pl ON pl.ekatte   = p.ekatte
       JOIN procurement_scopes sc ON sc.scope_key = p.scope_key`,
    );

    // CARDINALITY FIRST. The sample is inner-joined on hard-coded EKATTEs and scope-key
    // patterns, so an EKATTE re-padding, a scope rename or a re-seating that drops one of
    // the three cities collapses it to zero rows — and an empty mismatch list is green.
    // A gate that silently stops comparing is worse than no gate.
    assert.equal(
      rows.length,
      24,
      `expected 3 scopes × 8 settlements = 24 comparisons, got ${rows.length} — the ` +
        "sample no longer resolves, so this gate is checking less than it claims",
    );
    assert.ok(
      rows.some((r) => r.contracts > 0),
      "every sampled pair is empty — the comparison would pass on any implementation",
    );

    assert.deepEqual(
      rows.filter((r) => r.stale).map((r) => `${r.scope_key}/${r.ekatte}`),
      [],
      "stored payloads disagree with a live procurement_settlement_detail() call — the " +
        "matview is STALE. Run `npm run db:load:procurement-scopes:pg`. Nothing on the " +
        "serving side can see this: the route returns the stored row with a 200",
    );
  },
);

test.skipIf(skip)(
  "a settlement with no contracts in a narrow window stores contractCount 0, not NULL",
  async () => {
    // The page's not-found branch keys on a null body. If a window with no activity stored
    // NULL instead of an empty-but-real payload, a settlement that simply awarded nothing
    // that year would render as "no such place" rather than "nothing in this period".
    const empties = await allRows<{ scope_key: string; ekatte: string }>(
      `SELECT scope_key, ekatte FROM procurement_settlement_payloads
        WHERE (payload->>'contractCount')::int = 0 LIMIT 1`,
    );
    assert.ok(
      empties.length > 0,
      "no zero-contract (scope × settlement) pair found at all — the sample this " +
        "assertion needs has vanished; check the fan-out still spans narrow windows",
    );

    const [r] = await allRows<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM procurement_settlement_payloads WHERE scope_key = $1 AND ekatte = $2",
      [empties[0].scope_key, empties[0].ekatte],
    );
    // Only the array assertion is real — `payload IS NOT NULL` and `contractCount = 0` just
    // restate the WHERE clause that selected this row. `awarders` is the one the page
    // actually maps over, and an empty period is exactly where a null would slip through.
    assert.deepEqual(r.payload.awarders, [], "an empty list, not null");
    assert.deepEqual(r.payload.byYear, [], "same for the by-year series");
  },
);

test.skipIf(skip)(
  "a placed settlement's stored hero fields survive the refresh",
  async () => {
    // §5.2. NOT implied by the equality test above, and that is the whole point: the place
    // JOINs inside 030 are LEFT and degrade to the Bulgarian awarder_seats strings, so a
    // matview built while place_dim was empty equals a live call made against that same
    // empty place_dim. The two agree precisely on the day the answer is wrong — and because
    // these fields are STORED, the degraded hero survives until the next refresh: a
    // settlement page with no English name, no map centroid and a breadcrumb that cannot
    // link up, served with a 200 against a dimension sitting there fully loaded.
    // `->>` on every field, never `->`. jsonb_build_object always emits the key, so `->` on
    // a JSON null returns 'null'::jsonb and is never SQL NULL — the comparison silently
    // matches nothing. Measured: `->'loc'` found 0 rows where `->>'loc'` finds 2.
    //
    // And gated PER FIELD against the dimension, not behind one `d.name_en IS NOT NULL`
    // proxy. The fields are independently sparse — 94 settlements have no `loc`, 88 no
    // `oblast_code`, and both synthetic settlements (София 68134 and Рудник 63183) have a
    // NULL centroid — so a blanket "if it has a name it must have everything" is red on
    // correct data. The real invariant is narrower and exactly right: whatever the dimension
    // holds, the stored payload must have carried it through.
    const blank = await allRows<{ ekatte: string; missing: string }>(
      `SELECT p.ekatte,
              concat_ws(', ',
                CASE WHEN d.name_en       IS NOT NULL
                      AND p.payload->>'nameEn'       IS NULL THEN 'nameEn'       END,
                CASE WHEN d.obshtina_code IS NOT NULL
                      AND p.payload->>'obshtinaCode' IS NULL THEN 'obshtinaCode' END,
                CASE WHEN d.oblast_code   IS NOT NULL
                      AND p.payload->>'oblastCode'   IS NULL THEN 'oblastCode'   END,
                CASE WHEN d.loc           IS NOT NULL
                      AND p.payload->>'loc'          IS NULL THEN 'loc'          END
              ) AS missing
         FROM procurement_settlement_payloads p
         JOIN place_dim d ON d.kind = 'settlement' AND d.code = p.ekatte
        WHERE p.scope_key = 'all'
          AND ((d.name_en       IS NOT NULL AND p.payload->>'nameEn'       IS NULL)
            OR (d.obshtina_code IS NOT NULL AND p.payload->>'obshtinaCode' IS NULL)
            OR (d.oblast_code   IS NOT NULL AND p.payload->>'oblastCode'   IS NULL)
            OR (d.loc           IS NOT NULL AND p.payload->>'loc'          IS NULL))
        ORDER BY p.ekatte
        LIMIT 5`,
    );

    assert.deepEqual(
      blank,
      [],
      "settlements whose place_dim row is fully populated have BLANK hero fields in the " +
        "stored payload — the matview was refreshed while place_dim was empty or " +
        "mid-reload. Run `npm run db:load:place-dim:pg` (it refreshes this matview when " +
        "the dimension actually changes), or `npm run db:load:procurement-scopes:pg`",
    );
  },
);

test.skipIf(skip)(
  "every scoped precompute the loader knows about exists and is populated",
  async () => {
    // Reads the loader's OWN list rather than restating it, so the two cannot drift.
    const rows = await allRows<{ mv: string; populated: boolean | null }>(
      `SELECT mv, (SELECT ispopulated FROM pg_matviews WHERE matviewname = mv) AS populated
         FROM unnest($1::text[]) AS mv`,
      [SCOPED_MATVIEWS.map((m) => m.name)],
    );
    assert.deepEqual(
      rows.filter((r) => r.populated !== true),
      [],
      "scoped precomputes missing or unpopulated — run `npm run db:load:procurement-scopes:pg`",
    );
  },
);

test.skipIf(skip)("no per-scope matview is missing from the list", async () => {
  // The CONVERSE, and the assertion that actually protects against drift. The test above
  // can only check the names somebody remembered to add; a migration that adds a per-scope
  // matview and forgets SCOPED_MATVIEWS is invisible at runtime — the loader never
  // refreshes it, and the page it feeds serves the vintage it was built with, for ever, at
  // a 200. Reading procurement_scopes is what makes a matview per-scope, so the catalogue
  // can be asked directly.
  const unlisted = await allRows<{ matviewname: string }>(
    `SELECT matviewname FROM pg_matviews
      WHERE schemaname = 'public'
        AND definition ILIKE '%procurement_scopes%'
        AND matviewname <> ALL($1::text[])
      ORDER BY matviewname`,
    [SCOPED_MATVIEWS.map((m) => m.name)],
  );
  assert.deepEqual(
    unlisted,
    [],
    "a matview reads procurement_scopes but is not in SCOPED_MATVIEWS " +
      "(scripts/db/lib/scopedMatviews.ts), so no loader ever refreshes it",
  );
});
