// The price half of the home feed's „what changed", measured from Postgres and COMMITTED as
// `data/home/price_events.json` so `gen_home/feed.ts` never needs a database.
//
//   npm run db:gen-home-price-events
//   npx tsx scripts/db/gen_home/price_events.ts --replay [--days 90]
//
// ===========================================================================
// ⚠️ THE TWO THINGS A PRICE FEED GETS WRONG, AND WHAT IS DONE ABOUT THEM.
//
// 1. COVERAGE MOVEMENT MASQUERADING AS A PRICE MOVEMENT. `price_grid_days` is one row per
//    (day, settlement, product), and the settlements that report move constantly — measured
//    over 95 days, the daily basket cell count swings by up to 16.75%. Summing whatever is
//    present on each day therefore prices a DIFFERENT country each day: the naive series put
//    2026-08-26 at −2.82% while the cells underneath it moved −4.60%, i.e. the „price fall"
//    was the corpus losing settlements. Every measurement here is taken over a FIXED COHORT —
//    the (settlement, product) cells priced on EVERY day of the fourteen-day span — so the
//    two windows compare the same shops on the same products and coverage cannot explain the
//    result. §6.3's „suppress an event if coverage movement could explain the price movement"
//    is satisfied by construction rather than by a second guard that could be tuned away.
//
// 2. ONE EPISODE REPORTED EVERY DAY IT PERSISTS. A trend crosses the threshold on each of
//    several consecutive days; emitted per day it is the same news six times, and it fills
//    the feed. Crossings are collapsed into RUNS of consecutive same-sign days, one event per
//    run, dated at the run's strongest day.
//
// ⚠️ AND A PROMOTION IS NEVER READ OFF ONE LOW OBSERVATION. `price_product_days.min_promo_eur`
// is a per-day MINIMUM, which is exactly the single cheap listing §6.3 forbids. The
// corroboration therefore comes from `price_current` — the same chain-deduped gate the
// /consumption deals board ships (≥3 store listings, ≥2 distinct chains, not a low outlier,
// measured against the chain-deduped baseline regular) — and only the START DATE is read from
// the daily history. Both halves are required: the gate without the history is a state rather
// than an event, and the history without the gate is a rumour.
// ===========================================================================
//
// Plan: docs/plans/home-dashboard-implementation-v1.md §6.2/§6.3.
// Replay: docs/audits/home-price-threshold-replay-2026-09-01.md.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import {
  missingRelations,
  isEmpty,
  warnSkip,
} from "../gen_procurement/preflight";
import {
  MAX_DISC,
  MIN_PROMO_CHAINS,
  MIN_PROMO_EUR,
  MIN_PROMO_STORES,
  PROMO_OUTLIER_FLOOR,
} from "../../prices/promoGate";
import type {
  PriceBasketMove,
  PriceEventsV1,
  PricePromotion,
} from "./events/priceSource";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const OUT = path.join(ROOT, "data/home/price_events.json");

/**
 * ⚠️ THE SAME TWELVE PRODUCTS AS `COMMON_BASKET` in `scripts/prices/build_payloads.ts`, and
 * they must stay the same. That list is what the município ranking and the „who is cheapest
 * where" map are built on, so a home-page sentence about „the basket" measured over a
 * different set would contradict the page it links to. `home_price_events.data.test.ts` reads
 * the other file and fails on any divergence.
 */
export const BASKET_PIDS = [1, 6, 9, 11, 35, 38, 40, 42, 52, 54, 55, 61];

/** Trailing week against the week before it. The span is therefore 14 days. */
export const BASKET_WINDOW_DAYS = 7;
export const BASKET_SPAN_DAYS = BASKET_WINDOW_DAYS * 2;

/**
 * ⚠️ 1.5%, AND THE NUMBER IS THE OUTPUT OF THE REPLAY RATHER THAN AN OPINION — re-check it
 * with `npx tsx scripts/db/gen_home/price_events.ts --replay --days 90`. Over the 92 measurable
 * days to 2026-08-31 the fixed-cohort series crosses ±1.5% on 18 days that form FOUR runs — one
 * episode roughly every three weeks, none of them split. At ±1.0% it is five runs but two of
 * them merge distinct episodes; at ±2.0% it is THREE, and one of those is a single August
 * episode reported twice (2026-08-15..17 and 2026-08-19..20) — the failure mode this whole file
 * is about. Raising it further silences the corpus: the largest move in three months is 3.28%.
 */
