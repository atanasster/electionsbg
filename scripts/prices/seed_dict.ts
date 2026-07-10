// Mirror the hand-authored scripts/prices/products.json into Postgres.
//
// Git stays the source of truth: `unit_priced` gates a MERGE RULE (whether a
// product may be compared across chains at all), so a change to it must arrive
// as a reviewable diff, not an invisible UPDATE. This copy exists only so SQL
// can join pid -> label without round-tripping a payload blob.

import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);

interface Dict {
  categories: { id: number; bg: string; en: string }[];
  products: {
    id: number;
    cat: number;
    bg: string;
    en: string;
    unit_priced?: boolean;
  }[];
}

export const readDict = (): Dict =>
  JSON.parse(
    fs.readFileSync(path.join(ROOT, "scripts/prices/products.json"), "utf8"),
  );

/** pid -> unit_priced, for canonicalize(). */
export const unitPricedByPid = (): Map<number, boolean> =>
  new Map(readDict().products.map((p) => [p.id, !!p.unit_priced]));

export const seedDict = async (c: PoolClient): Promise<void> => {
  const d = readDict();
  // UPSERT, never DELETE+INSERT. price_products.pid references
  // price_kzp_products, so once the catalogue exists a DELETE of the parent
  // raises price_products_pid_fkey — Postgres reports the violation against the
  // *referencing* table, which makes it look like an INSERT failure.
  //
  // The 101 products and 14 categories are a fixed, hand-authored set; rows are
  // never removed, only relabelled or re-flagged.
  for (const cat of d.categories) {
    await c.query(
      `INSERT INTO price_kzp_cats (cat, bg, en) VALUES ($1,$2,$3)
       ON CONFLICT (cat) DO UPDATE SET bg = EXCLUDED.bg, en = EXCLUDED.en`,
      [cat.id, cat.bg, cat.en],
    );
  }
  for (const p of d.products) {
    await c.query(
      `INSERT INTO price_kzp_products (pid, cat, bg, en, unit_priced)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (pid) DO UPDATE SET
         cat = EXCLUDED.cat, bg = EXCLUDED.bg, en = EXCLUDED.en,
         unit_priced = EXCLUDED.unit_priced`,
      [p.id, p.cat, p.bg, p.en, !!p.unit_priced],
    );
  }
};
