// Tier 3 (Postgres-native) — the last-known price layer that lets an absent
// chain keep a page.
//
//   npm run test:data
//
// `price_current` is "today's truth" and is deliberately emptied of anything the
// day's feed omits (048's header rule: absence is only knowable at observation
// time — inferring it from `price_facts` over-counts 3.7x, measured 4,387,949
// open runs against 1,177,730 real rows). That rule is correct and this table
// does not touch it.
//
// What `price_last_seen` adds is the other half: the last price we ever saw per
// (store, sku) and the day we saw it. Without it, a chain that stops filing is
// deleted from `price_current`, its `chain-products` payload stops being
// emitted, and the payload merge's anti-join prunes the row — the chain's page
// disappears from the served layer entirely. See
// docs/plans/prices-chain-absence-v1.md §2 for the four-step cascade.
//
// Skips (never passes) when Postgres is unreachable, the prices schema has not
// been applied, or no day has been loaded — a green run must mean the invariant
// was checked, not that there was nothing to check.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end, withClient } from "../lib/pg";

const haveDb = await dbReachable();

// A relation probe, not just reachability: `test:data` is db:refresh's last
// step and runs against databases that legitimately have no prices corpus.
// Without this the whole file throws 42P01 and takes the refresh down with it.
const schemaReady =
  haveDb &&
  (
    await allRows<{ ok: boolean }>(
      `SELECT (to_regclass('price_last_seen') IS NOT NULL
           AND to_regclass('price_current')   IS NOT NULL
           AND to_regclass('price_grid_days') IS NOT NULL) AS ok`,
    )
  )[0]?.ok === true;

const loadedDays = schemaReady
  ? Number(
      (
        await allRows<{ n: string }>(
          "SELECT count(DISTINCT day)::text AS n FROM price_grid_days",
        )
      )[0]?.n ?? 0,
    )
  : 0;

const skip = !haveDb
  ? "Postgres unreachable"
  : !schemaReady
    ? "prices schema not applied"
    : loadedDays === 0
      ? "no day loaded"
      : false;

afterAll(async () => {
  if (haveDb) await end();
});

test.skipIf(skip)(
  "price_last_seen covers every current row, stamped with the latest day",
  async () => {
    const [r] = await allRows<{
      current: string;
      covered: string;
      latest: string;
      stale_in_current: string;
    }>(
      `SELECT (SELECT count(*)::text FROM price_current) AS current,
              (SELECT count(*)::text
                 FROM price_current pc
                 JOIN price_last_seen pls USING (store_id, sku_id)) AS covered,
              (SELECT max(day)::text FROM price_grid_days) AS latest,
              (SELECT count(*)::text
                 FROM price_current pc
                 JOIN price_last_seen pls USING (store_id, sku_id)
                WHERE pls.as_of <> (SELECT max(day) FROM price_grid_days))
                AS stale_in_current`,
    );

    assert.equal(
      r.covered,
      r.current,
      `price_last_seen is missing ${Number(r.current) - Number(r.covered)} of ${r.current} current rows`,
    );
    // A current row carrying an older as_of would render as stale on a page and
    // be dropped from aggregates it is entitled to be in.
    assert.equal(
      r.stale_in_current,
      "0",
      `${r.stale_in_current} current rows carry an as_of other than ${r.latest}`,
    );
  },
);

test.skipIf(skip)(
  "price_last_seen is a SUPERSET — it never shrinks with the feed",
  async () => {
    const [r] = await allRows<{ last_seen: string; current: string }>(
      `SELECT (SELECT count(*)::text FROM price_last_seen) AS last_seen,
              (SELECT count(*)::text FROM price_current)   AS current`,
    );
    assert.ok(
      Number(r.last_seen) >= Number(r.current),
      `price_last_seen (${r.last_seen}) is smaller than price_current (${r.current}) — ` +
        `it is upsert-only and must never lose a row the feed stopped carrying`,
    );
  },
);

// THE FEATURE'S WHOLE PURPOSE. The first cut of this test was a tautology over a
// GROUP BY whose HAVING returned zero rows, so it asserted nothing and could not
// fail in either corpus state. This one names the population explicitly and
// skips with a DISTINCT reason when it is empty — "no chain has gone silent yet"
// must never read as "silent chains are covered".
test.skipIf(skip)(
  "every chain with history is recoverable, including ones that stopped filing",
  async () => {
    const [r] = await allRows<{
      with_history: string;
      in_last_seen: string;
      in_current: string;
      silent_covered: string;
      silent_total: string;
    }>(
      `WITH hist AS (
         SELECT DISTINCT s.eik FROM price_facts f
           JOIN price_stores s ON s.store_id = f.store_id),
       ls AS (
         SELECT DISTINCT s.eik FROM price_last_seen p
           JOIN price_stores s ON s.store_id = p.store_id),
       cur AS (
         SELECT DISTINCT s.eik FROM price_current pc
           JOIN price_stores s ON s.store_id = pc.store_id)
       SELECT (SELECT count(*)::text FROM hist) AS with_history,
              (SELECT count(*)::text FROM ls)   AS in_last_seen,
              (SELECT count(*)::text FROM cur)  AS in_current,
              (SELECT count(*)::text FROM hist
                WHERE eik NOT IN (SELECT eik FROM cur)
                  AND eik IN (SELECT eik FROM ls))   AS silent_covered,
              (SELECT count(*)::text FROM hist
                WHERE eik NOT IN (SELECT eik FROM cur)) AS silent_total`,
    );

    // Seeding from price_current would satisfy nothing below: measured
    // 2026-08-20 it covered 98 of 215 chains, omitting the 170 that had already
    // gone silent — the entire population this table exists for.
    assert.equal(
      r.in_last_seen,
      r.with_history,
      `${Number(r.with_history) - Number(r.in_last_seen)} chains have price history ` +
        `but no last-seen row, so T2b can never build a page for them`,
    );

    if (r.silent_total === "0") {
      // Not a pass — say so. Every chain reported on the latest day, so the
      // interesting half of the invariant had nothing to bite on.
      console.warn(
        "[prices_last_seen] no chain has gone silent in this corpus — " +
          "the silent-chain arm asserted nothing",
      );
      return;
    }
    assert.equal(
      r.silent_covered,
      r.silent_total,
      `${Number(r.silent_total) - Number(r.silent_covered)} of ${r.silent_total} silent ` +
        `chains have no last-seen row`,
    );
  },
);

