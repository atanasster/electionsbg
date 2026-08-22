// myarea_alerts (184) — the per-município activity feed, written by
// scripts/myarea/build_alerts.ts.
//
// Plan: docs/plans/json-retirement-v2.md Tier 4b.
//
// ⚠️ This table is STORAGE for a feed composed in TypeScript, so there is no SQL to check
// against. What IS checkable — and what the 290-file tree could never express — is that the
// feed is present, shaped, ordered, and NOT quietly stale.

import { afterAll, describe, expect, test } from "vitest";
import { allRows, end, dbReachable } from "../lib/pg";

const haveDb = await dbReachable();
const populated =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        `SELECT count(*)::text AS n FROM myarea_alerts`,
      ).catch(() => [{ n: "0" }])
    )[0].n,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !populated
    ? "myarea_alerts is absent or empty — run scripts/myarea/build_alerts.ts"
    : false;

afterAll(async () => {
  if (haveDb) await end();
});

describe("myarea_alerts", () => {
  test.skipIf(skip)("covers the municipalities that have a feed", async () => {
    const [r] = await allRows<{ rows: string; events: string }>(
      `SELECT count(*)::text AS rows, sum(event_count)::text AS events FROM myarea_alerts`,
    );
    expect(Number(r.rows)).toBeGreaterThan(250);
    expect(Number(r.events)).toBeGreaterThan(2000);
  });

  test.skipIf(skip)(
    "event_count and newest_event match the payload",
    async () => {
      const bad = await allRows<{ obshtina: string }>(
        `SELECT obshtina FROM myarea_alerts
        WHERE event_count <> jsonb_array_length(events)
           OR newest_event IS DISTINCT FROM (events -> 0 ->> 'date')::date`,
      );
      // Both columns are PROMOTED copies of what the payload says. A drift means a writer
      // updated one and not the other, and every staleness check downstream reads the copy.
      expect(bad, "a promoted column disagrees with its own payload").toEqual(
        [],
      );
    },
  );

  test.skipIf(skip)("every feed is newest-first and fully formed", async () => {
    const bad = await allRows<{ obshtina: string; problem: string }>(
      `SELECT obshtina,
              CASE
                WHEN jsonb_array_length(events) = 0 THEN 'empty feed stored'
                WHEN EXISTS (
                  SELECT 1 FROM jsonb_array_elements(events) e
                   WHERE e ->> 'date' IS NULL
                      OR e ->> 'kind' IS NULL
                      OR coalesce(e ->> 'headline_bg', '') = ''
                      OR coalesce(e ->> 'headline_en', '') = ''
                ) THEN 'an event is missing a date, kind or a headline'
                ELSE 'not newest-first'
              END AS problem
         FROM myarea_alerts
        WHERE jsonb_array_length(events) = 0
           OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(events) e
              WHERE e ->> 'date' IS NULL
                 OR e ->> 'kind' IS NULL
                 OR coalesce(e ->> 'headline_bg', '') = ''
                 OR coalesce(e ->> 'headline_en', '') = ''
           )
           -- WARNING: a < b, NOT a > b. The feed is NEWEST-FIRST, so a violation is a row
           -- whose date is EARLIER than the one after it. The first draft asked for
           -- bool_or(a > b) ... WHERE a < b, a predicate that can never be true, so this arm
           -- passed on every feed including a deliberately mis-ordered one. Mutation-checked
           -- both ways: the corrected form returns t on a mis-ordered array, f on a sorted
           -- one. (No backticks in this comment on purpose — it sits inside a template
           -- literal, and the first draft's backticks terminated the string.)
           OR EXISTS (
             SELECT 1 FROM (
               SELECT e ->> 'date' AS a,
                      lead(e ->> 'date') OVER (ORDER BY ord) AS b
                 FROM jsonb_array_elements(events) WITH ORDINALITY t(e, ord)
             ) x WHERE x.b IS NOT NULL AND x.a < x.b
           )
        LIMIT 5`,
    );
    // A missing headline is the one that matters: the tile renders the string, so an empty
    // one is a blank row under a date — worse than the event being absent.
    expect(bad, "a stored feed is malformed").toEqual([]);
  });

  // ⚠️ THE STALENESS THE FILE TREE COULD NOT EXPRESS. The retired builder only mkdirSync'd
  // its output directory — it never removed a file — so a município that stopped composing
  // events kept serving its last feed for ever. Measured on the migration run: AF.json was
  // from 2026-05-28 and carried ONE event from 2026-02-27, still being served.
  //
  // The upsert has the same shape (it never deletes), so this asserts the property directly:
  // every stored feed must have been REWRITTEN by the most recent build, not merely left
  // behind by an old one. A município that composes nothing simply has no row.
  test.skipIf(skip)("no feed is left over from an older build", async () => {
    const [r] = await allRows<{
      newest: string;
      oldest: string;
      stale: string;
    }>(
      `SELECT max(refreshed_at)::text AS newest,
              min(refreshed_at)::text AS oldest,
              count(*) FILTER (
                WHERE refreshed_at < (SELECT max(refreshed_at) FROM myarea_alerts)
                                      - interval '1 hour')::text AS stale
         FROM myarea_alerts`,
    );
    expect(
      Number(r.stale),
      `${r.stale} feed(s) were not rewritten by the latest build (oldest ${r.oldest}, ` +
        `newest ${r.newest}). The builder never deletes, so a município that stopped ` +
        `composing events keeps serving its last feed — which is exactly what the retired ` +
        `file tree did. Re-run scripts/myarea/build_alerts.ts, and if a row stays behind, ` +
        `delete it rather than letting it serve.`,
    ).toBe(0);
  });
});
