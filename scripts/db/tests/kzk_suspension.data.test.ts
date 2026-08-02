// Every consumer of `kzk_appeals.suspension` must agree, and the status fallback
// must stay REACHABLE.
//
// 042 serves the effective suspended state through
// `kzk_effective_suspension(suspension, status)` = `COALESCE(suspension, status
// ~* 'спрян')`, documented as showing a live suspension without waiting for
// tier-2 and updating false→true on a re-scrape.
//
// TWO FAILURES THIS GATE EXISTS FOR, both of which have happened:
//
//  1. A stored `false` on 7,778 of 7,886 rows meant COALESCE never reached its
//     second argument, and the intake upsert could never move it. 1,501 appeals
//     had requested a temporary measure; at most 4 could ever display.
//  2. The expression was INLINED five times and one copy — `kzk_appeals_list`,
//     the base of the /procurement/appeals DbDataTable — read the RAW column. So
//     releasing the frozen column took that page from 4 chips to 0 while the
//     other four consumers correctly showed 4. An earlier version of this very
//     gate was green throughout, because it asserted against its own inlined copy
//     of the expression rather than against the serving path.
//
// Hence: assert through the REAL serving objects, never a re-implementation.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import {
  allRows,
  dbReachable,
  isServingDatabase,
  withClient,
  end,
} from "../lib/pg";

const haveDb = await dbReachable();
// Deliberately NOT `.catch(() => 0)`: swallowing a real error here would turn a
// broken database into a silent skip, which is the failure mode of a gate that
// tests nothing.
const appealCount = haveDb
  ? Number(
      (await allRows<{ n: string }>("SELECT count(*) n FROM kzk_appeals"))[0].n,
    )
  : 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : appealCount === 0
    ? "kzk_appeals is empty — run the КЗК intake crawl first"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "no row carries a stored suspension the intake snapshot could not have produced",
  async () => {
    // ⚠️ Mirrors the guard in scripts/procurement/kzk_unfreeze_suspension.ts. When
    // the определения arm lands and legitimately sets `true` on a non-'спрян' row,
    // BOTH must change together — and that script is deleted at that point, so
    // this is the copy that survives.
    const rows = await allRows<{ complaint_no: string; status: string }>(
      `SELECT complaint_no, status FROM kzk_appeals
        WHERE suspension IS TRUE AND status !~* 'спрян' LIMIT 5`,
    );
    assert.equal(
      rows.length,
      0,
      `${rows.length}+ row(s) marked suspended without a 'спрян' status — e.g. ` +
        `${rows[0]?.complaint_no}. If the определения crawl now sets this column ` +
        "authoritatively, delete scripts/procurement/kzk_unfreeze_suspension.ts and " +
        "update this gate; otherwise something wrote a value it could not know.",
    );
  },
);