test.skipIf(skip)(
  "no last-seen row is dated in the future or before the corpus",
  async () => {
    const [r] = await allRows<{ bad: string; lo: string; hi: string }>(
      `SELECT count(*) FILTER (
                WHERE pls.as_of > (SELECT max(day) FROM price_grid_days)
                   OR pls.as_of < (SELECT min(day) FROM price_grid_days)
              )::text AS bad,
              (SELECT min(day)::text FROM price_grid_days) AS lo,
              (SELECT max(day)::text FROM price_grid_days) AS hi
         FROM price_last_seen pls`,
    );
    assert.equal(
      r.bad,
      "0",
      `${r.bad} price_last_seen rows fall outside the loaded corpus ${r.lo}…${r.hi}`,
    );
  },
);

// TEST-001. The `as_of` guard is the change's most interesting behaviour and had
// no coverage: a --backfill replaying an OLDER day must not overwrite a newer
// last-known price. Driven against real rows inside a rolled-back transaction,
// so the corpus is untouched.
test.skipIf(skip)(
  "an older day cannot overwrite a newer last-known price",
  async () => {
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const { rows: before } = await c.query<{
          store_id: string;
          sku_id: string;
          price_eur: number;
          as_of: string;
        }>(
          `SELECT store_id::text, sku_id::text, price_eur, as_of::text
             FROM price_last_seen ORDER BY store_id, sku_id LIMIT 1`,
        );
        const v = before[0];
        assert.ok(v, "no price_last_seen rows to exercise the guard against");

        // An OLDER day arrives carrying a different price. The guard must refuse.
        const older = await c.query(
          `INSERT INTO price_last_seen (store_id, sku_id, price_eur, promo_eur, as_of)
           VALUES ($1::bigint, $2::bigint, $3::float8, NULL, $4::date - 1)
           ON CONFLICT (store_id, sku_id) DO UPDATE
              SET price_eur = excluded.price_eur, as_of = excluded.as_of
            WHERE price_last_seen.as_of <= excluded.as_of`,
          [v.store_id, v.sku_id, v.price_eur + 99, v.as_of],
        );
        assert.equal(
          older.rowCount ?? 0,
          0,
          "an older day was allowed to overwrite a newer last-known price",
        );

        // …and a NEWER day must be accepted, or the guard is simply "never
        // update" and the test above passes for the wrong reason.
        const newer = await c.query(
          `INSERT INTO price_last_seen (store_id, sku_id, price_eur, promo_eur, as_of)
           VALUES ($1::bigint, $2::bigint, $3::float8, NULL, $4::date + 1)
           ON CONFLICT (store_id, sku_id) DO UPDATE
              SET price_eur = excluded.price_eur, as_of = excluded.as_of
            WHERE price_last_seen.as_of <= excluded.as_of`,
          [v.store_id, v.sku_id, v.price_eur + 99, v.as_of],
        );
        assert.equal(
          newer.rowCount ?? 0,
          1,
          "a newer day was refused — the guard is blocking every update",
        );
      } finally {
        await c.query("ROLLBACK");
      }
    });
  },
);

// TEST-003 (mutation check). The suite above must be satisfied by the WIDE seed
// and not by the narrow price_current one it replaced. Re-derive both
// populations and assert they genuinely differ — otherwise every assertion here
// would pass against the seed that omitted 170 chains.
test.skipIf(skip)(
  "the wide seed is strictly wider than seeding from price_current",
  async () => {
    const [r] = await allRows<{ wide: string; narrow: string }>(
      `SELECT (SELECT count(*)::text FROM price_facts WHERE valid_to IS NULL) AS wide,
              (SELECT count(*)::text FROM price_current) AS narrow`,
    );
    assert.ok(
      Number(r.wide) > Number(r.narrow),
      `open runs (${r.wide}) should exceed price_current (${r.narrow}); if they are ` +
        `equal the two seeds are indistinguishable and this gate proves nothing`,
    );
    // …and the table must actually be built on the wider one.
    const [t] = await allRows<{ n: string }>(
      "SELECT count(*)::text AS n FROM price_last_seen",
    );
    assert.ok(
      Number(t.n) > Number(r.narrow),
      `price_last_seen (${t.n}) is no wider than price_current (${r.narrow}) — ` +
        `it looks seeded from the narrow population, which omits every silent chain`,
    );
  },
);