export const BASKET_MOVE_PCT = 1.5;

/** A cohort thinner than this is a claim about a handful of shops, not about the country.
 *  ~50 settlements × the twelve products; the measured floor over the 92 days was 1,704. */
export const MIN_COHORT_CELLS = 600;
/** …and it must be most of what was priced, or the survivors are a biased remnant. */
export const MIN_COHORT_SHARE = 0.6;

/**
 * The corroboration half of the gate is IMPORTED from `scripts/prices/promoGate.ts` — the one
 * definition the /consumption deals board ships — so „a promotion the home page calls
 * corroborated is one the deals board would also show" holds by construction rather than by a
 * test comparing two copies. It used to be a verbatim restatement here, and the copy the test
 * did NOT compare (`PROMO_OUTLIER_FLOOR`) is exactly where the price and the date were found to
 * be measured over different populations.
 *
 * Only the discount BAND is ours, and the floor is deliberately higher than the board's
 * `MIN_DISC`: 15% off is a deal (279 were live on 2026-08-31, 89 of them at ≥30%) and 30% off is
 * news. The ceiling is the board's own — above it, empirically, a source error.
 */
export const PROMO_MIN_DISCOUNT_PCT = 30;
export const PROMO_MAX_DISCOUNT_PCT = MAX_DISC * 100;
/** A price level that has held for months is not „what changed". */
export const PROMO_START_WINDOW_DAYS = 30;
/**
 * How far back the basket series is measured.
 *
 * ⚠️ ITS OWN CONSTANT even though it equals `PROMO_START_WINDOW_DAYS` today. They are different
 * quantities that share a value because both track `feed.ts`'s `WINDOW_DAYS` — the feed renders
 * 30 days, so measuring further back only produces rows it drops. Driving this from the
 * promotion constant (which it did) means narrowing the promotion window silently shortens the
 * basket series and loses episodes.
 */
export const MEASURE_WINDOW_DAYS = 30;

/** How far ABOVE the published price a past day's minimum may sit and still count as „at or
 *  below this level" — headroom for rounding and a one-cent regional difference, nothing more.
 *  A day whose minimum is LOWER always qualifies: something was cheaper, which does not make
 *  this level absent. */
export const PROMO_LEVEL_TOLERANCE = 0.02;
/** At most this many, best discount first: the feed renders two price rows at the very most. */
export const PROMO_MAX_EVENTS = 3;

/**
 * EVERY rule the measurements are taken under, in one object, written verbatim into the
 * artifact.
 *
 * ⚠️ ONE OBJECT RATHER THAN A HAND-BUILT LITERAL AT THE WRITE SITE. That literal enumerated a
 * SUBSET — it omitted the level tolerance, the promotion cap and the two inherited gate
 * constants — while `priceSource.ts` documented the field as „every threshold" and the audit
 * said „all seven are stored in the artifact". A reader of a future rebuild uses this to tell a
 * rule change from a corpus change, and a subset makes that impossible for exactly the rules
 * most likely to be tuned.
 */
export const THRESHOLDS = {
  basketPids: BASKET_PIDS,
  basketWindowDays: BASKET_WINDOW_DAYS,
  basketMovePct: BASKET_MOVE_PCT,
  minCohortCells: MIN_COHORT_CELLS,
  minCohortShare: MIN_COHORT_SHARE,
  measureWindowDays: MEASURE_WINDOW_DAYS,
  promoMinDiscountPct: PROMO_MIN_DISCOUNT_PCT,
  promoMaxDiscountPct: PROMO_MAX_DISCOUNT_PCT,
  promoMinStores: MIN_PROMO_STORES,
  promoMinChains: MIN_PROMO_CHAINS,
  promoOutlierFloor: PROMO_OUTLIER_FLOOR,
  promoMinEur: MIN_PROMO_EUR,
  promoLevelTolerance: PROMO_LEVEL_TOLERANCE,
  promoStartWindowDays: PROMO_START_WINDOW_DAYS,
  promoMaxEvents: PROMO_MAX_EVENTS,
} as const;

const round = (n: number, dp: number): number =>
  Math.round(n * 10 ** dp) / 10 ** dp;

// ---------------------------------------------------------------------------
// the basket series
// ---------------------------------------------------------------------------

