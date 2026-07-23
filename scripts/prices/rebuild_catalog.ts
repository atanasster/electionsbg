// Rebuild the canonical product catalogue from price_skus.
//
// There is no EAN, so cross-chain identity is derived from names (see canon.ts).
// This runs after every daily ingest; it is a full recompute over ~150k SKUs.
//
// TWO RULES THAT ARE NOT NEGOTIABLE
//   1. `slug` is FROZEN at first insert. `title` is a recomputed modal name; if
//      it drove the slug, one chain renaming a listing would break every indexed
//      /product/:slug URL and every sitemap entry.
//   2. A group may span more than one chain ONLY if it has a parsed net quantity
//      or its КЗП product is unit-priced (loose produce). Otherwise it is
//      demoted to per-chain singletons. Unmatched is a first-class state; we
//      never merge silently to look more complete.
//
// price_products is never TRUNCATEd: product_id is a foreign key and slug is a
// public URL. Vanished products are retired via last_seen, never DELETEd, so old
// links keep resolving.

import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { withClient, allRows } from "../db/lib/pg";
import { copyRows } from "../db/lib/copy";
import { canonicalize, mayMergeAcrossChains, type Canon } from "./lib/canon";
import { unitPricedByPid } from "./seed_dict";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const OVERRIDES = path.join(ROOT, "data/prices/product_overrides.json");

interface Overrides {
  merge: [string, string][];
  split: string[];
  brand: Record<string, string>;
}

const readOverrides = (): Overrides => {
  const o = JSON.parse(fs.readFileSync(OVERRIDES, "utf8"));
  return { merge: o.merge ?? [], split: o.split ?? [], brand: o.brand ?? {} };
};

// ── slug ──────────────────────────────────────────────────────────────────
const TRANSLIT: Record<string, string> = {
  А: "a",
  Б: "b",
  В: "v",
  Г: "g",
  Д: "d",
  Е: "e",
  Ж: "zh",
  З: "z",
  И: "i",
  Й: "y",
  К: "k",
  Л: "l",
  М: "m",
  Н: "n",
  О: "o",
  П: "p",
  Р: "r",
  С: "s",
  Т: "t",
  У: "u",
  Ф: "f",
  Х: "h",
  Ц: "ts",
  Ч: "ch",
  Ш: "sh",
  Щ: "sht",
  Ъ: "a",
  Ь: "",
  Ю: "yu",
  Я: "ya",
};
const slugify = (title: string): string =>
  [...title.toUpperCase()]
    .map((ch) => TRANSLIT[ch] ?? ch.toLowerCase())
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "produkt";

// ── union-find, for the `merge` overrides ─────────────────────────────────
class DSU {
  private p = new Map<string, string>();
  find(x: string): string {
    const p = this.p.get(x);
    if (p === undefined || p === x) return x;
    const r = this.find(p);
    this.p.set(x, r);
    return r;
  }
  union(a: string, b: string): void {
    const [ra, rb] = [this.find(a), this.find(b)];
    if (ra !== rb) this.p.set(rb, ra);
  }
}

interface Group {
  canonKey: string;
  canon: Canon;
  skuIds: number[];
  titles: Map<string, number>;
  pid: number;
}

