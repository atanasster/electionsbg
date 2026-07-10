// Materialize the per-product daily minimum for the products we serve pages for.
//
// WHY THIS EXISTS
// The /product/:slug history chart needs `min price per day since euro day`.
// Deriving it live means expanding each SKU's step-function runs across the day
// series. For the worst product — БАНАНИ, 90 chains, 133 SKUs — that is ~190k
// row-days and ~370ms, over the 200ms budget. Materializing every one of the
// 118k products would cost roughly 380M row-days, which is absurd.
//
// So it is bounded to the prerendered head (same ORDER BY as export_slugs.ts).
// The long tail falls back to the live query in the price-history route, which
// is fast there precisely because those products have one or two SKUs.
//
// TWO MASKS, both load-bearing (design §3.2):
//   1. A run only counts on days its SKU was actually listed
//      (`day BETWEEN k.first_seen AND k.last_seen`). Without this, a delisted
//      SKU's open run drags its last price forward forever.
//   2. A day only counts when that chain actually reported (price_chain_days).
//      A reporting gap is a gap, never a flat line.

import type { PoolClient } from "pg";
import { withClient, allRows } from "../db/lib/pg";
import { PRERENDER_HEAD } from "./limits";

export const buildProductDays = async (
  limit = PRERENDER_HEAD,
): Promise<void> => {
  const [{ today }] = await allRows<{ today: string | null }>(
    "SELECT max(day)::text AS today FROM price_grid_days",
  );
  if (!today) {
    console.log("[product-days] no data — skipping");
    return;
  }

  await withClient(async (c: PoolClient) => {
    await c.query("BEGIN");
    try {
      await c.query("TRUNCATE price_product_days");
      await c.query(
        `WITH head AS (
           SELECT product_id FROM price_products
            WHERE last_seen = $1::date AND chain_count > 0
            ORDER BY chain_count DESC, sku_count DESC, slug COLLATE "C" ASC
            LIMIT $2
         ),
         span AS (SELECT min(day) AS d0, max(day) AS d1 FROM price_grid_days)
         INSERT INTO price_product_days (product_id, day, min_eur, chains)
         SELECT k.product_id, d.day::date,
                MIN(f.price_eur), COUNT(DISTINCT k.eik)
           FROM span
           CROSS JOIN generate_series(span.d0, span.d1, interval '1 day') AS d(day)
           JOIN price_skus  k ON k.product_id IN (SELECT product_id FROM head)
                             AND d.day::date BETWEEN k.first_seen AND k.last_seen
           JOIN price_facts f ON f.sku_id = k.sku_id
                             AND f.valid_from <= d.day::date
                             AND (f.valid_to IS NULL OR f.valid_to >= d.day::date)
           -- st.eik is always k.eik (a SKU belongs to exactly one chain; verified
           -- zero cross-chain facts), so the price_stores join is pure overhead.
           JOIN price_chain_days cd ON cd.day = d.day::date AND cd.eik = k.eik
          GROUP BY k.product_id, d.day`,
        [today, limit],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });

  const [{ n, p }] = await allRows<{ n: string; p: string }>(
    "SELECT count(*) AS n, count(DISTINCT product_id) AS p FROM price_product_days",
  );
  console.log(
    `[product-days] ${Number(n).toLocaleString()} rows for ${Number(p).toLocaleString()} products`,
  );
};

if (process.argv[1] && /build_product_days\.ts$/.test(process.argv[1])) {
  const { end } = await import("../db/lib/pg");
  buildProductDays()
    .then(() => end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
