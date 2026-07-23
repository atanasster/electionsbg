// Regression gate: price_products.chain_count is a LIVE-facing column.
//
// The bug it locks out: chain_count used to be the count of chains whose SKU was
// EVER matched to the product (from price_skus, no recency filter), while the
// /product ladder is built from price_current (latest day only). A chain that
// carried the product historically but did not report today was counted in
// chain_count yet absent from the ladder — so search printed "13 вериги" above a
// 4-row ladder, and ProductScreen's own footnote ("Сравнено в {chain_count}
// вериги") disagreed with the list it sat under.
//
// rebuild_catalog now recomputes chain_count from price_current with the SAME
// unit-outlier guard as the ladder (functions/db_routes.js "price-product"). This
// asserts the two can never drift again: for every product, chain_count equals
// the number of distinct chains in its live, guard-filtered ladder.
//
// Requires DB_VERIFY=1 and a loaded local Postgres (price_current + catalogue).

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

afterAll(async () => {
  await end();
});

const RUN = process.env.DB_VERIFY === "1";

test.skipIf(!RUN)(
  "chain_count equals the live ladder size for every product",
  async () => {
    // `live` mirrors the "price-product" route's ladder exactly: price_current
    // joined per product, then GROUP BY eik after the >= 0.5 * median guard.
    const bad = await allRows<{
      slug: string;
      chain_count: number;
      live: number;
    }>(`
      WITH cur AS (
        SELECT k.product_id, k.eik, pc.price_eur, p.unit_priced
          FROM price_current pc
          JOIN price_skus     k ON k.sku_id = pc.sku_id
          JOIN price_products p ON p.product_id = k.product_id
         WHERE k.product_id IS NOT NULL
      ),
      med AS (
        SELECT product_id,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY price_eur) AS m
          FROM cur GROUP BY product_id
      ),
      live AS (
        SELECT cur.product_id, count(DISTINCT cur.eik) AS cc
          FROM cur JOIN med USING (product_id)
         WHERE NOT cur.unit_priced OR cur.price_eur >= 0.5 * med.m
         GROUP BY cur.product_id
      )
      SELECT pp.slug,
             pp.chain_count::int         AS chain_count,
             COALESCE(live.cc, 0)::int   AS live
        FROM price_products pp
        LEFT JOIN live ON live.product_id = pp.product_id
       WHERE pp.chain_count <> COALESCE(live.cc, 0)
       ORDER BY abs(pp.chain_count - COALESCE(live.cc, 0)) DESC
       LIMIT 10`);

    assert.deepEqual(
      bad,
      [],
      `chain_count diverged from the live ladder:\n` +
        bad
          .map(
            (r) => `  ${r.slug}: chain_count=${r.chain_count} ladder=${r.live}`,
          )
          .join("\n"),
    );
  },
);
