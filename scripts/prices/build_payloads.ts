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
//        chain-map | unit-prices |
//        place:<ekatte> | chains-muni:<obshtina> | chain-products:<eik> |
//        deals-muni:<obshtina>

import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { withClient, allRows } from "../db/lib/pg";
import { copyRows } from "../db/lib/copy";
import { buildPriceIndex, type Emit } from "./build_index";
import { loadGridsFromPg } from "./lib/grids_pg";

// --- Deals quality gate (national + per-município) -------------------------
// The КЗП feed carries both a "redovna цена" (regular) and a promo price per
// store listing. A 2026-07 accuracy audit found the raw biggest-discount board
// was dominated by artefacts, in two modes: (1) a single store mis-keys the
// promo (0.55 € for a 260 g salami whose 10 sibling stores show 1.20 €) and,
// because we picked the deepest discount per product, that outlier became the
// headline; (2) a chain declares an inflated regular (fresh potatoes at 3.55 €
// when Билла sells them at 1.19 € across 166 stores), so a normal promo reads
// as −75%. A third mode is a chain-wide source error (a 15 € coffee reported at
// 2 € across every Kaufland store). The gate below removes all three.
const MIN_PROMO_STORES = 3; // promo must be corroborated across ≥N store listings
const PROMO_OUTLIER_FLOOR = 0.7; // drop promos below 70% of the product's median promo
const REG_INFLATION_CAP = 1.25; // drop regulars above 125% of the product's median regular
const MIN_PROMO_EUR = 0.1; // absolute floor — guards near-zero broken prices
const MIN_DISC = 0.15; // at least 15% off to count as a deal
const MAX_DISC = 0.7; // above 70% off is, empirically, a source error not a promo