test.skipIf(skip)(
  "every serving surface reports the same suspended set",
  async () => {
    // The four independent read paths, queried as the app queries them. This is
    // the assertion the inlined-copy version of this gate could not make, and it
    // is what would have caught the /procurement/appeals regression.
    // PER-ROW agreement, not count equality: kzk_recent_appeals() and
    // tender_appeals() are windowed (LIMIT 200 / one УНП), so their totals
    // legitimately differ from the corpus. What must hold is that wherever two
    // surfaces describe the SAME complaint, they say the same thing.
    const [r] = await allRows<{
      browser_mismatch: string;
      recent_mismatch: string;
      tender_mismatch: string;
      shared: string;
      raw_status: string;
    }>(
      `SELECT
         (SELECT count(*) FROM kzk_appeals_list l JOIN kzk_appeals a
                 ON a.complaint_no = l.complaint_no
           WHERE l.suspension IS DISTINCT FROM
                 kzk_effective_suspension(a.suspension, a.status))     AS browser_mismatch,
         (SELECT count(*) FROM jsonb_array_elements(kzk_recent_appeals(200)) e
             JOIN kzk_appeals a ON a.complaint_no = e->>'complaintNo'
           WHERE (e->>'suspension')::boolean IS DISTINCT FROM
                 kzk_effective_suspension(a.suspension, a.status))     AS recent_mismatch,
         (SELECT count(*) FROM kzk_appeals a,
                 LATERAL jsonb_array_elements(tender_appeals(a.unp)) e
           WHERE a.unp IS NOT NULL AND e->>'complaintNo' = a.complaint_no
             AND (e->>'suspension')::boolean IS DISTINCT FROM
                 kzk_effective_suspension(a.suspension, a.status))     AS tender_mismatch,
         (SELECT count(*) FROM kzk_appeals
           WHERE kzk_effective_suspension(suspension, status))         AS shared,
         (SELECT count(*) FROM kzk_appeals WHERE status ~* 'спрян')    AS raw_status`,
    );

    assert.equal(
      r.browser_mismatch,
      "0",
      `${r.browser_mismatch} row(s) where kzk_appeals_list disagrees with the shared ` +
        "expression. That view backs /procurement/appeals; if it selects the RAW " +
        "column again, the page silently disagrees with every other surface.",
    );
    assert.equal(
      r.recent_mismatch,
      "0",
      `${r.recent_mismatch} row(s) where kzk_recent_appeals() disagrees`,
    );
    assert.equal(
      r.tender_mismatch,
      "0",
      `${r.tender_mismatch} row(s) where tender_appeals() disagrees`,
    );
    // With the column released, the effective set IS the status set. If tier-2
    // ever populates `suspension` for real this may legitimately diverge — and the
    // first test above is what will say so.
    assert.equal(
      r.shared,
      r.raw_status,
      `${r.shared} appeals serve as suspended but ${r.raw_status} carry a 'спрян' ` +
        "status — the fallback is not tracking the intake. Run " +
        "`npx tsx scripts/procurement/kzk_unfreeze_suspension.ts --apply`.",
    );
  },
);

test.skipIf(skip)(
  "the gate discriminates — re-freezing the column makes a new suspension invisible",
  async () => {
    // A control, not a property: restore the exact frozen state in a rolled-back
    // transaction and confirm the serving path then FAILS to see a fresh
    // suspension. If this ever passes trivially, the gate above has stopped
    // meaning anything.
    if (isServingDatabase()) {
      // Never issue a 7.7k-row write against a serving database, even inside a
      // transaction that rolls back — it takes row locks on the live table.
      return;
    }

    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const froze = await c.query(
          "UPDATE kzk_appeals SET suspension = false WHERE status !~* 'спрян'",
        );
        assert.ok(
          (froze.rowCount ?? 0) > 0,
          "the re-freeze UPDATE matched no rows — this control is vacuous and " +
            "proves nothing about the assertions above",
        );

        const bumped = await c.query(
          `UPDATE kzk_appeals SET status = 'спряно производство'
            WHERE complaint_no IN (
              SELECT complaint_no FROM kzk_appeals WHERE suspension IS FALSE LIMIT 3)`,
        );
        assert.equal(
          bumped.rowCount,
          3,
          "expected to mark exactly 3 rows as newly suspended",
        );

        const [{ served, spryan }] = (
          await c.query<{ served: string; spryan: string }>(
            `SELECT (SELECT count(*) FROM kzk_appeals_list WHERE suspension) AS served,
                    (SELECT count(*) FROM kzk_appeals WHERE status ~* 'спрян') AS spryan`,
          )
        ).rows;

        assert.ok(
          Number(served) < Number(spryan),
          `with the column frozen the browser reported ${served} suspended against ` +
            `${spryan} rows carrying a 'спрян' status — they should DISAGREE. If they ` +
            "match, the frozen state is no longer detectable and this control is dead.",
        );
      } finally {
        await c.query("ROLLBACK");
      }
    });
  },
);
