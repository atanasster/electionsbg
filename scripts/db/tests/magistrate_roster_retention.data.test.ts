// The magistrate roster ACCUMULATES — it does not track the current bench.
//
// WHY THIS GATE EXISTS. `magistrate_holdings.json` was written as a "latest year, annual
// declarations only" snapshot, and `resolve_persons.ts` builds its magistrate mentions from
// `SELECT name, court FROM magistrate`. So the ИВСС register's yearly turnover propagated
// straight through the identity layer: when the 2026 register landed (commit 77a98d9d95),
// 462 magistrates who had filed in 2025 left the roster, lost their mention, lost their
// person row, and 404'd every /person URL they had ever been served under.
//
// No redirect can repair that after the fact, which is what makes it worth a gate of its own
// rather than leaving it to person_slug_retired.data.test.ts downstream: the person is gone,
// so there is nothing to redirect TO, and the handful with a same-name person are namesakes
// (a name-matched redirect would attribute a stranger's judicial record). The only fix is to
// not lose them, so this asserts the retention directly — and fails naming the cause instead
// of sending the reader to an officials-slug rename map that cannot apply.
//
// Auto-skips when Postgres is down or the table is unloaded, like the other *.data.test.ts
// gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM magistrate",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / magistrate table empty";

afterAll(async () => {
  await end();
});

// THE INVARIANT, stated against the lock rather than against a count. The lock is the record
// of every slug the person layer has ever served, so "a magistrate mention it served is no
// longer in the roster" is exactly the loss this file is about — and it is measured, not
// assumed: a threshold on the row count would pass a run that dropped 462 and gained 483.
test.skipIf(skip)(
  "no magistrate the person layer has served has left the roster",
  async () => {
    const dropped = await allRows<{ name: string }>(
      `SELECT substr(l.mention_id, 12) AS name
         FROM person_slug_lock l
        WHERE l.mention_id LIKE 'magistrate:%'
          AND NOT EXISTS (
                SELECT 1 FROM magistrate m
                 WHERE m.name = substr(l.mention_id, 12))
        LIMIT 5`,
    );
    assert.deepEqual(
      dropped,
      [],
      "magistrates the lock has served are absent from `magistrate` — the roster has gone " +
        "back to tracking the latest year only. Their /person pages 404 with no redirect " +
        "possible. See the roster comment in scripts/judiciary/__write_magistrate_holdings.ts",
    );
  },
);

// The retention has to be VISIBLE, not merely un-violated. On a database loaded before the
// register first turned over, every magistrate legitimately shares one decl_year and the
// assertion above passes vacuously — so pin that the column is actually per-magistrate.
// This is the assertion that would have caught the loader still writing the file-level
// `year` to every row (it did, until 2026-08-11).
test.skipIf(skip)(
  "decl_year is per magistrate, not one value for the table",
  async () => {
    const [r] = await allRows<{ years: string; retained: string }>(
      `SELECT count(DISTINCT decl_year)::text AS years,
            count(*) FILTER (
              WHERE decl_year < (SELECT max(decl_year) FROM magistrate))::text AS retained
       FROM magistrate`,
    );
    assert.ok(
      Number(r.years) > 1,
      `every magistrate carries the same decl_year (${r.years} distinct) — either the roster ` +
        `is latest-year only again, or load_magistrates_pg.ts is writing the file-level ` +
        `\`year\` instead of each record's \`declYear\``,
    );
    assert.ok(
      Number(r.retained) > 0,
      "no magistrate is carried from an earlier year — the roster is not retaining anyone",
    );
  },
);

// The retention must not leak into the year-labelled surfaces. `magistrate_overview()` says
// „N магистрати … за <year> г. (от M проверени)", so it is scoped to the current bench; a
// retained magistrate's 2025 filing counted into it would leave the arithmetic right and the
// sentence false. Pinned because the scoping lives in SQL, three functions away from the
// roster change that made it necessary.
test.skipIf(skip)(
  "the /judiciary tile counts only the current bench",
  async () => {
    const [o] = await allRows<{ with_holdings: number; roster_total: number }>(
      `SELECT (magistrate_overview(1) -> 'stats' ->> 'withHoldings')::int AS with_holdings,
            (magistrate_overview(1) -> 'stats' ->> 'rosterTotal')::int  AS roster_total`,
    );
    const [t] = await allRows<{
      cur: string;
      all: string;
      cur_holders: string;
    }>(
      `SELECT count(*) FILTER (
              WHERE decl_year = (SELECT max(decl_year) FROM magistrate))::text AS cur,
            count(*)::text AS all,
            count(*) FILTER (
              WHERE company_count > 0
                AND decl_year = (SELECT max(decl_year) FROM magistrate))::text AS cur_holders
       FROM magistrate`,
    );
    assert.equal(
      o.roster_total,
      Number(t.cur),
      `the tile's rosterTotal (${o.roster_total}) is not the current bench (${t.cur}) — ` +
        `it is counting the ${Number(t.all) - Number(t.cur)} retained magistrates into a ` +
        `figure the page labels with a single year`,
    );
    assert.equal(
      o.with_holdings,
      Number(t.cur_holders),
      "the tile's withHoldings includes magistrates off the current bench",
    );
  },
);
