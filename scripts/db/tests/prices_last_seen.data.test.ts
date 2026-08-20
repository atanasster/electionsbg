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

// T2b. The payload is the thing a reader actually gets, and the cascade this
// plan is about ends there: price_current drops a silent chain → the
// chain-products query returns nothing for it → `emit` never fires → the
// payload merge's anti-join DELETES the blob.
//
// ⚠️ The first cut of this test asserted `blobs >= chains that filed today`,
// which the PRE-FIX state satisfies exactly (98 >= 98) — it passed on the very
// defect it was written for. The assertion has to be against EVERY chain with
// history, because that is what "a chain is never deleted" means.
test.skipIf(skip)(
  "every chain with history keeps a chain-products blob, dated",
  async () => {
    const [r] = await allRows<{
      blobs: string;
      with_history: string;
      filed: string;
      missing: string;
      undated: string;
      overdated: string;
    }>(
      `SELECT (SELECT count(*)::text FROM price_payloads WHERE kind='chain-products') AS blobs,
              (SELECT count(DISTINCT s.eik)::text
                 FROM price_last_seen p JOIN price_stores s USING (store_id)) AS with_history,
              (SELECT count(DISTINCT ps.eik)::text
                 FROM price_skus ps JOIN price_current pc ON pc.sku_id = ps.sku_id) AS filed,
              (SELECT count(*)::text FROM price_chains c
                WHERE NOT EXISTS (SELECT 1 FROM price_payloads pp
                                   WHERE pp.kind='chain-products' AND pp.key = c.eik)) AS missing,
              (SELECT count(*)::text FROM price_payloads
                WHERE kind='chain-products' AND payload->>'asOf' IS NULL) AS undated,
              (SELECT count(*)::text FROM price_payloads pp,
                      LATERAL jsonb_array_elements(pp.payload->'products') e
                WHERE pp.kind='chain-products' AND pp.payload->>'asOf' IS NOT NULL
                  AND (e->>'asOf') > (pp.payload->>'asOf')) AS overdated`,
    );

    if (r.blobs === "0") {
      console.warn(
        "[prices_last_seen] no chain-products payloads built — run build_payloads",
      );
      return;
    }

    // THE gate. Pre-fix this read 98 blobs against 215 chains and would fail;
    // the earlier `blobs >= filed` form read 98 >= 98 and passed.
    assert.equal(
      r.missing,
      "0",
      `${r.missing} chains have no chain-products blob — a chain has been pruned ` +
        `out of the served layer (blobs ${r.blobs}, chains with history ${r.with_history}, ` +
        `chains that filed today ${r.filed})`,
    );

    // A retained price with no date is strictly worse than a deleted one,
    // because the reader cannot tell.
    assert.equal(
      r.undated,
      "0",
      `${r.undated} chain-products blobs carry no asOf, so a stale price would render as today's`,
    );

    // MIN(price) and max(as_of) are independent aggregates; pairing them wrongly
    // dates a price fresher than it is.
    assert.equal(
      r.overdated,
      "0",
      `${r.overdated} product rows are dated after their own chain's last filing day`,
    );

    if (r.with_history === r.filed)
      console.warn(
        "[prices_last_seen] every chain filed on the latest day — the silent-chain arm asserted nothing",
      );
  },
);

// TEST-003. The three staleness fields are computed by the builder and trusted
// verbatim by the page, so nothing else checks that they agree with each other
// or with the data they were derived from. A blob claiming `stale: false` while
// dated before the latest day would render a days-old price as today's.
test.skipIf(skip)(
  "the stored staleness fields agree with their own inputs",
  async () => {
    const [r] = await allRows<{
      total: string;
      wrong_stale: string;
      ceiling_with_products: string;
      ceiling_not_stale: string;
      asof_after_latest: string;
    }>(
      `WITH p AS (
       SELECT key,
              payload->>'asOf'                       AS as_of,
              payload->>'latestDate'                 AS latest,
              (payload->>'stale')::boolean           AS stale,
              (payload->>'beyondCeiling')::boolean   AS beyond,
              jsonb_array_length(payload->'products') AS n
         FROM price_payloads WHERE kind='chain-products'
     )
     SELECT count(*)::text AS total,
            -- stale must be exactly "dated before the corpus's latest day"
            count(*) FILTER (
              WHERE as_of IS NOT NULL AND latest IS NOT NULL
                AND stale <> (as_of < latest))::text AS wrong_stale,
            -- past the ceiling the page shows no prices, so the blob must carry none
            count(*) FILTER (WHERE beyond AND n > 0)::text AS ceiling_with_products,
            -- and anything past the ceiling is necessarily stale
            count(*) FILTER (WHERE beyond AND NOT stale)::text AS ceiling_not_stale,
            -- a blob can never be dated after the corpus it came from
            count(*) FILTER (
              WHERE as_of IS NOT NULL AND latest IS NOT NULL
                AND as_of > latest)::text AS asof_after_latest
       FROM p`,
    );

    if (r.total === "0") {
      console.warn(
        "[prices_last_seen] no chain-products payloads built — run build_payloads",
      );
      return;
    }
    assert.equal(
      r.wrong_stale,
      "0",
      `${r.wrong_stale} blobs whose stale flag disagrees with asOf < latestDate`,
    );
    assert.equal(
      r.ceiling_with_products,
      "0",
      `${r.ceiling_with_products} beyond-ceiling blobs still carry prices`,
    );
    assert.equal(
      r.ceiling_not_stale,
      "0",
      `${r.ceiling_not_stale} blobs are beyond the ceiling but not marked stale`,
    );
    assert.equal(
      r.asof_after_latest,
      "0",
      `${r.asof_after_latest} blobs are dated after the corpus's latest day`,
    );
  },
);