export const rebuildCatalog = async (): Promise<void> => {
  const unitPriced = unitPricedByPid();
  const ov = readOverrides();

  const skus = await allRows<{
    sku_id: string;
    eik: string;
    raw_name: string;
    pid: number | null;
  }>(
    // ORDER BY sku_id: slug disambiguation (`-2`/`-3` suffixes) consumes groups
    // in iteration order, and slugs are FROZEN public URLs. Without a stable
    // order, a from-scratch rebuild could repoint /product/banani after a
    // VACUUM reshuffles physical rows. sku_id is monotonic and stable.
    "SELECT sku_id, eik, raw_name, pid FROM price_skus WHERE pid IS NOT NULL ORDER BY sku_id",
  );
  if (!skus.length) {
    console.log("[catalog] no skus — nothing to do");
    return;
  }

  // 1. canonicalize
  const canonOf = new Map<number, Canon>();
  const dsu = new DSU();
  const splitSet = new Set(ov.split);
  for (const s of skus) {
    const pid = Number(s.pid);
    const c = canonicalize(s.raw_name, pid, unitPriced.get(pid) ?? false);
    canonOf.set(Number(s.sku_id), c);
  }
  // 2. overrides: force-merge
  for (const [a, b] of ov.merge) dsu.union(a, b);

  // 3. group. Demotion happens here: a group that may not merge across chains
  //    gets its key suffixed by the chain, producing per-chain singletons.
  const groups = new Map<string, Group>();
  for (const s of skus) {
    const skuId = Number(s.sku_id);
    const pid = Number(s.pid);
    const c = canonOf.get(skuId)!;
    let key = dsu.find(c.canonKey);
    if (!mayMergeAcrossChains(c) || splitSet.has(c.canonKey))
      key = `${key}|@${s.eik}`;

    let g = groups.get(key);
    if (!g) {
      g = {
        canonKey: key,
        canon: c,
        skuIds: [],
        titles: new Map(),
        pid,
      };
      groups.set(key, g);
    }
    g.skuIds.push(skuId);
    g.titles.set(c.title, (g.titles.get(c.title) ?? 0) + 1);
  }

  // 4. modal title (deterministic: count desc, then lexicographic)
  const modal = (m: Map<string, number>): string =>
    [...m.entries()].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
    )[0][0];

  const [{ today }] = await allRows<{ today: string }>(
    "SELECT max(day)::text AS today FROM price_grid_days",
  );

  await withClient(async (c: PoolClient) => {
    await c.query("BEGIN");
    try {
      // overrides mirror (git is the source of truth)
      await c.query("DELETE FROM price_product_overrides");
      for (const [a, b] of ov.merge)
        await c.query(
          "INSERT INTO price_product_overrides VALUES ('merge',$1,$2) ON CONFLICT DO NOTHING",
          [a, b],
        );
      for (const a of ov.split)
        await c.query(
          "INSERT INTO price_product_overrides VALUES ('split',$1,'') ON CONFLICT DO NOTHING",
          [a],
        );
      for (const [a, b] of Object.entries(ov.brand))
        await c.query(
          "INSERT INTO price_product_overrides VALUES ('brand',$1,$2) ON CONFLICT DO NOTHING",
          [a, b],
        );

      await c.query(`
        CREATE TEMP TABLE g (
          canon_key text PRIMARY KEY, slug text, pid smallint, title text,
          brand text, net_qty double precision, net_unit text, unit_priced boolean,
          attrs jsonb, chain_count int, sku_count int, confidence smallint
        ) ON COMMIT DROP`);

      const taken = new Set(
        (
          await allRows<{ slug: string }>("SELECT slug FROM price_products")
        ).map((r) => r.slug),
      );

      // Sort by canonKey so slug-suffix assignment (`-2`/`-3`) is independent of
      // Map insertion order — a from-scratch rebuild assigns the same slug to
      // the same product every time. Frozen public URLs (FINDING-005).
      const orderedGroups = [...groups.values()].sort((a, b) =>
        a.canonKey < b.canonKey ? -1 : a.canonKey > b.canonKey ? 1 : 0,
      );
      // Stage the temp table with ONE COPY stream, not a per-group INSERT. The
      // slug-uniqueness pass still runs per group in JS (order-stable via the
      // sort above); only the shipping changes. Row-by-row INSERT here was
      // latency-bound over the Cloud SQL proxy — ~118k round-trips took ~50 min
      // on the :cloud path (see scripts/db/lib/copy.ts header). COPY streams it
      // in seconds.
      const gRows: unknown[][] = [];
      for (const g of orderedGroups) {
        const title = modal(g.titles);
        let slug = slugify(title);
        // Slug uniqueness is enforced by the DB; disambiguate new ones here.
        // Existing products keep their frozen slug (the upsert never sets it).
        if (taken.has(slug)) {
          let i = 2;
          while (taken.has(`${slug}-${i}`)) i++;
          slug = `${slug}-${i}`;
        }
        taken.add(slug);
        const brand = ov.brand[g.canonKey] ?? g.canon.brand;
        gRows.push([
          g.canonKey,
          slug,
          g.pid,
          title,
          brand,
          g.canon.netQty,
          g.canon.netUnit,
          g.canon.unitPriced,
          g.canon.attrs, // jsonb — copyRows renders objects to JSON text
          0, // chain_count: seeded 0, recomputed live from price_current in step 7
          g.skuIds.length,
          g.canon.confidence,
        ]);
      }
      await copyRows(
        c,
        "g",
        [
          "canon_key",
          "slug",
          "pid",
          "title",
          "brand",
          "net_qty",
          "net_unit",
          "unit_priced",
          "attrs",
          "chain_count",
          "sku_count",
          "confidence",
        ],
        gRows,
      );

      // 5. upsert. `slug` and `first_seen` are absent from DO UPDATE: frozen.
      await c.query(
        `INSERT INTO price_products
           (canon_key, slug, pid, title, brand, net_qty, net_unit, unit_priced,
            attrs, chain_count, sku_count, confidence, first_seen, last_seen)
         SELECT canon_key, slug, pid, title, brand, net_qty, net_unit, unit_priced,
                attrs, chain_count, sku_count, confidence, $1::date, $1::date
           FROM g
         ON CONFLICT (canon_key) DO UPDATE SET
           title = EXCLUDED.title, brand = EXCLUDED.brand,
           net_qty = EXCLUDED.net_qty, net_unit = EXCLUDED.net_unit,
           unit_priced = EXCLUDED.unit_priced, attrs = EXCLUDED.attrs,
           chain_count = EXCLUDED.chain_count, sku_count = EXCLUDED.sku_count,
           confidence = EXCLUDED.confidence, last_seen = EXCLUDED.last_seen`,
        [today],
      );

      // 5b. Retire products that this run did not produce. They are NEVER
      //     deleted — product_id is a foreign key and slug is a public URL that
      //     Google has indexed. But a stale row must not stay rankable: a change
      //     to canon_key (an algorithm fix, an override) orphans the old group,
      //     and leaving its chain_count intact would show two "БАНАНИ", one with
      //     56 chains and one with 53. Zero the live-facing columns and let
      //     last_seen mark it dead.
      await c.query(`
        UPDATE price_products p
           SET chain_count = 0, sku_count = 0, current_min_eur = NULL, pct_since_euro = NULL
         WHERE NOT EXISTS (SELECT 1 FROM g WHERE g.canon_key = p.canon_key)`);

      // 6. attach skus
      await c.query(
        `CREATE TEMP TABLE sk (sku_id bigint PRIMARY KEY, canon_key text) ON COMMIT DROP`,
      );
      const rows: unknown[][] = [];
      for (const g of groups.values())
        for (const id of g.skuIds) rows.push([id, g.canonKey]);
      await copyRows(c, "sk", ["sku_id", "canon_key"], rows);
      await c.query(`
        UPDATE price_skus k SET product_id = p.product_id
          FROM sk, price_products p
         WHERE sk.sku_id = k.sku_id AND p.canon_key = sk.canon_key`);

      // 7. materialize the columns the DbDataTable registry sorts on.
      //
      // current_min_eur = the lowest price you can actually buy it for TODAY.
      // A real advertised price, useful as-is. From price_current, never
      // price_facts (whose open runs include every delisted SKU — design §3.2).
      //
      // chain_count = how many chains carry a LIVE price for it today — the same
      // number the /product ladder shows and the "N вериги" search caption prints.
      // It is a live-facing column like current_min_eur, NOT the all-time count of
      // chains ever matched: a chain whose SKU was matched historically but that
      // did not report today is absent from the ladder, so counting it here would
      // print "13 вериги" above a 4-row ladder. Computed from price_current with
      // the SAME unit-outlier guard as the ladder, so search caption == ladder.
      //
      // Blanket-reset first (like pct_since_euro below): a product that still
      // forms a group but whose every SKU was delisted is absent from the
      // price_current subquery, so a conditional-only UPDATE would leave its
      // PRIOR-run price advertised for something no longer on any shelf
      // (FINDING-004). chain_count resets to 0 for the same reason: a delisted
      // product must fall out of search (`WHERE chain_count > 0`), not linger at
      // its stale all-time count.
      // Unit-outlier guard (mirrors build_product_days.ts): a per-kg product's
      // cheapest price ignores store-facts below half its cross-store median, so
      // a per-piece listing (a single banana at €0.76) cannot masquerade as the
      // "cheapest БАНАНИ". Packaged goods keep the raw min (legit pack spreads).
      // The guard also gates the chain count, so a chain present only via a
      // spurious per-piece row is not counted toward "N вериги".
      await c.query(
        `UPDATE price_products p SET current_min_eur = NULL, chain_count = 0`,
      );
      await c.query(`
        WITH cur AS (
          SELECT k.product_id, k.eik, pc.price_eur, p.unit_priced
            FROM price_current pc
            JOIN price_skus k ON k.sku_id = pc.sku_id
            JOIN price_products p ON p.product_id = k.product_id
           WHERE k.product_id IS NOT NULL
        ),
        med AS (
          SELECT product_id,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY price_eur) AS m
            FROM cur GROUP BY product_id
        )
        UPDATE price_products p
           SET current_min_eur = x.m,
               chain_count      = x.cc
          FROM (SELECT cur.product_id,
                       min(cur.price_eur)      AS m,
                       count(DISTINCT cur.eik) AS cc
                  FROM cur JOIN med USING (product_id)
                 WHERE NOT cur.unit_priced OR cur.price_eur >= 0.5 * med.m
                 GROUP BY cur.product_id) x
         WHERE x.product_id = p.product_id`);

      // pct_since_euro = MEDIAN today vs MEDIAN on euro day, NOT min vs min.
      //
      // Min-to-min is worthless as a change metric: on euro day (a holiday) one
      // of 827 stores had Vereya 3% milk at a 0.91€ promo while the median was
      // 1.73€, so min-to-min reported +52.7% when the real move was ~0. This is
      // the exact noise build_index.ts uses median-of-per-settlement-minimums to
      // avoid ("a single cheap/expensive store swings the min"). Median over the
      // whole store panel is the robust product-grain analogue.
      //
      // NULL = no observation on euro day (the fifth bucket). Never fold a
      // post-euro product into "unchanged".
      const [{ d: euroDay }] = await allRows<{ d: string }>(
        "SELECT min(day)::text AS d FROM price_grid_days",
      );
      await c.query(`UPDATE price_products p SET pct_since_euro = NULL`);
      await c.query(
        `WITH base AS (
           SELECT k.product_id,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY f.price_eur) AS m
             FROM price_facts f
             JOIN price_skus k ON k.sku_id = f.sku_id
            WHERE k.product_id IS NOT NULL
              AND f.valid_from <= $1::date
              AND (f.valid_to IS NULL OR f.valid_to >= $1::date)
            GROUP BY k.product_id),
         now AS (
           SELECT k.product_id,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY pc.price_eur) AS m
             FROM price_current pc
             JOIN price_skus k ON k.sku_id = pc.sku_id
            WHERE k.product_id IS NOT NULL
            GROUP BY k.product_id)
         UPDATE price_products p
            -- A move >100% since euro-day is a data artifact (thin euro-day
            -- baseline, per-piece↔per-kg unit change, or identity drift under one
            -- canon_key), not real inflation — store NULL ("no reliable baseline")
            -- so no consumer (UI, AI) reports a "+429%".
            SET pct_since_euro = CASE
                  WHEN abs(now.m / base.m - 1) > 1 THEN NULL
                  ELSE round((now.m / base.m - 1)::numeric * 100, 3)
                END
           FROM base JOIN now USING (product_id)
          WHERE base.product_id = p.product_id AND base.m > 0`,
        [euroDay],
      );

      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });

  // Stats over LIVE products only (last_seen = the day just loaded). Retired
  // rows linger for URL resolution and would otherwise inflate every count.
  const [stats] = await allRows<{
    n: string;
    multi: string;
    unmatched: string;
    nosize: string;
    retired: string;
  }>(
    `SELECT count(*) FILTER (WHERE last_seen = $1::date) AS n,
            count(*) FILTER (WHERE last_seen = $1::date AND chain_count > 1) AS multi,
            count(*) FILTER (WHERE last_seen = $1::date AND net_qty IS NULL AND NOT unit_priced) AS nosize,
            count(*) FILTER (WHERE last_seen < $1::date) AS retired,
            (SELECT count(*) FROM price_skus WHERE product_id IS NULL) AS unmatched
       FROM price_products`,
    [today],
  );
  const n = Number(stats.n);
  console.log(
    `[catalog] ${n.toLocaleString()} products · ` +
      `${Number(stats.multi).toLocaleString()} multi-chain (${((Number(stats.multi) / n) * 100).toFixed(1)}%) · ` +
      `${Number(stats.nosize).toLocaleString()} without a parsed size · ` +
      `${Number(stats.unmatched).toLocaleString()} unmatched skus · ` +
      `${Number(stats.retired).toLocaleString()} retired`,
  );
};

import { end } from "../db/lib/pg";

if (process.argv[1] && /rebuild_catalog\.ts$/.test(process.argv[1])) {
  rebuildCatalog()
    .then(() => end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
