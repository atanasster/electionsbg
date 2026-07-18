// Build the serving blobs into `price_payloads`, mirroring agri_payloads /
// fund_payloads: (kind, key) -> jsonb, an O(1) primary-key seek per fetch.
//
// The maths is build_index.ts, unchanged. Only the source (price_grid_days
// instead of the _cache JSON tree) and the sink (price_payloads instead of
// files) differ. Keeping one code path is what makes the parity harness mean
// something: if the payloads diverge from the shipped JSON, it is a real
// regression and not an artefact of a second implementation.
//
// kinds: index | ranking | chains | dict | deals | verdict | hub-stats |
//        place:<ekatte> | chains-muni:<obshtina> | chain-products:<eik>

import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { withClient, allRows } from "../db/lib/pg";
import { copyRows } from "../db/lib/copy";
import { buildPriceIndex, type Emit } from "./build_index";
import { loadGridsFromPg } from "./lib/grids_pg";

export const buildPayloads = async (): Promise<void> => {
  const grids = await loadGridsFromPg();
  if (!grids.length) {
    console.log(
      "[payloads] no grids in price_grid_days — run the ingest first",
    );
    return;
  }

  const rows: [string, string, string][] = [];
  const emit: Emit = (kind, key, obj) => {
    rows.push([kind, key, JSON.stringify(obj)]);
  };

  buildPriceIndex({ grids, emit });

  // `deals` — the biggest current promo discount per product. Precomputed here
  // because the live query (SKU×store promo in price_current, joined to the
  // canonical catalogue) is ~600ms — too slow for a per-request fetch. Excludes
  // ≥95% "discounts" (data errors) and retired products (chain_count = 0).
  const deals = await allRows<{
    slug: string;
    title: string;
    promo: number;
    reg: number;
    discPct: number;
    eik: string;
    chain: string;
  }>(
    `WITH promos AS (
       SELECT pp.slug, pp.title, pc.promo_eur, pc.price_eur,
              (pc.price_eur - pc.promo_eur) / NULLIF(pc.price_eur, 0) AS disc,
              st.eik
         FROM price_current pc
         JOIN price_skus ps ON ps.sku_id = pc.sku_id
         JOIN price_products pp ON pp.product_id = ps.product_id
         JOIN price_stores st ON st.store_id = pc.store_id
        WHERE pc.promo_eur IS NOT NULL
          AND pc.promo_eur < pc.price_eur
          AND pp.chain_count > 0
     ),
     best AS (
       SELECT DISTINCT ON (slug) slug, title, promo_eur, price_eur, disc, eik
         FROM promos
        WHERE disc >= 0.15 AND disc < 0.95
        ORDER BY slug, disc DESC
     )
     SELECT b.slug, b.title,
            round(b.promo_eur::numeric, 2)::float8 AS promo,
            round(b.price_eur::numeric, 2)::float8 AS reg,
            round((b.disc * 100)::numeric, 0)::int AS "discPct",
            b.eik, COALESCE(ch.name, '') AS chain
       FROM best b
       LEFT JOIN price_chains ch ON ch.eik = b.eik
      ORDER BY b.disc DESC
      LIMIT 48`,
  );
  const [{ latest }] = await allRows<{ latest: string | null }>(
    "SELECT max(day)::text AS latest FROM price_grid_days",
  );
  emit("deals", "", { latestDate: latest ?? "", deals });

  // `verdict` — the "did the euro raise prices?" 5-bucket split. Precomputed
  // here because the live query is a full-table aggregate over the whole ~118k
  // catalogue (Parallel Seq Scan, ~50ms local / worse on the shared-core prod
  // instance) and it drives the hot /consumption/overview tile. Same shape the
  // old live price-verdict route returned (counts kept as-is for parity).
  const [verdict] = await allRows<Record<string, string>>(
    `SELECT count(*) FILTER (WHERE pct_since_euro < -0.1)      AS cheaper,
            count(*) FILTER (WHERE pct_since_euro >  0.1)      AS dearer,
            count(*) FILTER (WHERE abs(pct_since_euro) <= 0.1) AS unchanged,
            count(*) FILTER (WHERE pct_since_euro IS NULL)     AS no_baseline,
            count(*)                                           AS total
       FROM price_products WHERE chain_count > 0`,
  );
  emit("verdict", "", verdict ?? {});

  // `hub-stats` — the per-tile headline numbers on the /consumption hub (mirrors
  // the sectors hub's sector_stats.json). One tiny PK-seek blob: the price-side
  // counts come from the payloads just built (index/verdict/deals), the three
  // macro/fuel numbers are folded in from the small committed reference JSONs at
  // build time (read best-effort so a missing file just omits that stat).
  const idxPayload = rows.find((r) => r[0] === "index");
  const idx = idxPayload
    ? (JSON.parse(idxPayload[2]) as {
        coverage?: { settlements?: number; chains?: number };
        categories?: unknown[];
        national?: { index?: { v: number }[] };
      })
    : null;
  const natIndex = idx?.national?.index ?? [];
  const basketLast = natIndex.length ? natIndex[natIndex.length - 1].v : null;
  const num = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };
  const readJson = <T>(rel: string): T | null => {
    try {
      return JSON.parse(fs.readFileSync(path.resolve(rel), "utf8")) as T;
    } catch {
      return null;
    }
  };
  const total = num(verdict?.total);
  const dearer = num(verdict?.dearer);
  const cheaper = num(verdict?.cheaper);
  const unchanged = num(verdict?.unchanged);
  // Largest-remainder split over {cheaper, unchanged, dearer} so the three sum
  // to exactly 100 — identical to the EuroVerdictTile, so the euro tile's
  // headline matches the page it links to.
  const verdictPct = (() => {
    if (cheaper == null || unchanged == null || dearer == null) return null;
    const cmp = cheaper + unchanged + dearer || 1;
    const raw = [cheaper, unchanged, dearer].map((n) => (n / cmp) * 100);
    const floors = raw.map(Math.floor);
    let rem = 100 - floors.reduce((s, v) => s + v, 0);
    const order = raw
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac);
    const out = [...floors];
    for (const { i } of order) {
      if (rem <= 0) break;
      out[i] += 1;
      rem -= 1;
    }
    return { cheaper: out[0], unchanged: out[1], dearer: out[2] };
  })();

  const fuel = readJson<{
    series?: { bg95: number | null; eu95: number | null }[];
  }>("data/fuel.json");
  const fLast = fuel?.series?.[fuel.series.length - 1];
  const fuelGapPct =
    fLast?.bg95 != null && fLast.eu95
      ? Math.round((fLast.bg95 / fLast.eu95 - 1) * 1000) / 10
      : null;

  const peers = readJson<{
    foodPli?: { values?: Record<string, Record<string, number>> };
  }>("data/macro_peers.json");
  const euFoodPli = peers?.foodPli?.values?.BG?.A010101 ?? null;

  const macro = readJson<{
    series?: { inflationFood?: { value: number }[] };
  }>("data/macro.json");
  const infF = macro?.series?.inflationFood;
  const foodInflationPct = infF?.length ? infF[infF.length - 1].value : null;

  emit("hub-stats", "", {
    products: total,
    dearerPct: verdictPct?.dearer ?? null,
    cheaperPct: verdictPct?.cheaper ?? null,
    chains: idx?.coverage?.chains ?? null,
    settlements: idx?.coverage?.settlements ?? null,
    categories: idx?.categories?.length ?? null,
    basketChangePct:
      basketLast != null ? Math.round((basketLast - 100) * 10) / 10 : null,
    biggestDealPct: deals[0]?.discPct ?? null,
    fuelGapPct,
    euFoodPli,
    foodInflationPct,
  });

  // `chain-products:<eik>` — a retail chain's OWN products (top 100 by product
  // popularity) with the chain's min current price alongside the market min, for
  // the /consumption/chain/:eik profile. Precomputed because the live per-store
  // aggregation is ~0.8s on the biggest chain (10k SKUs) — too slow per request.
  // One windowed pass covers every chain; grouped into a blob per EIK.
  const chainProductRows = await allRows<{
    eik: string;
    slug: string;
    title: string;
    netQty: number | null;
    netUnit: string | null;
    price: number;
    marketMin: number | null;
    pctSinceEuro: number | null;
  }>(
    `WITH cp AS (
       SELECT ps.eik, pp.slug, pp.title, pp.net_qty, pp.net_unit, pp.chain_count,
              round(MIN(COALESCE(pc.promo_eur, pc.price_eur))::numeric, 2)::float8 AS price,
              pp.current_min_eur, pp.pct_since_euro
         FROM price_skus ps
         JOIN price_current pc ON pc.sku_id = ps.sku_id
         JOIN price_products pp ON pp.product_id = ps.product_id
        WHERE pp.chain_count > 0
        GROUP BY ps.eik, pp.slug, pp.title, pp.net_qty, pp.net_unit,
                 pp.chain_count, pp.current_min_eur, pp.pct_since_euro
     ),
     r AS (
       SELECT *, ROW_NUMBER() OVER (
                   PARTITION BY eik
                   ORDER BY chain_count DESC, price ASC, title
                 ) AS rn
         FROM cp
     )
     SELECT eik, slug, title,
            net_qty AS "netQty", net_unit AS "netUnit", price,
            current_min_eur AS "marketMin", pct_since_euro AS "pctSinceEuro"
       FROM r
      WHERE rn <= 100
      ORDER BY eik, rn`,
  );
  const byChain = new Map<
    string,
    Omit<(typeof chainProductRows)[number], "eik">[]
  >();
  for (const { eik, ...p } of chainProductRows) {
    if (!byChain.has(eik)) byChain.set(eik, []);
    byChain.get(eik)!.push(p);
  }
  for (const [eik, products] of byChain) {
    emit("chain-products", eik, { products });
  }

  await withClient(async (c: PoolClient) => {
    await c.query("BEGIN");
    try {
      // A full rebuild every run: the payloads are derived, small, and must
      // never contain a stale place shard for a settlement that dropped out.
      await c.query("TRUNCATE price_payloads");
      await copyRows(c, "price_payloads", ["kind", "key", "payload"], rows);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });

  const [{ n, bytes }] = await allRows<{ n: string; bytes: string }>(
    "SELECT count(*) AS n, pg_size_pretty(sum(pg_column_size(payload))::bigint) AS bytes FROM price_payloads",
  );
  const kinds = await allRows<{ kind: string; n: string }>(
    "SELECT kind, count(*) AS n FROM price_payloads GROUP BY kind ORDER BY 1",
  );
  console.log(
    `[payloads] ${Number(n).toLocaleString()} blobs (${bytes}) — ` +
      kinds.map((k) => `${k.kind}:${k.n}`).join(" "),
  );
};

import { end as endPool } from "../db/lib/pg";

if (process.argv[1] && /build_payloads\.ts$/.test(process.argv[1])) {
  buildPayloads()
    .then(() => endPool())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