export interface BasketPoint {
  day: string;
  pctChange: number;
  costEur: number;
  prevCostEur: number;
  cohortCells: number;
  cohortShare: number;
}

/**
 * One row per anchor day: the trailing week's mean basket cost against the week before it,
 * both measured over the cells priced on every one of the fourteen days.
 *
 * ⚠️ `percentile_cont` PER (anchor, day, product) AND THEN A SUM, never a median of sums. The
 * basket is „one of each of twelve products at the typical settlement price", so the median
 * belongs inside each product and the sum across them.
 */
const basketSeries = async (limitDays: number): Promise<BasketPoint[]> => {
  const rows = await allRows<{
    day: string;
    w1: number;
    w0: number;
    cohort: number;
    dailyCells: number;
  }>(
    `WITH g AS (
       SELECT day, ekatte, pid, min_eur
         FROM price_grid_days
        WHERE pid = ANY($1::smallint[])
          AND day >= (SELECT max(day) FROM price_grid_days) - $2::int
     ),
     days AS (SELECT DISTINCT day FROM g),
     spans AS (
       SELECT d.day AS anchor FROM days d
        WHERE (SELECT count(*) FROM days x
                WHERE x.day BETWEEN d.day - ($3::int - 1) AND d.day) = $3::int
     ),
     coh AS (
       SELECT s.anchor, g.ekatte, g.pid
         FROM spans s JOIN g ON g.day BETWEEN s.anchor - ($3::int - 1) AND s.anchor
        GROUP BY s.anchor, g.ekatte, g.pid
       HAVING count(*) = $3::int
     ),
     vals AS (
       SELECT c.anchor, g.day, g.pid, g.min_eur
         FROM coh c
         JOIN g ON g.ekatte = c.ekatte AND g.pid = c.pid
                AND g.day BETWEEN c.anchor - ($3::int - 1) AND c.anchor
     ),
     permed AS (
       SELECT anchor, day, pid,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY min_eur) AS m
         FROM vals GROUP BY anchor, day, pid
     ),
     bask AS (
       SELECT anchor, day, sum(m) AS cost FROM permed
        GROUP BY anchor, day HAVING count(*) = $4::int
     ),
     daily AS (SELECT day, count(*) AS cells FROM g GROUP BY day),
     w AS (
       SELECT b.anchor,
              avg(b.cost) FILTER (WHERE b.day >  b.anchor - $5::int) AS w1,
              avg(b.cost) FILTER (WHERE b.day <= b.anchor - $5::int) AS w0,
              count(*) AS ndays
         FROM bask b GROUP BY b.anchor
     )
     SELECT w.anchor::text AS day, w.w1, w.w0,
            (SELECT count(*) FROM coh c WHERE c.anchor = w.anchor)::int AS cohort,
            (SELECT avg(d.cells) FROM daily d
              WHERE d.day BETWEEN w.anchor - ($3::int - 1) AND w.anchor) AS "dailyCells"
       FROM w
      WHERE w.ndays = $3::int AND w.w0 IS NOT NULL AND w.w0 > 0
      ORDER BY w.anchor`,
    [
      BASKET_PIDS,
      limitDays + BASKET_SPAN_DAYS,
      BASKET_SPAN_DAYS,
      BASKET_PIDS.length,
      BASKET_WINDOW_DAYS,
    ],
  );

  return rows.map((r) => ({
    day: r.day,
    pctChange: (100 * (r.w1 - r.w0)) / r.w0,
    costEur: r.w1,
    prevCostEur: r.w0,
    cohortCells: r.cohort,
    cohortShare: r.dailyCells > 0 ? r.cohort / r.dailyCells : 0,
  }));
};

/**
 * Collapse the crossing days into episodes: a maximal stretch of CONSECUTIVE days that cross
 * the threshold with the same sign is one move, dated at its strongest day.
 *
 * ⚠️ „Consecutive" is measured on the SERIES, not on the calendar. A day the corpus never
 * filed is absent from the input, and treating that gap as the end of a run would split one
 * episode in two — which is the defect the collapse exists to prevent.
 */