// Plan T5, gate 5 (the stored half). `toPrice`'s `> 0` is pinned by
// scripts/prices/lib/normalize.test.ts at the parse; this is the same
// guarantee asserted against what actually landed, across every table a price
// can reach. The two together are what make "a missing chain contributes no
// rows, not zero-valued rows" checkable rather than merely true today.
test.skipIf(skip)("no table holds a non-positive price", async () => {
  // Keyed by the REAL relation name, not a SQL alias — the failure message is
  // the whole value of this gate and "chain_grid" is not something anyone can
  // go and look at.
  //
  // `price_grid_days.promo_min_eur` is checked separately from `min_eur`: it is
  // an independent aggregate (1.7M populated values) and a positive `min_eur`
  // does not imply a positive promo.
  const CHECKS: ReadonlyArray<{ table: string; where: string }> = [
    {
      table: "price_current",
      where: "price_eur <= 0 OR (promo_eur IS NOT NULL AND promo_eur <= 0)",
    },
    {
      table: "price_facts",
      where: "price_eur <= 0 OR (promo_eur IS NOT NULL AND promo_eur <= 0)",
    },
    {
      table: "price_last_seen",
      where: "price_eur <= 0 OR (promo_eur IS NOT NULL AND promo_eur <= 0)",
    },
    { table: "price_grid_days", where: "min_eur <= 0" },
    {
      table: "price_grid_days",
      where: "promo_min_eur IS NOT NULL AND promo_min_eur <= 0",
    },
    { table: "price_chain_grid_days", where: "min_eur <= 0" },
  ];

  // Collect every offender before asserting, so one bad table does not hide the
  // others.
  const bad: string[] = [];
  for (const c of CHECKS) {
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${c.table} WHERE ${c.where}`,
    );
    if (r.n !== "0") bad.push(`${c.table} (${c.where}): ${r.n} row(s)`);
  }
  assert.deepEqual(
    bad,
    [],
    `non-positive prices are stored:\n  ${bad.join("\n  ")}\n` +
      `A zero drags every average toward it, which is the failure toPrice's ` +
      `\`> 0\` exists to prevent (pinned at the parse in ` +
      `scripts/prices/lib/normalize.test.ts).`,
  );
});

// Plan T4. The ranking payload's `coverage` block, which is the ONLY thing
// telling a reader that a cheapest-places board may be composition-driven —
// plan T3, which would have removed the exposure itself, was attempted and
// reverted.
//
// It needs a producer-side gate because the consumer is deliberately SILENT on
// absence: `PriceCoverageNote` renders nothing when `coverage` is missing,
// which is right (it must not warn about something it cannot substantiate) but
// means deleting the emit leaves every test green and the note simply never
// appears again. This is what makes that silence observable.
test.skipIf(skip)(
  "the ranking payload carries a coverage judgement",
  async () => {
    const [r] = await allRows<{
      has_cov: boolean;
      complete: boolean | null;
      chains: number | null;
      median: number | null;
      day: string | null;
      latest: string | null;
    }>(
      `SELECT (payload ? 'coverage')                        AS has_cov,
            (payload->'coverage'->>'chainsComplete')::boolean AS complete,
            (payload->'coverage'->>'chains')::int         AS chains,
            (payload->'coverage'->>'trailingMedian')::float8 AS median,
            (payload->'coverage'->>'latestDate')          AS day,
            (payload->>'latestDate')                      AS latest
       FROM price_payloads WHERE kind='ranking'`,
    );

    if (!r) {
      console.warn(
        "[prices_last_seen] no ranking payload — run build_payloads",
      );
      return;
    }
    assert.ok(
      r.has_cov,
      "the ranking payload has no `coverage` block, so every level surface is " +
        "silent about reporter-set drift and nothing else would notice",
    );
    assert.notEqual(r.complete, null, "coverage.chainsComplete is not set");
    assert.ok(
      r.chains != null && r.chains > 0,
      `coverage.chains is ${r.chains} — the note suppresses its detail without it`,
    );
    // ⚠️ The date inside `coverage` must be the day `places` was BUILT from, not
    // the headline day. Publishing `headlineDate` here would caption these rows
    // with a day they are not from; dict.json refuses it for the same reason.
    assert.equal(
      r.day,
      r.latest,
      `coverage.latestDate (${r.day}) must equal the payload's latestDate (${r.latest}) — ` +
        `anything else dates the board with a day its rows are not from`,
    );
  },
);

