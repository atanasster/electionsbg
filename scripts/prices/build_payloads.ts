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
import { withClient, withTx, allRows, exec } from "../db/lib/pg";
import { copyRows } from "../db/lib/copy";
import {
  createStageTable,
  addStagePrimaryKey,
  mergeFromStage,
  type StageMergeSpec,
} from "../db/lib/stage_merge";

// Non-blocking reload (see scripts/db/lib/stage_merge.ts): every
// /api/db/price-payload route reads this table, so it is merged, never TRUNCATEd.
const PAYLOADS_MERGE: StageMergeSpec = {
  table: "price_payloads",
  source: "price_payloads_stage",
  keys: ["kind", "key"],
  cols: ["kind", "key", "payload"],
};
import { buildPriceIndex, type Emit } from "./build_index";
import { headlineIndex } from "../../src/data/prices/headline";
import type { PricePoint } from "../../src/data/prices/usePrices";
import { loadGridsFromPg } from "./lib/grids_pg";
import {
  STALE_DAYS,
  isStale,
  beyondCeiling,
} from "../../src/lib/priceStaleness";

// --- Deals quality gate (national + per-município) -------------------------
// The КЗП feed carries both a "redovna цена" (regular) and a promo price per
// store listing. A 2026-07 accuracy audit found the raw biggest-discount board
// was dominated by artefacts, in three modes: (1) a single store mis-keys the
// promo (0.55 € for a 260 g salami whose 10 sibling stores show 1.20 €) and,
// because we picked the deepest discount per product, that outlier became the
// headline; (2) a chain declares an inflated "regular" (Roshen Lacmi 90 g at
// 2.40 € when Фантастико + retail sell it at 1.69 €), so a normal promo reads as
// −63% not its true −53%; (3) a chain-wide source error (a 15 € coffee reported
// at 2 € across every Kaufland store).
//
// The gate below removes all three. Its core move: the discount is measured
// NOT against the store's own declared regular (the manipulable field) but
// against a chain-deduped BASELINE regular — the median of one-regular-per-chain,
// so a chain padding its reference across 35 stores counts once, not 35×. That
// makes the headline % faithful to the cross-chain typical price, and the board
// shows that baseline as the struck-through "regular".
const MIN_PROMO_STORES = 3; // promo must be corroborated across ≥N store listings
const MIN_PROMO_CHAINS = 2; // …and across ≥N distinct chains (a one-chain quirk is not a "deal")
const PROMO_OUTLIER_FLOOR = 0.7; // drop promos below 70% of the product's median (chain-deduped) promo
const MIN_PROMO_EUR = 0.1; // absolute floor — guards near-zero broken prices
const MIN_DISC = 0.15; // at least 15% off the baseline to count as a deal
const MAX_DISC = 0.7; // above 70% off is, empirically, a source error not a promo