export const collapseRuns = (
  points: BasketPoint[],
  thresholdPct = BASKET_MOVE_PCT,
  minCells = MIN_COHORT_CELLS,
  minShare = MIN_COHORT_SHARE,
): PriceBasketMove[] => {
  const moves: PriceBasketMove[] = [];
  let run: BasketPoint[] = [];
  let sign = 0;

  const flush = (): void => {
    if (run.length === 0) return;
    const peak = run.reduce((a, b) =>
      Math.abs(b.pctChange) > Math.abs(a.pctChange) ? b : a,
    );
    moves.push({
      peakDay: peak.day,
      startDay: run[0].day,
      endDay: run[run.length - 1].day,
      pctChange: round(peak.pctChange, 3),
      costEur: round(peak.costEur, 3),
      prevCostEur: round(peak.prevCostEur, 3),
      cohortCells: peak.cohortCells,
      cohortShare: round(peak.cohortShare, 4),
    });
    run = [];
    sign = 0;
  };

  points.forEach((p) => {
    const eligible =
      Math.abs(p.pctChange) >= thresholdPct &&
      p.cohortCells >= minCells &&
      p.cohortShare >= minShare;
    const s = eligible ? Math.sign(p.pctChange) : 0;
    // ⚠️ SERIES-ADJACENCY IS STRUCTURAL, not a branch. A non-crossing day always flushes, so
    // `run` is non-empty only when the immediately preceding point was pushed — an explicit
    // `points[i - 1] === run.at(-1)` guard was here and could never fire, which made the
    // „does NOT split on a day the corpus never filed" test pass on the wrong path.
    if (s === 0 || s !== sign) flush();
    if (s !== 0) {
      run.push(p);
      sign = s;
    }
  });
  flush();
  return moves;
};

// ---------------------------------------------------------------------------
// promotions
// ---------------------------------------------------------------------------

/**
 * The corroborated live promotions whose price level appeared inside the window.
 *
 * The gate is the deals board's, imported: one regular and one promo per (product, chain) so a
 * chain padding its reference across 35 stores counts once; the discount measured against the
 * chain-deduped baseline regular rather than the store's own declared one; and a floor under
 * the promo itself so a broken near-zero listing cannot lead.
 *
 * ⚠️ THE DATE AND THE PRICE MUST DESCRIBE ONE LISTING, and the first cut of this query did not.
 * The price comes from `price_current` AFTER the outlier floor; the history in
 * `price_product_days.min_promo_eur` is the raw per-day minimum, floor and all. Anchoring the
 * walk-back on that raw minimum tracks THE EXCLUDED OUTLIER'S run, not the offer's — measured
 * on the shipped `limoni` row, which published „€1.28, since 31 August" for a level that had
 * been live since 21 August, because a €0.98 listing the price gate rejected set the day's
 * minimum. It was the artifact's highest-ranked row, on recency bought by a listing we refused
 * to quote.
 *
 * The walk-back is therefore anchored on the GATED price and asks the question this history can
 * actually answer: „since when has the cheapest promo for this product been at or below the
 * level we are publishing". That is `at_or_below_since`, and it is what the copy says. It is
 * NOT „when this promotion started" — a per-day minimum cannot establish that, and claiming it
 * does is the defect above in a different costume.
 */