// The stats + `promos` CTE block shared by the national and per-município deals
// queries. `withObshtina` adds the município column the muni board partitions on.
// Product-level stats are national (a row that is a national data artefact must
// not surface on a local board either).
const promoQualityCte = (withObshtina: boolean): string => `
  promo_stats AS (
    SELECT pp.product_id, count(*) AS n_promo,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pc.promo_eur) AS med_promo
      FROM price_current pc
      JOIN price_skus ps ON ps.sku_id = pc.sku_id
      JOIN price_products pp ON pp.product_id = ps.product_id
     WHERE pc.promo_eur IS NOT NULL
     GROUP BY pp.product_id
  ),
  reg_stats AS (
    SELECT pp.product_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pc.price_eur) AS med_reg
      FROM price_current pc
      JOIN price_skus ps ON ps.sku_id = pc.sku_id
      JOIN price_products pp ON pp.product_id = ps.product_id
     GROUP BY pp.product_id
  ),
  promos AS (
    SELECT ${withObshtina ? "st.obshtina, " : ""}pp.slug, pp.title,
           pc.promo_eur, pc.price_eur,
           (pc.price_eur - pc.promo_eur) / NULLIF(pc.price_eur, 0) AS disc,
           st.eik
      FROM price_current pc
      JOIN price_skus ps ON ps.sku_id = pc.sku_id
      JOIN price_products pp ON pp.product_id = ps.product_id
      JOIN price_stores st ON st.store_id = pc.store_id
      JOIN promo_stats mp ON mp.product_id = pp.product_id
      JOIN reg_stats mr ON mr.product_id = pp.product_id
     WHERE pc.promo_eur IS NOT NULL
       AND pc.promo_eur < pc.price_eur
       AND pp.chain_count > 0
       AND pc.promo_eur >= ${MIN_PROMO_EUR}
       AND mp.n_promo >= ${MIN_PROMO_STORES}
       AND pc.promo_eur >= mp.med_promo * ${PROMO_OUTLIER_FLOOR}
       AND pc.price_eur <= mr.med_reg * ${REG_INFLATION_CAP}
  )`;

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
  // retired products (chain_count = 0).
  //
  // Quality gate (audit 2026-07: the raw feed is dominated by single-store data
  // errors and inflated "redovna цена" reference prices — see PROMO_QUALITY_SQL).
  // Every deal must be corroborated across ≥MIN_PROMO_STORES store listings, must
  // not be a low-promo outlier vs the product's own median promo, must not sit on
  // an inflated regular price vs the product's median regular, and its discount
  // is capped at MAX_DISC — supermarket promos above that are, empirically, source
  // errors (a €15 coffee reported at €2 across all stores; a shared-wholesaler
  // 90 g Milka at €0.69). Thresholds are conservative and easy to tune.
  const deals = await allRows<{
    slug: string;
    title: string;
    promo: number;
    reg: number;
    discPct: number;
    eik: string;
    chain: string;
  }>(
    `WITH ${promoQualityCte(false)},
     best AS (
       SELECT DISTINCT ON (slug) slug, title, promo_eur, price_eur, disc, eik
         FROM promos
        WHERE disc >= ${MIN_DISC} AND disc <= ${MAX_DISC}
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

  // `deals-muni:<obshtina>` — the same promo feed scoped to one município, so
  // the place dashboard can show "промоции край вас". Município (not settlement)
  // grain: a single settlement often has ≤2 stores, too sparse for a usable
  // list; the obshtina aggregates its stores. Reads price_current (today's
  // truth: TRUNCATE+reload of the latest ingested day), so this MUST run after
  // the day is loaded — an ended promo drops out on the next ingest. Top 24 per
  // obshtina by discount; eik/slug tiebreaks keep it deterministic for the
  // parity gate. `latestDate` is carried so the UI shows an as-of date, exactly
  // like the national `deals` blob.
  const muniDeals = await allRows<{
    obshtina: string;
    slug: string;
    title: string;
    promo: number;
    reg: number;
    discPct: number;
    eik: string;
    chain: string;
  }>(
    `WITH ${promoQualityCte(true)},
     best AS (
       SELECT DISTINCT ON (obshtina, slug)
              obshtina, slug, title, promo_eur, price_eur, disc, eik
         FROM promos
        WHERE disc >= ${MIN_DISC} AND disc <= ${MAX_DISC}
        ORDER BY obshtina, slug, disc DESC, eik
     ),
     ranked AS (
       SELECT b.*,
              row_number() OVER (
                PARTITION BY obshtina ORDER BY disc DESC, slug
              ) AS rn
         FROM best b
     )
     SELECT r.obshtina, r.slug, r.title,
            round(r.promo_eur::numeric, 2)::float8 AS promo,
            round(r.price_eur::numeric, 2)::float8 AS reg,
            round((r.disc * 100)::numeric, 0)::int AS "discPct",
            r.eik, COALESCE(ch.name, '') AS chain
       FROM ranked r
       LEFT JOIN price_chains ch ON ch.eik = r.eik
      WHERE r.rn <= 24
      ORDER BY r.obshtina, r.disc DESC, r.slug`,
  );
  const dealsByMuni = new Map<
    string,
    Omit<(typeof muniDeals)[number], "obshtina">[]
  >();
  for (const { obshtina, ...d } of muniDeals) {
    (
      dealsByMuni.get(obshtina) ?? dealsByMuni.set(obshtina, []).get(obshtina)!
    ).push(d);
  }
  for (const [obshtina, list] of dealsByMuni) {
    emit("deals-muni", obshtina, { latestDate: latest ?? "", deals: list });
  }

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

  // `chain-map` — the CHEAPEST chain in each município, for the categorical
  // "who wins where" choropleth on /prices/map. Fairness: a chain counts for a
  // município only if it prices ALL of the common basket there (same 12-product
  // core basket build_index uses for the muni rank), so a corner-shop that lists
  // two cheap items can't "win". Keyed by obshtina, aligned to the ranking muni
  // `code` (Sofia = SOF46; the map remaps SOF46→SOF00 client-side). Regular
  // price (price_eur), matching the basket-cost map.
  const COMMON_BASKET = [1, 6, 9, 11, 35, 38, 40, 42, 52, 54, 55, 61];
  const chainMap = await allRows<{
    code: string;
    eik: string;
    chain: string;
    basket: number;
    nPriced: number;
  }>(
    `WITH cur AS (
       SELECT st.obshtina, st.eik, sk.pid, MIN(pc.price_eur) AS p
         FROM price_current pc
         JOIN price_skus sk ON sk.sku_id = pc.sku_id
         JOIN price_stores st ON st.store_id = pc.store_id
        WHERE sk.pid = ANY($1::int[])
        GROUP BY st.obshtina, st.eik, sk.pid
     ),
     basket AS (
       SELECT obshtina, eik, SUM(p) AS basket, COUNT(*) AS npriced
         FROM cur GROUP BY obshtina, eik
        HAVING COUNT(*) = $2
     ),
     ranked AS (
       SELECT *, ROW_NUMBER() OVER (
                   PARTITION BY obshtina ORDER BY basket ASC, eik
                 ) AS rn FROM basket
     )
     SELECT r.obshtina AS code, r.eik, ch.name AS chain,
            round(r.basket::numeric, 2)::float8 AS basket,
            r.npriced AS "nPriced"
       FROM ranked r JOIN price_chains ch ON ch.eik = r.eik
      WHERE rn = 1
      ORDER BY code`,
    [COMMON_BASKET, COMMON_BASKET.length],
  );
  emit("chain-map", "", { latestDate: latest ?? "", munis: chainMap });

  // `unit-prices` — normalized €/kg (from g) and €/L (from ml) per KZP category,
  // for the /consumption/unit-prices FOOD-value explorer. `brand` is empty and
  // pack size is frozen into product identity, so true downsizing isn't
  // derivable; per-unit price IS (net_qty/net_unit cover ~52% of live products).
  // Per category: the median plus the best-value (lowest €/unit) products.
  // Guards: a basis is emitted only with ≥30 products (a small median is noise),
  // `pc` (per-piece) products are excluded (no kg/L basis), and cats 12/13/14
  // (alcohol&tobacco, hygiene/cosmetics, medicines) are dropped — they are not a
  // "food per kg" signal and their net_qty is unreliable (spirits tagged "10Г",
  // a rug mis-filed under alcohol, medicines priced per dose), which even poisons
  // the category median so the half-median leader guard can't rescue it.
  const unitMed = await allRows<{
    cat: number;
    bg: string;
    en: string;
    medKg: number | null;
    medL: number | null;
    nKg: number;
    nL: number;
  }>(
    `SELECT kc.cat, kc.bg, kc.en,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY pp.current_min_eur*1000.0/pp.net_qty)
              FILTER (WHERE pp.net_unit='g'))::numeric, 2)::float8 AS "medKg",
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY pp.current_min_eur*1000.0/pp.net_qty)
              FILTER (WHERE pp.net_unit='ml'))::numeric, 2)::float8 AS "medL",
       count(*) FILTER (WHERE pp.net_unit='g')  AS "nKg",
       count(*) FILTER (WHERE pp.net_unit='ml') AS "nL"
      FROM price_products pp
      JOIN price_kzp_products kp ON kp.pid = pp.pid
      JOIN price_kzp_cats kc ON kc.cat = kp.cat
     WHERE pp.chain_count > 0 AND pp.current_min_eur IS NOT NULL
       AND pp.net_qty > 0 AND pp.net_unit IN ('g','ml')
       AND kp.cat NOT IN (12, 13, 14)
     GROUP BY kc.cat, kc.bg, kc.en ORDER BY kc.cat`,
  );
  const unitLeaders = await allRows<{
    cat: number;
    unit: string;
    slug: string;
    title: string;
    netQty: number;
    eurPerUnit: number;
    rnBest: number;
    rnWorst: number;
  }>(
    // Unit-outlier guard (mirrors build_product_days' half-median rule): a few
    // SKUs enter grams as kg ("500КГ" → net_qty 500000 → €/kg ≈ 0) or a count as
    // litres (eggs "10 L"), which would otherwise pin the best/worst leaders.
    // Rank only rows within [0.25×, 20×] the per-(cat,unit) median €/unit.
    `WITH up AS (
       SELECT pp.slug, pp.title, pp.net_qty, pp.net_unit AS unit, kp.cat,
              pp.current_min_eur * 1000.0 / pp.net_qty AS eu
         FROM price_products pp
         JOIN price_kzp_products kp ON kp.pid = pp.pid
        WHERE pp.chain_count > 0 AND pp.current_min_eur IS NOT NULL
          AND pp.net_qty > 0 AND pp.net_unit IN ('g','ml')
          AND kp.cat NOT IN (12, 13, 14)
     ),
     med AS (
       SELECT cat, unit, percentile_cont(0.5) WITHIN GROUP (ORDER BY eu) AS m
         FROM up GROUP BY cat, unit
     ),
     filt AS (
       SELECT up.* FROM up JOIN med USING (cat, unit)
        WHERE up.eu >= 0.25 * med.m AND up.eu <= 20 * med.m
     ),
     ranked AS (
       SELECT *,
         ROW_NUMBER() OVER (PARTITION BY cat, unit ORDER BY eu ASC,  slug) AS "rnBest",
         ROW_NUMBER() OVER (PARTITION BY cat, unit ORDER BY eu DESC, slug) AS "rnWorst"
         FROM filt
     )
     SELECT cat, unit, slug, title, net_qty AS "netQty",
            round(eu::numeric, 2)::float8 AS "eurPerUnit", "rnBest", "rnWorst"
       FROM ranked WHERE "rnBest" <= 8 OR "rnWorst" <= 8
      ORDER BY cat, unit, eu`,
  );
  const MIN_N = 30;
  type Leader = {
    slug: string;
    title: string;
    netQty: number;
    eurPerUnit: number;
  };
  const basisFor = (cat: number, unit: "g" | "ml") => {
    const rows = unitLeaders.filter((r) => r.cat === cat && r.unit === unit);
    const best: Leader[] = rows
      .filter((r) => r.rnBest <= 8)
      .sort((a, b) => a.rnBest - b.rnBest)
      .map(({ slug, title, netQty, eurPerUnit }) => ({
        slug,
        title,
        netQty,
        eurPerUnit,
      }));
    const worst: Leader[] = rows
      .filter((r) => r.rnWorst <= 8)
      .sort((a, b) => a.rnWorst - b.rnWorst)
      .map(({ slug, title, netQty, eurPerUnit }) => ({
        slug,
        title,
        netQty,
        eurPerUnit,
      }));
    return { best, worst };
  };
  const unitCategories = unitMed.map((m) => ({
    cat: m.cat,
    bg: m.bg,
    en: m.en,
    kg:
      m.medKg != null && Number(m.nKg) >= MIN_N
        ? { median: m.medKg, n: Number(m.nKg), ...basisFor(m.cat, "g") }
        : null,
    l:
      m.medL != null && Number(m.nL) >= MIN_N
        ? { median: m.medL, n: Number(m.nL), ...basisFor(m.cat, "ml") }
        : null,
  }));
  emit("unit-prices", "", {
    latestDate: latest ?? "",
    categories: unitCategories,
  });

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
