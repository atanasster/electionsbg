// Emit the product slug list that prerender + sitemap read.
//
// This is the ONE derived artifact that stays on disk, and it exists only
// because scripts/prerender/ and scripts/sitemap/ have never opened a database
// connection. Giving the build a DB would make it non-hermetic — and the
// maintainer's LOCAL Postgres is stale anyway, since the ingest targets Cloud
// SQL. So the ingest, which holds the authoritative connection, writes a
// committed file instead. See design §7.2.
//
// Bounded: only the products we intend to prerender, by chain_count. A 453k-file
// dist fails to deploy (project_firebase_deploy_ceiling) and we sit at ~84k, so
// the whole 80k-product catalogue can never be prerendered. Choosing this cut is
// an editorial decision about which long-tail queries we mean to win.
//
// Stable: slugs are frozen at first insert (§4.5), so this file is append-mostly.
// A diff in it means a genuinely new product page, and it is reviewable before
// it can break an indexed URL.

import fs from "node:fs";
import path from "node:path";
import { allRows } from "../db/lib/pg";
import { PRERENDER_HEAD } from "./limits";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const OUT = path.join(ROOT, "data/prices/product_slugs.json");

export const exportSlugs = async (limit = PRERENDER_HEAD): Promise<void> => {
  const [{ today }] = await allRows<{ today: string | null }>(
    "SELECT max(day)::text AS today FROM price_grid_days",
  );
  if (!today) {
    console.log("[slugs] no data — skipping");
    return;
  }

  // Live products only: a retired row keeps its slug so old links resolve, but
  // it has chain_count = 0 and must not be prerendered.
  const rows = await allRows<{
    slug: string;
    title: string;
    pid: number;
    chain_count: number;
  }>(
    `SELECT slug, title, pid, chain_count
       FROM price_products
      WHERE last_seen = $1::date AND chain_count > 0
      ORDER BY chain_count DESC, sku_count DESC, slug COLLATE "C" ASC
      LIMIT $2`,
    [today, limit],
  );

  const payload = rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    pid: Number(r.pid),
    chainCount: Number(r.chain_count),
  }));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 0) + "\n");
  console.log(
    `[slugs] ${payload.length.toLocaleString()} products → data/prices/product_slugs.json ` +
      `(${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`,
  );
};

import { end } from "../db/lib/pg";

if (process.argv[1] && /export_slugs\.ts$/.test(process.argv[1])) {
  exportSlugs()
    .then(() => end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