// The SERVER half of the stale-comparison rule (build_payloads, chain-products).
//
// `marketMin` is TODAY's cross-chain minimum. Beside a price observed on an
// earlier day it is not a comparison — the page strikes it through and adds a
// „най-евтина" badge when the row undercuts it, i.e. asserts that a days-old
// price is currently the cheapest on the market.
//
// ChainProfileScreen ALSO gates on `stale`, and that client gate has its own
// tests. This one exists because the two halves fail differently: the client
// gate protects the deployed bundle, while THIS one is what makes the payload
// safe to publish ahead of one. A payload rebuilt onto production before the
// bundle ships is exactly the state that turns the client-only gate into a live
// defect on every retained chain page — which is the deploy order actually taken
// on 2026-08-20 — and it is also the half a future consumer cannot forget,
// because a NULL cannot be rendered.
test.skipIf(skip)(
  "no chain-products row pairs an old price with today's market minimum",
  async () => {
    const rows = await allRows<{
      eik: string;
      as_of: string;
      latest: string;
      n: number;
    }>(
      `WITH latest AS (SELECT max(day) AS d FROM price_grid_days),
            p AS (
              SELECT key AS eik,
                     jsonb_array_elements(payload->'products') AS prod,
                     payload->>'latestDate' AS latest
                FROM price_payloads WHERE kind = 'chain-products'
            )
       SELECT eik, prod->>'asOf' AS as_of, latest, count(*)::int AS n
         FROM p, latest l
        WHERE prod->>'asOf' IS DISTINCT FROM l.d::text
          AND prod->'marketMin' <> 'null'::jsonb
        GROUP BY 1,2,3 ORDER BY n DESC LIMIT 10`,
    );

    assert.deepEqual(
      rows,
      [],
      rows.length
        ? `${rows.length} chain(s) publish today's marketMin beside an older price — ` +
            `e.g. eik ${rows[0].eik} dated ${rows[0].as_of} against ${rows[0].latest} ` +
            `(${rows[0].n} products). An older bundle renders that as a live claim.`
        : "",
    );
  },
);

// …and the mutation check for it. An assertion that "no row does X" passes
// vacuously on an empty corpus, on a payload with no retained chains, and on a
// build where the fallback arm silently stopped emitting — none of which is the
// property above. So require that retained rows EXIST and that they are the
// ones carrying a NULL: without the CASE, these same rows would carry a number.
test.skipIf(skip)(
  "…and that gate is not vacuous — retained rows exist and are the nulled ones",
  async () => {
    const [r] = await allRows<{ retained: number; nulled: number }>(
      `WITH latest AS (SELECT max(day) AS d FROM price_grid_days),
            p AS (
              SELECT jsonb_array_elements(payload->'products') AS prod
                FROM price_payloads WHERE kind = 'chain-products'
            )
       SELECT count(*) FILTER (WHERE prod->>'asOf' IS DISTINCT FROM l.d::text)::int
                AS retained,
              count(*) FILTER (WHERE prod->>'asOf' IS DISTINCT FROM l.d::text
                                 AND prod->'marketMin' = 'null'::jsonb)::int
                AS nulled
         FROM p, latest l`,
    );
    if (!r || r.retained === 0) {
      // Not a failure: on a day every chain filed there is nothing to retain.
      // Say so explicitly rather than letting the gate above read as enforced.
      console.warn(
        "[prices_last_seen] no retained chain-products rows — the stale-marketMin " +
          "gate above is vacuous on this corpus, not satisfied by it",
      );
      return;
    }
    assert.equal(
      r.nulled,
      r.retained,
      `${r.retained} retained rows but only ${r.nulled} carry a NULL marketMin`,
    );
  },
);
