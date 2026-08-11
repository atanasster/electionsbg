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
    // "…and is now UNREACHABLE" is the second half of the invariant, and it is what makes the
    // assertion survive the re-spelling dedupe. The writer deliberately drops a retained
    // record whose normalised name is already on the current bench (it was the same human
    // under a second spelling, and keeping it split them across two /person profiles), which
    // legitimately removes that raw name from the roster — but the human is still served, and
    // the orphaned slug gets a redirect to them. Exempting on the REDIRECT rather than on a
    // re-derived normName keeps the rule in one place: the normalisation lives in TypeScript
    // (`@/data/judiciary/normName`), and restating it in SQL here is exactly the drift this
    // repo keeps getting bitten by.
    //
    // The teeth are unaffected: a roster that reverts to latest-year-only orphans ~460
    // magistrates whose mention no longer exists, so the resolver cannot pair them and NONE of
    // them gets a redirect (that is the whole reason this file exists).
    const dropped = await allRows<{ name: string }>(
      `SELECT substr(l.mention_id, 12) AS name
         FROM person_slug_lock l
        WHERE l.mention_id LIKE 'magistrate:%'
          AND NOT EXISTS (
                SELECT 1 FROM magistrate m
                 WHERE m.name = substr(l.mention_id, 12))
          AND NOT EXISTS (
                SELECT 1 FROM person p WHERE p.slug = l.slug)
          AND NOT EXISTS (
                SELECT 1 FROM person_slug_retired r WHERE r.slug = l.slug)
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

// Retention must not RESURRECT a serving magistrate under a second spelling — the mirror image
// of the defect this file exists for, and the one the first cut of the retention shipped.
// `magistrate.name` is a PK on the register's RAW string and the register is inconsistent about
// hyphen spacing across years („… Средкова - Петрова" in 2025, „… Средкова-Петрова" in 2026), so
// a retained row can be the same human as a current one. resolve_persons.ts keys its mention on
// that raw name and cannot merge two same-name magistrates (no corroborant — the merge the
// codebase forbids), so each spelling mints its own person row: one human, two live indexable
// /person profiles, each holding half the record. Measured 2026-08-11: 2 pairs, 4 person rows.
//
// `name_norm` is also the /person lookup key, so a collision additionally makes
// magistrate_by_name() ambiguous — see the newest-filing test below.
test.skipIf(skip)("no two magistrates share a normalised name", async () => {
  const dupes = await allRows<{ name_norm: string; names: string }>(
    `SELECT name_norm,
            string_agg(name || ' @' || decl_year, ' | ' ORDER BY decl_year) AS names
       FROM magistrate GROUP BY name_norm HAVING count(*) > 1`,
  );
  assert.deepEqual(
    dupes,
    [],
    "two magistrate rows normalise to one name — the roster is retaining a prior-year " +
      "SPELLING of someone still on the bench, which splits one human across two /person " +
      "profiles. Fix in scripts/judiciary/__write_magistrate_holdings.ts (it drops a retained " +
      "record whose normName is already on the current bench), NOT in the resolver, which " +
      "cannot tell a spelling variant from a genuine namesake",
  );
});

// The /person tile must serve a magistrate's MOST RECENT filing. `name_norm` is not unique and
// the table spans years, so an unordered LIMIT 1 publishes an arbitrary row — a year-stale
// declared-cash figure on a named judge, self-consistently labelled with its own older year,
// which is why it reads as correct. Survives the dedupe above: two genuine namesakes whose
// spellings normalise together would still hit the arbitrary pick.
test.skipIf(skip)("magistrate_by_name serves the newest filing", async () => {
  const stale = await allRows<{
    name_norm: string;
    served: number;
    newest: number;
  }>(
    `SELECT m.name_norm,
            (magistrate_by_name(m.name_norm) ->> 'year')::int AS served,
            max(m.decl_year)                                  AS newest
       FROM magistrate m
      GROUP BY m.name_norm
     HAVING (magistrate_by_name(m.name_norm) ->> 'year')::int < max(m.decl_year)
      LIMIT 5`,
  );
  assert.deepEqual(
    stale,
    [],
    "magistrate_by_name() returned an older filing than the table holds — /person is " +
      "publishing a stale declared figure. Its ORDER BY has been dropped or weakened",
  );
});

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
