// Correctness gate for the new-filing feed (098).
//
// The feed names people, so the controls are attribution, the privacy gate, and the one
// thing most likely to mislead: firstSeen is when a filing entered OUR data, never when it
// was filed. Expectations are computed independently from ingest_first_seen + declaration,
// not by re-running the serving function's own predicates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end, withClient } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM ingest_first_seen WHERE source = 'cacbg_declarations'",
    );
    return Number(t.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / no declaration ingest markers";

afterAll(async () => {
  await end();
});

// ATTRIBUTION + §6: every row names an active, public person. An unattributed filing is not
// news about anyone and must never surface.
test.skipIf(skip)("every feed row names an active, public person", async () => {
  const rows = await allRows<{ slug: string; ok: boolean }>(`
    SELECT e ->> 'slug' AS slug,
           EXISTS (SELECT 1 FROM person p
                    WHERE p.slug = e ->> 'slug'
                      AND p.status = 'active' AND p.is_public_figure) AS ok
      FROM jsonb_array_elements(declaration_new_filings(200)) e
  `);
  assert.ok(rows.length > 0, "the feed is empty — fixture problem");
  assert.deepEqual(
    rows.filter((r) => !r.ok).map((r) => r.slug),
    [],
    "the feed named someone who is not an active public person",
  );

  // The assertion above is satisfied by [] === [] whenever no gated-out person happens to
  // have a recent filing — which is the case today, so deleting the gate from the SQL would
  // leave it green. Construct the condition instead: flip a person who IS in the feed to
  // non-public inside a transaction, and require them to disappear.
  // One CLIENT, statement by statement: a multi-statement string returns the first result
  // set only, so the assertion would read BEGIN's empty result and pass vacuously.
  const still = await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(
        `UPDATE person SET is_public_figure = false
          WHERE slug = (SELECT e ->> 'slug'
                          FROM jsonb_array_elements(declaration_new_filings(1)) e)`,
      );
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM jsonb_array_elements(declaration_new_filings(200)) e
           JOIN person p ON p.slug = e ->> 'slug'
          WHERE NOT p.is_public_figure`,
      );
      return Number(r.rows[0].n);
    } finally {
      await c.query("ROLLBACK");
    }
  });
  assert.equal(
    still,
    0,
    "a person flipped to non-public still appeared — the §6 gate is not enforced",
  );
});

// THE ORDER IS THE PRODUCT: "new" means newest-first by first_seen_at.
//
// The rendered `firstSeen` is a DAY, and every marker in a backfill shares one day — so
// comparing the returned dates against their own sort is satisfied by ANY permutation,
// INCLUDING the alphabetical-by-name order the function once actually emitted. (An earlier
// version of this test did exactly that and passed while the feed was A→Z under a "newest
// first" heading.) The order must be checked against the underlying TIMESTAMP, which the
// payload deliberately does not carry — so re-join it here by source_url.
test.skipIf(skip)(
  "the feed is the newest rows by first_seen, in order",
  async () => {
    const feed = await allRows<{
      url: string;
      seen: string;
      ts: string;
      nm: string;
    }>(`
      WITH f AS (
        SELECT e.val ->> 'sourceUrl' AS url, e.val ->> 'firstSeen' AS seen,
               e.val ->> 'name' AS nm, e.pos
          FROM jsonb_array_elements(declaration_new_filings(25))
               WITH ORDINALITY AS e(val, pos)
      )
      SELECT f.url, f.seen, f.nm, i.first_seen_at::text AS ts
        FROM f JOIN ingest_first_seen i ON i.key = f.url AND i.source = 'cacbg_declarations'
       ORDER BY f.pos
    `);
    assert.ok(feed.length > 1, "feed too short to have an order");
    // Non-increasing on the real timestamp. A general guard — but note this whole corpus was
    // ingested in one backfill (two timestamps, same day), so within any 25-row page every
    // row shares a timestamp and this cannot, on its own, catch a reversed sort. The
    // constructed check below is what actually pins the direction.
    for (let i = 1; i < feed.length; i++) {
      assert.ok(
        feed[i - 1].ts >= feed[i].ts,
        `row ${i} is newer than the row above it (${feed[i].ts} > ${feed[i - 1].ts})`,
      );
    }

    // CONSTRUCT the order. Because the real corpus shares one ingest day, stamp two real
    // eligible markers with two distinct FAR-FUTURE timestamps inside a rolled-back
    // transaction, then require the feed to place the newer one first. Under the correct
    // `ORDER BY seen_at DESC` both land at the top, newest-first; reverse the sort to ASC and
    // these future rows fall past the LIMIT and never appear — so the assertion catches it.
    const order = await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const [a, b] = (
          await c.query<{ key: string }>(
            `SELECT f.key FROM ingest_first_seen f
               JOIN declaration d ON d.source_url = f.key
               JOIN person p ON p.person_id = d.person_id
              WHERE f.source = 'cacbg_declarations'
                AND p.status = 'active' AND p.is_public_figure
              LIMIT 2`,
          )
        ).rows;
        await c.query(
          `UPDATE ingest_first_seen SET first_seen_at = '2099-01-01T00:00:00Z'
            WHERE source = 'cacbg_declarations' AND key = $1`,
          [a.key],
        );
        await c.query(
          `UPDATE ingest_first_seen SET first_seen_at = '2098-01-01T00:00:00Z'
            WHERE source = 'cacbg_declarations' AND key = $1`,
          [b.key],
        );
        const urls = (
          await c.query<{ url: string }>(
            `SELECT e ->> 'sourceUrl' AS url
               FROM jsonb_array_elements(declaration_new_filings(50)) e`,
          )
        ).rows.map((r) => r.url);
        return {
          a: a.key,
          b: b.key,
          iA: urls.indexOf(a.key),
          iB: urls.indexOf(b.key),
        };
      } finally {
        await c.query("ROLLBACK");
      }
    });
    assert.ok(
      order.iA >= 0,
      "the newest (2099) marker did not appear in the feed at all",
    );
    assert.ok(
      order.iB >= 0,
      "the older (2098) marker did not appear in the feed at all",
    );
    assert.ok(
      order.iA < order.iB,
      `the 2099 marker (pos ${order.iA}) did not precede the 2098 marker (pos ${order.iB}) — the feed is not newest-first`,
    );
  },
);

// TIMEZONE-INVARIANCE (B4): firstSeen is pinned to Europe/Sofia in 098, because
// to_char() on a timestamptz otherwise renders in the session TimeZone and the same ingest
// batch would read a different day on a differently-configured connection. The rendered day
// must be identical regardless of the session zone.
test.skipIf(skip)("firstSeen is stable across session timezones", async () => {
  // One PINNED connection per zone: SET TIME ZONE affects only its own session, and a
  // pooled allRows() could hand the SELECT a different connection than the SET.
  const dayIn = (zone: string): Promise<string> =>
    withClient(async (c) => {
      await c.query(`SET TIME ZONE '${zone}'`);
      try {
        const r = await c.query<{ d: string | null }>(
          "SELECT (declaration_new_filings(1) -> 0 ->> 'firstSeen') AS d",
        );
        return r.rows[0]?.d ?? "";
      } finally {
        // withClient recycles a connection on success WITHOUT resetting session state, so
        // without this the mutated zone would leak to whatever test reuses this connection.
        await c.query("RESET TIME ZONE");
      }
    });
  // Kiritimati is UTC+14, Niue UTC-11 — 25 hours apart, so any un-pinned rendering of a
  // timestamptz near midnight UTC would land on a different calendar day.
  const east = await dayIn("Pacific/Kiritimati");
  const west = await dayIn("Pacific/Niue");
  assert.equal(
    east,
    west,
    `firstSeen renders a different day under different session zones (${east} vs ${west}) — the AT TIME ZONE pin is missing`,
  );
});

// firstSeen must be the INGEST date, not the filing date. The corpus proves they differ —
// a backfill stamps decade-old filings with today's date — and conflating them would tell
// readers an official just declared something they declared years ago.
test.skipIf(skip)(
  "firstSeen is the ingest date, distinct from filedAt",
  async () => {
    const [{ differ, total }] = await allRows<{
      differ: string;
      total: string;
    }>(`
    SELECT count(*) FILTER (WHERE (e ->> 'firstSeen') <> COALESCE(e ->> 'filedAt', ''))::text AS differ,
           count(*)::text AS total
      FROM jsonb_array_elements(declaration_new_filings(200)) e
  `);
    assert.ok(Number(total) > 0, "empty feed");
    assert.ok(
      Number(differ) > 0,
      "firstSeen never differs from filedAt — the feed is probably reporting the filing date",
    );
  },
);

// The watchlist is applied in the BROWSER. There must be no server-side function that
// takes a follow list, because calling one means transmitting the list — the privacy
// regression this migration exists to correct. This fails if anyone reintroduces it.
test.skipIf(skip)("no serving function accepts a follow list", async () => {
  const rows = await allRows<{ name: string }>(`
    SELECT p.proname AS name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND pg_get_function_identity_arguments(p.oid) LIKE '%text[]%'
       AND p.proname LIKE '%filing%'
  `);
  assert.deepEqual(
    rows.map((r) => r.name),
    [],
    "a filings function takes a slug array — the follow list would travel to the server",
  );
});