const promotions = async (latest: string): Promise<PricePromotion[]> =>
  (
    await allRows<{
      slug: string;
      title: string;
      atOrBelowSince: string;
      promoEur: number;
      regularEur: number;
      discountPct: number;
      stores: number;
      chains: number;
    }>(
      `WITH chain_stats AS (
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
         SELECT product_id,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY chain_reg) AS base_reg,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY chain_promo)
                  FILTER (WHERE chain_promo IS NOT NULL) AS med_promo,
                count(*) FILTER (WHERE chain_promo IS NOT NULL) AS n_promo_chains
           FROM chain_stats GROUP BY product_id
       ),
       promo_store_n AS (
         SELECT pp.product_id, count(*) AS n_promo_stores
           FROM price_current pc
           JOIN price_skus ps ON ps.sku_id = pc.sku_id
           JOIN price_products pp ON pp.product_id = ps.product_id
          WHERE pc.promo_eur IS NOT NULL
          GROUP BY pp.product_id
       ),
       best AS (
         SELECT pp.product_id, pp.slug, pp.title, d.base_reg,
                min(pc.promo_eur) AS promo,
                max(n.n_promo_stores) AS stores, max(d.n_promo_chains) AS chains
           FROM price_current pc
           JOIN price_skus ps ON ps.sku_id = pc.sku_id
           JOIN price_products pp ON pp.product_id = ps.product_id
           JOIN prod d ON d.product_id = pp.product_id
           JOIN promo_store_n n ON n.product_id = pp.product_id
          WHERE pc.promo_eur IS NOT NULL
            AND pp.chain_count > 0
            AND pc.promo_eur >= $1::float8
            AND pc.promo_eur < d.base_reg
            AND n.n_promo_stores >= $2::int
            AND d.n_promo_chains >= $3::int
            AND pc.promo_eur >= d.med_promo * $4::float8
          GROUP BY pp.product_id, pp.slug, pp.title, d.base_reg
       ),
       scored AS (
         SELECT b.*, 100 * (b.base_reg - b.promo) / b.base_reg AS disc_pct FROM best b
       ),
       -- ⚠️ ANCHORED ON s.promo — THE GATED PRICE — NEVER ON THE DAY'S RAW MINIMUM. Those are
       -- different populations: the price passes the outlier floor, min_promo_eur is the
       -- minimum over every store including the listings that floor rejects. Anchored on the
       -- raw value the walk-back follows the OUTLIER's run: limoni published „€1.28, since 31
       -- August" because a €0.98 listing we refused to quote set that day's minimum, while the
       -- €1.28 level had been live since 21 August. It was the artifact's top-ranked row.
       --
       -- A per-day MINIMUM also cannot establish when an offer began — only that nothing was
       -- cheaper. So the question asked is the one it can answer: since when has the cheapest
       -- promo been AT OR BELOW the level we publish. Less-than-or-equal, not a band: a day
       -- whose minimum is lower still satisfies it (some other store was cheaper), a day whose
       -- minimum is higher does not (this level did not exist yet).
       runs AS (
         SELECT s.product_id,
                min(pd.day) FILTER (WHERE pd.gap = 0) AS since_day
           FROM scored s
           JOIN LATERAL (
             SELECT day,
                    (day - ($5::date - (row_number() OVER (ORDER BY day DESC) - 1)::int)) AS gap
               FROM price_product_days h
              WHERE h.product_id = s.product_id
                AND h.min_promo_eur IS NOT NULL
                AND h.min_promo_eur <= s.promo * (1 + $11::float8)
                AND h.day <= $5::date
              ORDER BY day DESC
              LIMIT $6::int
           ) pd ON TRUE
          GROUP BY s.product_id
       )
       SELECT s.slug, s.title, r.since_day::text AS "atOrBelowSince",
              round(s.promo::numeric, 2)::float8 AS "promoEur",
              round(s.base_reg::numeric, 2)::float8 AS "regularEur",
              round(s.disc_pct::numeric, 0)::int AS "discountPct",
              s.stores::int, s.chains::int
         FROM scored s JOIN runs r ON r.product_id = s.product_id
        WHERE s.disc_pct >= $7::float8 AND s.disc_pct <= $8::float8
          AND r.since_day IS NOT NULL
          AND r.since_day > $5::date - $9::int
        ORDER BY round(s.disc_pct::numeric, 0) DESC, s.slug
        LIMIT $10::int`,
      [
        MIN_PROMO_EUR,
        MIN_PROMO_STORES,
        MIN_PROMO_CHAINS,
        PROMO_OUTLIER_FLOOR,
        latest,
        PROMO_START_WINDOW_DAYS + 1,
        PROMO_MIN_DISCOUNT_PCT,
        PROMO_MAX_DISCOUNT_PCT,
        PROMO_START_WINDOW_DAYS,
        PROMO_MAX_EVENTS,
        PROMO_LEVEL_TOLERANCE,
      ],
    )
  ).map((r) => ({ ...r, atOrBelowSince: r.atOrBelowSince.slice(0, 10) }));

// ---------------------------------------------------------------------------

