// cpv_catalog (121) must be POPULATED and must match its source.
//
// WHY: /api/db/cpv-catalog used to compute this list live — a full scan of
// `tenders` plus an external-merge sort, on every mount of the contracts and
// tenders browsers. 130 ms locally, 17.7 s and 20.8 s on two consecutive prod
// calls, one of which 500'd. It now reads a table rebuilt by load_tenders_pg.
//
// That trades a slow query for a STALENESS risk, and the failure is quiet: an
// empty or stale table serves an empty/wrong CPV picker with a 200. Since the
// route can no longer detect it (there is nothing to compare against at request
// time), the gate has to.
//
// Auto-skips when Postgres is down or `tenders` is empty — like the other
// *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const tendersLoaded =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*) n FROM tenders WHERE cpv IS NOT NULL AND btrim(COALESCE(cpv_desc,'')) <> ''",
      ).catch(() => [{ n: "0" }])
    )[0]?.n ?? 0,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !tendersLoaded
    ? "tenders corpus has no described CPV codes"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)("cpv_catalog is populated", async () => {
  const [r] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM cpv_catalog",
  );
  assert.ok(
    Number(r.n) > 0,
    "cpv_catalog is EMPTY — run `SELECT rebuild_cpv_catalog();` (db:load:tenders:pg " +
      "does this at the end of a tenders load). An empty table serves an empty CPV " +
      "filter with a 200, which is the silent failure this table was created to end",
  );
});

test.skipIf(skip)(
  "cpv_catalog matches the query it replaced, exactly",
  async () => {
    // The route's old SQL, verbatim. Any drift — a code missing, an extra, or a
    // different description winning the "longest" tiebreak — means the browsers'
    // CPV picker describes a corpus that no longer exists.
    const [r] = await allRows<{
      only_source: string;
      only_table: string;
      differing: string;
    }>(
      `WITH src AS (
         SELECT DISTINCT ON (cpv) cpv, cpv_desc AS d
           FROM tenders
          WHERE cpv IS NOT NULL AND cpv_desc IS NOT NULL AND btrim(cpv_desc) <> ''
          -- Same tiebreak as rebuild_cpv_catalog(); without it the two
          -- DISTINCT ON results can diverge on equal-length descriptions and
          -- this gate reports staleness that is not there.
          ORDER BY cpv, length(cpv_desc) DESC, cpv_desc
       )
       SELECT count(*) FILTER (WHERE c.cpv IS NULL)::text AS only_source,
              count(*) FILTER (WHERE s.cpv IS NULL)::text AS only_table,
              count(*) FILTER (WHERE s.cpv IS NOT NULL AND c.cpv IS NOT NULL
                                 AND s.d IS DISTINCT FROM c."desc")::text AS differing
         FROM src s FULL JOIN cpv_catalog c ON c.cpv = s.cpv`,
    );
    assert.deepEqual(
      {
        onlySource: r.only_source,
        onlyTable: r.only_table,
        differing: r.differing,
      },
      { onlySource: "0", onlyTable: "0", differing: "0" },
      "cpv_catalog is stale against `tenders` — re-run db:load:tenders:pg (or " +
        "SELECT rebuild_cpv_catalog()). onlySource = codes the corpus has and the " +
        "table lacks; onlyTable = codes left over from a previous corpus",
    );
  },
);

test.skipIf(skip)("every catalogue entry is usable", async () => {
  // The picker searches on both columns, so a blank description is a row that
  // can never be found by name — and the source filter exists to prevent exactly
  // that. Cheap assertion that the filter survived into the table.
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM cpv_catalog
      WHERE btrim(cpv) = '' OR btrim("desc") = ''`,
  );
  assert.equal(r.n, "0", "catalogue rows with an empty code or description");
});