// The stats + `promos` CTE block shared by the national and per-município deals
// queries. `withObshtina` adds the município column the muni board partitions on.
// Product-level stats are national (a row that is a national data artefact must
// not surface on a local board either). `promos.base_reg` is the chain-deduped
// baseline regular and `promos.disc` is computed against it — both outer queries
// select/display `base_reg` as the regular price.
const promoQualityCte = (withObshtina: boolean): string => `
  chain_stats AS (
    -- collapse to one regular + one promo per (product, chain): a chain that
    -- inflates its "regular" across 35 stores must count once, not 35×.
    SELECT pp.product_id, st.eik,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pc.price_eur) AS chain_reg,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pc.promo_eur)
             FILTER (WHERE pc.promo_eur IS NOT NULL) AS chain_promo
      FROM price_current pc
      JOIN price_skus ps ON ps.sku_id = pc.sku_id
      JOIN price_products pp ON pp.product_id = ps.product_id
      JOIN price_stores st ON st.store_id = pc.store_id
     GROUP BY pp.product_id, st.eik
  ),
  prod AS (
    -- chain-deduped baseline regular (the metric's denominator), median promo,
    -- and how many distinct chains actually run a promo (corroboration).
    SELECT product_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY chain_reg) AS base_reg,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY chain_promo)
             FILTER (WHERE chain_promo IS NOT NULL) AS med_promo,
           count(*) FILTER (WHERE chain_promo IS NOT NULL) AS n_promo_chains
      FROM chain_stats
     GROUP BY product_id
  ),
  promo_store_n AS (
    SELECT pp.product_id, count(*) AS n_promo_stores
      FROM price_current pc
      JOIN price_skus ps ON ps.sku_id = pc.sku_id
      JOIN price_products pp ON pp.product_id = ps.product_id
     WHERE pc.promo_eur IS NOT NULL
     GROUP BY pp.product_id
  ),
  promos AS (
    SELECT ${withObshtina ? "st.obshtina, " : ""}pp.slug, pp.title,
           pc.promo_eur, d.base_reg,
           (d.base_reg - pc.promo_eur) / NULLIF(d.base_reg, 0) AS disc,
           st.eik
      FROM price_current pc
      JOIN price_skus ps ON ps.sku_id = pc.sku_id
      JOIN price_products pp ON pp.product_id = ps.product_id
      JOIN price_stores st ON st.store_id = pc.store_id
      JOIN prod d ON d.product_id = pp.product_id
      JOIN promo_store_n n ON n.product_id = pp.product_id
     WHERE pc.promo_eur IS NOT NULL
       AND pp.chain_count > 0
       AND pc.promo_eur >= ${MIN_PROMO_EUR}
       AND pc.promo_eur < d.base_reg
       AND n.n_promo_stores >= ${MIN_PROMO_STORES}
       AND d.n_promo_chains >= ${MIN_PROMO_CHAINS}
       AND pc.promo_eur >= d.med_promo * ${PROMO_OUTLIER_FLOOR}
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
  // errors and inflated "redovna цена" reference prices — see promoQualityCte).
  // Every deal is corroborated across ≥MIN_PROMO_STORES store listings and
  // ≥MIN_PROMO_CHAINS distinct chains, is not a low-promo outlier, and its
  // discount — measured against the chain-deduped BASELINE regular, not the
  // store's declared one — sits in [MIN_DISC, MAX_DISC]. `reg` is the baseline.
  const deals = await allRows<{
    slug: string;
    title: string;
    promo: number;
    reg: number;
    discPct: number;
    eik: string;
    chain: string;
  }>(
    // Ordered by the ROUNDED discPct — the only discount field the payload
    // ships — with a slug tiebreak, never by the raw `disc`. Sorting on a key
    // finer than the one emitted makes the board unreproducible from its own
    // contents: two promos at 0.434 and 0.428 both ship "43%" and the array
    // order then encodes a difference the reader cannot see. Same rule as
    // reference_pg_payload_determinism, and the same reason `best` tiebreaks on
    // eik — without it, two chains tied at the deepest discount for one product
    // hand the row an arbitrary chain name.
    `WITH ${promoQualityCte(false)},
     best AS (
       SELECT DISTINCT ON (slug) slug, title, promo_eur, base_reg, disc, eik
         FROM promos
        WHERE disc >= ${MIN_DISC} AND disc <= ${MAX_DISC}
        ORDER BY slug, disc DESC, eik
     ),
     pct AS (
       SELECT b.*, round((b.disc * 100)::numeric, 0)::int AS disc_pct FROM best b
     )
     SELECT p.slug, p.title,
            round(p.promo_eur::numeric, 2)::float8 AS promo,
            round(p.base_reg::numeric, 2)::float8 AS reg,
            p.disc_pct AS "discPct",
            p.eik, COALESCE(ch.name, '') AS chain
       FROM pct p
       LEFT JOIN price_chains ch ON ch.eik = p.eik
      ORDER BY p.disc_pct DESC, p.slug
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
  //
  // PERF (measured on local PG, 1.57M price_current rows, 146 obshtini): ~444ms
  // build-time, dominated by the promo Parallel Seq Scan + a DISTINCT-ON sort.
  // Serving is untouched — every place-dashboard fetch is an O(1) PK seek on
  // price_payloads (~0.1ms). All join keys are indexed both sides, so nothing is
  // missing. A partial promo index on price_current is deliberately NOT added:
  // it costs ~89ms to rebuild on the daily TRUNCATE+reload and saves only ~40ms
  // per deal query (~break-even). The remaining win is the sort's disk spill
  // (7MB external merge), which a build-session work_mem bump removes (~444→
  // ~311ms) at zero recurring cost — left to the DB config, not forced here.
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
              obshtina, slug, title, promo_eur, base_reg, disc, eik
         FROM promos
        WHERE disc >= ${MIN_DISC} AND disc <= ${MAX_DISC}
        ORDER BY obshtina, slug, disc DESC, eik
     ),
     ranked AS (
       -- Both the top-24 CUT and the emitted order run on the rounded discPct
       -- (see the national board above), so the shipped array is reproducible
       -- from the fields it ships and the cut can't split a tie arbitrarily.
       SELECT b.*, round((b.disc * 100)::numeric, 0)::int AS disc_pct,
              row_number() OVER (
                PARTITION BY obshtina
                ORDER BY round((b.disc * 100)::numeric, 0) DESC, slug
              ) AS rn
         FROM best b
     )
     SELECT r.obshtina, r.slug, r.title,
            round(r.promo_eur::numeric, 2)::float8 AS promo,
            round(r.base_reg::numeric, 2)::float8 AS reg,
            r.disc_pct AS "discPct",
            r.eik, COALESCE(ch.name, '') AS chain
       FROM ranked r
       LEFT JOIN price_chains ch ON ch.eik = r.eik
      WHERE r.rn <= 24
      ORDER BY r.obshtina, r.disc_pct DESC, r.slug`,
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
        coverage?: {
          settlements?: number;
          chains?: number;
          headlineDate?: string;
          incompleteDates?: string[];
        };
        categories?: unknown[];
        national?: { index?: { d?: string; v: number; n?: number }[] };
      })
    : null;
  const natIndex = idx?.national?.index ?? [];
  // The SAME figure /prices headlines, imported rather than restated — this
  // blob drives the /consumption hub tile one click away, and while the rule
  // was hand-copied the two read −1.3% and +1.3%: the same measure with the
  // same caption, disagreeing about its sign.
  const basketLast =
    headlineIndex(natIndex as PricePoint[], idx?.coverage)?.v ?? null;
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
    series?: {
      petrol?: { BG?: number | null; EU27_2020?: number | null };
    }[];
  }>("data/fuel.json");
  const fLast = fuel?.series?.[fuel.series.length - 1];
  const fuelGapPct =
    fLast?.petrol?.BG != null && fLast.petrol.EU27_2020
      ? Math.round((fLast.petrol.BG / fLast.petrol.EU27_2020 - 1) * 1000) / 10
      : null;

  // Household electricity + natural-gas price gap vs the EU average, from the
  // committed Eurostat energy JSONs. Same formula + latest-common-period anchoring
  // as the fuel gap (EU27 can lag BG), so all three hub tiles are computed alike.
  const energyGapPct = (rel: string): number | null => {
    const d = readJson<{
      series?: {
        BG?: { period: string; value: number }[];
        EU27?: { period: string; value: number }[];
      };
    }>(rel);
    const bgS = d?.series?.BG ?? [];
    const euByPeriod = new Map(
      (d?.series?.EU27 ?? []).map((p) => [p.period, p.value]),
    );
    for (let i = bgS.length - 1; i >= 0; i--) {
      const eu = euByPeriod.get(bgS[i].period);
      if (eu != null && eu > 0)
        return Math.round((bgS[i].value / eu - 1) * 1000) / 10;
    }
    return null;
  };
  const electricityGapPct = energyGapPct("data/energy/prices.json");
  const gasGapPct = energyGapPct("data/energy/gas_prices.json");

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
    electricityGapPct,
    gasGapPct,
    foodInflationPct,
  });

  // `chain-products:<eik>` — a retail chain's OWN products (top 100 by product
  // popularity) with the chain's min LAST-KNOWN price alongside the market min,
  // for the /consumption/chain/:eik profile. Precomputed because the live
  // per-store aggregation is ~0.8s on the biggest chain (10k SKUs) — too slow
  // per request. One windowed pass covers every chain; grouped into a blob per
  // EIK.
  //
  // ⚠️ Reads `price_last_seen`, NOT `price_current`, and that is the whole point
  // of T2b. price_current drops every row of a chain that stopped filing, so
  // this query returned nothing for it, `emit` never fired, and the payload
  // merge's anti-join then DELETED the chain's existing blob — the page went
  // away rather than going stale. Measured on the corpus this was written
  // against: 170 of 215 chains had already gone silent.
  //
  // The price of reading last-known is that a row may be OLD, so every row
  // carries the day it was observed and the blob carries the chain's own last
  // reporting day against the corpus's. Nothing here may be fed into a ranking
  // or a cross-chain minimum — `chain-map` and `basketLevel` keep reading
  // price_current and the day grids precisely so a stale price cannot win a
  // "cheapest" comparison. See docs/plans/prices-chain-absence-v1.md T2c.
  const chainProductRows = await allRows<{
    eik: string;
    slug: string;
    title: string;
    netQty: number | null;
    netUnit: string | null;
    price: number;
    marketMin: number | null;
    pctSinceEuro: number | null;
    asOf: string;
  }>(
    `WITH latest AS (SELECT max(day) AS d FROM price_grid_days),
     -- Chains that filed on the latest day. For these, price_current IS the
     -- last-known price and is 3.7x smaller, so the hot path stays exactly the
     -- query this used to be.
     filed AS (
       SELECT DISTINCT ps.eik
         FROM price_skus ps JOIN price_current pc ON pc.sku_id = ps.sku_id
     ),
     obs AS (
       SELECT ps.eik, ps.product_id, pc.price_eur, pc.promo_eur, l.d AS as_of
         FROM price_skus ps
         JOIN price_current pc ON pc.sku_id = ps.sku_id
        CROSS JOIN latest l
       UNION ALL
       -- …and ONLY the silent chains fall back to the last-known layer. This is
       -- the arm that stops a chain's page being pruned out of existence when it
       -- stops filing. Bounded by STALE_DAYS so a chain silent for longer drops
       -- out rather than showing prices of unbounded age (plan T2c / Q2); the
       -- page then says "no data since …" instead.
       SELECT ps.eik, ps.product_id, pls.price_eur, pls.promo_eur, pls.as_of
         FROM price_skus ps
         JOIN price_last_seen pls ON pls.sku_id = ps.sku_id
        CROSS JOIN latest l
        WHERE NOT EXISTS (SELECT 1 FROM filed f WHERE f.eik = ps.eik)
          AND pls.as_of >= l.d - $1::int
     ),
     cp AS (
       SELECT o.eik, pp.slug, pp.title, pp.net_qty, pp.net_unit, pp.chain_count,
              round(MIN(COALESCE(o.promo_eur, o.price_eur))::numeric, 2)::float8 AS price,
              -- ⚠️ NOT max(as_of): MIN(price) and max(as_of) are independent
              -- aggregates, so the pair can describe two different rows and date
              -- a price fresher than it is (measured: 132 of 20,006 stale groups,
              -- by up to 24 days). Take the as_of OF the row that supplied the
              -- minimum.
              (array_agg(o.as_of ORDER BY COALESCE(o.promo_eur, o.price_eur), o.as_of))[1] AS as_of,
              pp.current_min_eur, pp.pct_since_euro
         FROM obs o
         JOIN price_products pp ON pp.product_id = o.product_id
        -- WARNING: no chain_count > 0 filter here. chain_count is recomputed from
        -- price_current, so a silent chain's EXCLUSIVE products fall to 0 the
        -- moment it stops filing — and gating on it would delete the very pages
        -- this arm exists to keep (measured: АПТЕКА АСПИДА, silent 2 days, 116
        -- in-window rows → 0 surviving; GREEN DELI CAFE, 4 days, 41 → 0). The
        -- join to price_products is what excludes unmatched SKUs; chain_count
        -- survives only as a RANKING key below, where 0 simply sorts last.
        GROUP BY o.eik, pp.slug, pp.title, pp.net_qty, pp.net_unit,
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
            -- ⚠️ marketMin is TODAY's cross-chain minimum, so it is a claim
            -- about the market NOW. Beside a price observed on an earlier day it
            -- is not a comparison at all — and the page renders it struck
            -- through, plus a „най-евтина" badge when the row undercuts it, i.e.
            -- it asserts a days-old price is currently the cheapest on the
            -- market. So the SERVER withholds it rather than trusting the client
            -- to: as_of = latest is exactly "this price was observed today".
            --
            -- ChainProfileScreen gates on stale as well, and that redundancy
            -- is deliberate rather than sloppy. This half is what makes the
            -- payload safe to publish AHEAD of a bundle — a deploy order that is
            -- otherwise a live defect, since an older bundle knows nothing about
            -- staleness and will happily render whatever it is sent. It is also
            -- the structural half: the client gate has already been forgotten
            -- once (the strikethrough shipped in the first cut of T2c and
            -- survived review), whereas a column that is NULL cannot be
            -- rendered by any consumer, present or future.
            CASE WHEN as_of = (SELECT d FROM latest) THEN current_min_eur END
              AS "marketMin",
            pct_since_euro AS "pctSinceEuro",
            as_of::text AS "asOf"
       FROM r
      WHERE rn <= 100
      ORDER BY eik, rn`,
    [STALE_DAYS],
  );
  const byChain = new Map<
    string,
    Omit<(typeof chainProductRows)[number], "eik">[]
  >();
  for (const { eik, ...p } of chainProductRows) {
    if (!byChain.has(eik)) byChain.set(eik, []);
    byChain.get(eik)!.push(p);
  }
  // The chain's own last reporting day, from the dimension rather than from the
  // top-100 slice — a chain can stop filing while a product it never delisted
  // still shows a recent as_of, and the page's headline must describe the CHAIN.
  const chainLastSeen = new Map(
    (
      await allRows<{ eik: string; last_seen: string }>(
        "SELECT eik, last_seen::text AS last_seen FROM price_chains",
      )
    ).map((r) => [r.eik, r.last_seen]),
  );
  // ⚠️ Iterate every KNOWN chain, not just the ones the query returned rows for.
  // Past STALE_DAYS the fallback arm yields nothing, and emitting nothing is a
  // DELETE: the payload merge's anti-join prunes the blob and the chain's page
  // disappears — the exact cascade this task exists to break, arriving one month
  // later instead of one day. priceStaleness.ts's header promises the opposite ("the
  // page says 'no data since <date>' and shows no prices"), so honour it: an
  // empty, dated blob. Measured: 3 chains are already past the ceiling, and 64
  // share last_seen = 2026-08-08, i.e. they would all have vanished together.
  for (const [eik, asOf] of chainLastSeen) {
    const products = byChain.get(eik) ?? [];
    emit("chain-products", eik, {
      products,
      // `asOf` is when this chain last filed; `latestDate` is the corpus's most
      // recent day. A page comparing them can say "last filed on X" instead of
      // presenting an old price as today's.
      asOf,
      latestDate: latest ?? "",
      stale: isStale(asOf, latest ?? null),
      // Past the display ceiling: the chain and its date are still served, the
      // prices are not. `products` is empty here BY DESIGN, not by absence.
      beyondCeiling: beyondCeiling(asOf, latest ?? null),
    });
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

  // A full rebuild every run: the payloads are derived, small, and must never
  // contain a stale place shard for a settlement that dropped out. But it is
  // staged and merged, never TRUNCATE + COPY — the TRUNCATE held an
  // AccessExclusiveLock on price_payloads for the whole COPY, and every
  // /api/db/price-payload reader queued behind it (measured on prod 2026-07-26,
  // before the pool grew its lock_timeout: a wave of 60 s 504s on kind=dict /
  // ranking / chains-muni). See scripts/db/lib/stage_merge.ts.
  await withClient(async (c: PoolClient) => {
    await createStageTable(c, PAYLOADS_MERGE);
    await copyRows(c, PAYLOADS_MERGE.source, ["kind", "key", "payload"], rows);
    await addStagePrimaryKey(c, PAYLOADS_MERGE);
  });
  await withTx(async (c) => {
    await mergeFromStage(c, PAYLOADS_MERGE);
  });
  await exec(`DROP TABLE IF EXISTS ${PAYLOADS_MERGE.source}`);

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