const replay = async (days: number): Promise<void> => {
  const points = await basketSeries(days);
  if (points.length === 0) {
    // Not „the basket held still" — there is no series at all. A corpus with fewer than
    // BASKET_SPAN_DAYS consecutive days has no anchor day, and the percentile arithmetic below
    // would read past the end of an empty array and throw a TypeError instead of saying so.
    console.log(
      `basket replay · no measurable day — the corpus holds fewer than ` +
        `${BASKET_SPAN_DAYS} consecutive days in the requested range`,
    );
    return;
  }
  const abs = points.map((p) => Math.abs(p.pctChange)).sort((a, b) => a - b);
  const pct = (q: number): number =>
    abs[Math.min(abs.length - 1, Math.floor(q * abs.length))];
  console.log(
    `basket replay · ${points.length} measurable days ` +
      `(${points[0]?.day} … ${points[points.length - 1]?.day})`,
  );
  console.log(
    `  |move| p50 ${pct(0.5).toFixed(2)}% · p75 ${pct(0.75).toFixed(2)}% · ` +
      `p90 ${pct(0.9).toFixed(2)}% · max ${abs[abs.length - 1].toFixed(2)}%`,
  );
  console.log(
    `  cohort cells ${Math.min(...points.map((p) => p.cohortCells))}…` +
      `${Math.max(...points.map((p) => p.cohortCells))} · share ` +
      `${(Math.min(...points.map((p) => p.cohortShare)) * 100).toFixed(1)}%…` +
      `${(Math.max(...points.map((p) => p.cohortShare)) * 100).toFixed(1)}%`,
  );
  for (const t of [0.75, 1.0, 1.5, 2.0, 3.0]) {
    const runs = collapseRuns(points, t);
    const crossing = points.filter((p) => Math.abs(p.pctChange) >= t).length;
    console.log(
      `  ± ${t.toFixed(2)}% → ${crossing} crossing days · ${runs.length} episodes · ` +
        `1 per ${(points.length / Math.max(runs.length, 1)).toFixed(0)} days` +
        (t === BASKET_MOVE_PCT ? "   ← shipped" : ""),
    );
    for (const r of runs)
      console.log(
        `        ${r.startDay}…${r.endDay}  peak ${r.pctChange > 0 ? "+" : ""}` +
          `${r.pctChange.toFixed(2)}% on ${r.peakDay}  (cohort ${r.cohortCells})`,
      );
  }
};

const run = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const missing = await missingRelations([
    "price_grid_days",
    "price_current",
    "price_product_days",
    "price_products",
    "price_skus",
    "price_stores",
  ]);
  if (missing.length > 0 || (await isEmpty("price_grid_days"))) {
    // ⚠️ SKIP, NEVER WRITE. The artifact is committed, so an empty rebuild on a machine with
    // no price corpus would REPLACE good measurements with none and the feed would quietly
    // lose its price rows — worse than the file simply staying as it is.
    warnSkip(
      "db:gen-home-price-events",
      missing.length > 0
        ? `missing relation(s): ${missing.join(", ")}`
        : "price_grid_days is empty",
      "run the prices ingest (npm run prices:ingest) against this database first",
    );
    return;
  }

  if (argv.includes("--replay")) {
    const i = argv.indexOf("--days");
    const days = i >= 0 ? Number(argv[i + 1]) : 90;
    // `Number(undefined)` is NaN, and NaN reaches Postgres as the literal „NaN" — a 22P02 that
    // names the type rather than the flag. Refuse where the mistake was made.
    if (!Number.isInteger(days) || days < 1)
      throw new Error(
        `--days needs a positive integer, got ${argv[i + 1] ?? "(nothing)"}`,
      );
    await replay(days);
    return;
  }

  const [{ latest }] = await allRows<{ latest: string }>(
    "SELECT max(day)::text AS latest FROM price_grid_days",
  );
  const day = latest.slice(0, 10);

  // The window the FEED renders is 30 days, so measuring further back only produces rows it
  // will drop. The span is added because the first BASKET_SPAN_DAYS days of any series have
  // no predecessor window.
  const points = await basketSeries(MEASURE_WINDOW_DAYS);
  const out: PriceEventsV1 = {
    schemaVersion: 1,
    computedAt: day,
    thresholds: THRESHOLDS,
    basketMoves: collapseRuns(points),
    promotions: await promotions(day),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const body = JSON.stringify(out, null, 2) + "\n";
  const tmp = `${OUT}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, OUT);
  console.log(
    `home_price_events: ${out.basketMoves.length} basket move(s) · ` +
      `${out.promotions.length} promotion(s) · computedAt=${day} · ` +
      `${Buffer.byteLength(body)} bytes`,
  );
};

if (process.argv[1] && process.argv[1].includes("gen_home/price_events")) {
  run()
    .then(() => end())
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}

export { run, basketSeries, promotions };
