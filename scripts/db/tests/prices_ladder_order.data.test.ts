// The /product/:slug cross-chain ladder must rank by the price a shopper
// ACTUALLY pays — the promo when one is running — and each row must describe a
// real shelf.
//
// Both halves regressed together once: the route ranked by `price_eur` while the
// UI rendered `promo_eur ?? price_eur`, so promo chains landed in the wrong slot
// and the green "най-евтино" badge sat on whichever chain had the lowest REGULAR
// price. The row was internally inconsistent too — MIN(price_eur) and
// MIN(promo_eur) were aggregated independently, pairing one store's promo with
// another store's regular, which made the €/kg line describe no actual store.
//
// Requires DB_VERIFY=1 and a loaded local Postgres (price_current + catalogue).

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { allRows, end } from "../lib/pg";

const require = createRequire(import.meta.url);
const { DB_ROUTES } = require("../../../functions/db_routes.js") as {
  DB_ROUTES: Record<
    string,
    (
      dbRows: (sql: string, params: unknown[]) => Promise<unknown[]>,
      q: Record<string, string>,
    ) => Promise<{ status?: number; body: unknown }>
  >;
};

interface LadderRow {
  eik: string;
  chain: string;
  price_eur: number;
  promo_eur: number | null;
}

const paid = (r: LadderRow): number => r.promo_eur ?? r.price_eur;

afterAll(async () => {
  await end();
});

const RUN = process.env.DB_VERIFY === "1";

test.skipIf(!RUN)(
  "the chain ladder ranks by effective price, from one real store per chain",
  async () => {
    // Promo-carrying, multi-chain products — the only shape that can expose the
    // bug. A ladder where no chain runs a promo is ordered identically either way.
    const slugs = await allRows<{ slug: string }>(`
      SELECT p.slug
        FROM price_products p
        JOIN price_skus    k  ON k.product_id = p.product_id
        JOIN price_current pc ON pc.sku_id = k.sku_id
       WHERE pc.promo_eur IS NOT NULL
       GROUP BY p.slug
      HAVING count(DISTINCT k.eik) >= 3
       ORDER BY p.slug
       LIMIT 40`);

    assert.ok(slugs.length > 0, "no promo-carrying multi-chain product in PG");

    const problems: string[] = [];
    for (const { slug } of slugs) {
      const { body } = await DB_ROUTES["price-product"](allRows, { slug });
      const chains = (body as { chains: LadderRow[] } | null)?.chains ?? [];

      for (let i = 1; i < chains.length; i++)
        if (paid(chains[i]) < paid(chains[i - 1]) - 1e-9)
          problems.push(
            `${slug}: ${chains[i].chain} ${paid(chains[i])} € ranked below ` +
              `${chains[i - 1].chain} ${paid(chains[i - 1])} €`,
          );

      // Every (regular, promo) pair the route emits must be co-listed on ONE
      // store, else the row is a splice of two shelves.
      for (const c of chains) {
        const [hit] = await allRows<{ n: number }>(
          `SELECT count(*)::int AS n
             FROM price_products p
             JOIN price_skus    k  ON k.product_id = p.product_id
             JOIN price_current pc ON pc.sku_id = k.sku_id
            WHERE p.slug = $1 AND k.eik = $2
              AND pc.price_eur = $3
              AND pc.promo_eur IS NOT DISTINCT FROM $4`,
          [slug, c.eik, c.price_eur, c.promo_eur],
        );
        if (!hit || hit.n === 0)
          problems.push(
            `${slug}: ${c.chain} pairs regular ${c.price_eur} € with promo ` +
              `${c.promo_eur} € — no single store lists both`,
          );
      }
    }

    assert.deepEqual(problems, [], problems.join("\n"));
  },
  60_000,
);
