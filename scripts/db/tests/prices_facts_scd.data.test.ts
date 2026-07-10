// The migration's most correctness-critical logic: the SCD-2 price_facts
// transitions in load_day.ts (close-on-change, open-where-none-in-force, and the
// re-publish/correction undo). canon.ts and the daily aggregates are covered
// elsewhere, but a future refactor of these transitions could silently invert an
// interval (valid_from > valid_to) or drop a corrected price and nothing would
// fail. This pins the behavior on a tiny synthetic 3-day sequence.
//
// It drives the REAL applyPriceFactsDelta() extracted from load_day (not a
// copy), against synthetic store_id/sku_id values far outside the real range,
// inside a transaction that is ALWAYS rolled back — so it never touches the
// backfilled data. Requires DB_VERIFY=1 and a running local Postgres.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { withClient, end } from "../lib/pg";
import { applyPriceFactsDelta } from "../../prices/load_day";

after(async () => {
  await end();
});

const RUN = process.env.DB_VERIFY === "1";

// Synthetic keys well outside anything the ingest produces (bigserial, positive).
const STORE = -9001;
const SKU = -9001;
const D1 = "2020-01-01";
const D2 = "2020-01-02";
const D3 = "2020-01-03";

interface Run {
  valid_from: string;
  valid_to: string | null;
  price_eur: number;
}

test(
  "SCD-2 fact transitions: change, re-publish correction, delist",
  {
    skip: !RUN,
  },
  async () => {
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        // Synthetic parent rows to satisfy the FKs (chain → store → sku). All
        // rolled back at the end, so the real dimension tables are untouched.
        await c.query(
          `INSERT INTO price_chains (eik, name, first_seen, last_seen)
         VALUES ('__scdtest__', '__scdtest__', $1::date, $1::date)
         ON CONFLICT (eik) DO NOTHING`,
          [D1],
        );
        await c.query(
          `INSERT INTO price_stores
           (store_id, eik, ekatte, settlement, obshtina, oblast, label, label_norm, first_seen, last_seen)
         VALUES ($1, '__scdtest__', '00000', 't', 't', 't', 't', 't', $2::date, $2::date)`,
          [STORE, D1],
        );
        await c.query(
          `INSERT INTO price_skus
           (sku_id, eik, chain_code, raw_name, name_norm, pid, first_seen, last_seen)
         VALUES ($1, '__scdtest__', 't', 't', 't', 1, $2::date, $2::date)`,
          [SKU, D1],
        );

        // Stage one synthetic observation, then apply the delta for `day`.
        const load = async (
          day: string,
          obs: { price: number; promo?: number | null } | null,
        ) => {
          await c.query("DROP TABLE IF EXISTS obs_t");
          await c.query(
            `CREATE TEMP TABLE obs_t (store_id bigint, sku_id bigint,
             price_eur double precision, promo_eur double precision)`,
          );
          if (obs)
            await c.query("INSERT INTO obs_t VALUES ($1,$2,$3,$4)", [
              STORE,
              SKU,
              obs.price,
              obs.promo ?? null,
            ]);
          return applyPriceFactsDelta(c, day, "obs_t");
        };

        const runs = async (): Promise<Run[]> =>
          (
            await c.query(
              `SELECT valid_from::text, valid_to::text, price_eur
               FROM price_facts WHERE store_id = $1 AND sku_id = $2
              ORDER BY valid_from`,
              [STORE, SKU],
            )
          ).rows;

        const noInverted = async (): Promise<number> =>
          Number(
            (
              await c.query(
                `SELECT count(*) n FROM price_facts
                WHERE store_id = $1 AND sku_id = $2
                  AND valid_to IS NOT NULL AND valid_to < valid_from`,
                [STORE, SKU],
              )
            ).rows[0].n,
          );

        // ── day 1: price 1.00 → one open run [D1, NULL] ───────────────────
        await load(D1, { price: 1.0 });
        let r = await runs();
        assert.equal(r.length, 1);
        assert.deepEqual(
          [r[0].valid_from, r[0].valid_to, Number(r[0].price_eur)],
          [D1, null, 1.0],
        );

        // ── day 2: price 1.20 → run1 closes [D1, D1], run2 opens [D2, NULL] ─
        await load(D2, { price: 1.2 });
        r = await runs();
        assert.equal(r.length, 2);
        assert.equal(r[0].valid_to, D1, "run1 closes the day before D2");
        assert.equal(r[1].valid_to, null, "run2 is the open run");
        assert.equal(Number(r[1].price_eur), 1.2);
        assert.equal(await noInverted(), 0);

        // ── same day 2, same price → idempotent (no new run, still open) ───
        await load(D2, { price: 1.2 });
        r = await runs();
        assert.equal(r.length, 2, "identical re-load is a no-op");
        assert.equal(r[1].valid_to, null);
        assert.equal(Number(r[1].price_eur), 1.2);
        assert.equal(await noInverted(), 0);

        // ── re-publish D2 with a CORRECTED price 1.15 → the undo must fix it ─
        // run2 (1.20) is deleted, run1 reopened then reclosed, a new [D2,NULL]=1.15
        await load(D2, { price: 1.15 });
        r = await runs();
        assert.equal(r.length, 2, "still exactly two runs after correction");
        const open = r.filter((x) => x.valid_to === null);
        assert.equal(open.length, 1, "exactly ONE open run after correction");
        assert.equal(Number(open[0].price_eur), 1.15, "corrected price wins");
        assert.equal(open[0].valid_from, D2);
        assert.equal(r[0].valid_to, D1, "run1 still closed at D1");
        assert.equal(await noInverted(), 0, "no inverted interval after undo");

        // ── day 3: SKU delisted (not in obs) → run stays OPEN (absence is not
        //    a price change; the step function cannot see a gap) ─────────────
        await load(D3, null);
        r = await runs();
        assert.equal(r.length, 2, "delist opens/closes nothing");
        assert.equal(
          r.filter((x) => x.valid_to === null).length,
          1,
          "the run stays open on delist — a gap is not a close",
        );
        assert.equal(Number(open[0].price_eur), 1.15);
        assert.equal(await noInverted(), 0);
      } finally {
        // Never persist synthetic rows into the backfilled tables.
        await c.query("ROLLBACK");
      }
    });
  },
);
