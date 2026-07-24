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

// THE ORDER IS THE PRODUCT: "new" means newest-first by first_seen_at, and the cut must be
// stable. Verified against ingest_first_seen directly.
test.skipIf(skip)(
  "the feed is the newest rows by first_seen, in order",
  async () => {
    const feed = await allRows<{ url: string; seen: string }>(`
    SELECT e ->> 'sourceUrl' AS url, e ->> 'firstSeen' AS seen
      FROM jsonb_array_elements(declaration_new_filings(25)) e
  `);
    const sorted = [...feed].sort((a, b) =>
      a.seen < b.seen ? 1 : a.seen > b.seen ? -1 : 0,
    );
    assert.deepEqual(
      feed.map((f) => f.seen),
      sorted.map((f) => f.seen),
      "the feed is not ordered newest-first",
    );
    // Independently: no eligible filing is newer than the oldest row we returned.
    const [{ newer }] = await allRows<{ newer: string }>(
      `SELECT count(*)::text AS newer
       FROM ingest_first_seen f
       JOIN declaration d ON d.source_url = f.key
       JOIN person p ON p.person_id = d.person_id
      WHERE f.source = 'cacbg_declarations'
        AND p.status = 'active' AND p.is_public_figure
        AND to_char(f.first_seen_at, 'YYYY-MM-DD') > $1`,
      [feed[feed.length - 1].seen],
    );
    assert.ok(
      Number(newer) <= feed.length,
      `${newer} eligible filings are newer than the feed's oldest row`,
    );
  },
);

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
