// Aggregate the per-day grids (data/prices/_cache/daily/*.json) into the
// shipped artifacts under data/prices/:
//   index.json                  national + per-oblast + per-category Jevons
//                               price index since the euro, + dictionary
//   settlement/<ekatte>.json    per-place snapshot (min/avg/max + cheapest chain)
//   ranking.json                per-place basket level + index, ranked across
//                               national / size-class / oblast peer groups
//   chains.json + chains/<muni> chain comparison (intersection-basket fairness)
//
// See docs/plans/prices_kolkostruva_design.md. NOT official CPI — a monitoring
// basket index (unweighted Jevons of median-of-per-settlement-minimum prices).

import fs from "node:fs";
import path from "node:path";
import { resolvePlace } from "./lib/locations";
import type { DailyGrid, ProductDict, PopBand, PlaceLoc } from "./types";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const CACHE_DIR = path.join(ROOT, "data/prices/_cache/daily");
const OUT_DIR = path.join(ROOT, "data/prices");

const products: ProductDict = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts/prices/products.json"), "utf8"),
);
const municipalities: { obshtina: string; name: string; name_en: string }[] =
  JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/municipalities.json"), "utf8"),
  );
const regions: { oblast: string; name: string; name_en: string }[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/data/json/regions.json"), "utf8"),
);
const muniName = new Map(municipalities.map((m) => [m.obshtina, m.name]));
const oblastName = new Map(regions.map((r) => [r.oblast, r.name]));

const ALL_PIDS = products.products.map((p) => p.id);
const PIDS_BY_CAT = new Map<number, number[]>();
for (const p of products.products) {
  const arr = PIDS_BY_CAT.get(p.cat) ?? [];
  arr.push(p.id);
  PIDS_BY_CAT.set(p.cat, arr);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Matched-model Jevons index (100-based) of `now` vs `base` over `pids`. */
const jevons = (
  now: Map<number, number>,
  base: Map<number, number>,
  pids: number[],
): number | null => {
  let sum = 0;
  let n = 0;
  for (const g of pids) {
    const pd = now.get(g);
    const pb = base.get(g);
    if (pd && pb && pd > 0 && pb > 0) {
      sum += Math.log(pd / pb);
      n++;
    }
  }
  return n ? 100 * Math.exp(sum / n) : null;
};

interface LoadedDay {
  date: string;
  // ekatte -> pid -> settlement MIN price (cheapest store) — for "cheapest" level
  settMin: Map<string, Map<number, number>>;
  // ekatte -> pid -> settlement MEDIAN price (typical store) — for the index.
  // The index uses median, not min: a single cheap/expensive store swings the
  // min and makes per-settlement trends noisy (e.g. one wine outlier → +137%).
  settMed: Map<string, Map<number, number>>;
  grid: DailyGrid;
}

const loadDays = (): LoadedDay[] => {
  const files = fs
    .readdirSync(CACHE_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  return files.map((f) => {
    const grid: DailyGrid = JSON.parse(
      fs.readFileSync(path.join(CACHE_DIR, f), "utf8"),
    );
    const settMin = new Map<string, Map<number, number>>();
    const settMed = new Map<string, Map<number, number>>();
    for (const [ek, byProd] of Object.entries(grid.cells)) {
      const mn = new Map<number, number>();
      const md = new Map<number, number>();
      for (const [pid, agg] of Object.entries(byProd)) {
        mn.set(+pid, agg.min);
        md.set(+pid, agg.median);
      }
      settMin.set(ek, mn);
      settMed.set(ek, md);
    }
    return { date: grid.date, settMin, settMed, grid };
  });
};

// Representative price (median of per-settlement minimums) over a set of
// settlements, per product, for one day.
const repPrices = (
  settMin: Map<string, Map<number, number>>,
  ekattes: string[],
): Map<number, number> => {
  const byPid = new Map<number, number[]>();
  for (const ek of ekattes) {
    const m = settMin.get(ek);
    if (!m) continue;
    for (const [pid, v] of m) {
      const arr = byPid.get(pid) ?? [];
      arr.push(v);
      byPid.set(pid, arr);
    }
  }
  const out = new Map<number, number>();
  for (const [pid, arr] of byPid) out.set(pid, median(arr));
  return out;
};

export const buildPriceIndex = (): void => {
  const days = loadDays();
  if (days.length === 0) {
    throw new Error(
      "no daily grids in data/prices/_cache/daily — run ingest first",
    );
  }
  const dates = days.map((d) => d.date);
  const baselineDate = dates[0];
  const latestDate = dates[dates.length - 1];
  const latest = days[days.length - 1];
  const baseline = days[0];
  // Fixed reference panel: settlements present on the baseline (euro) day. All
  // index + since-euro leaderboards use only panel settlements, so the series
  // tracks the same markets over time rather than drifting as the feed's
  // settlement coverage changes. Non-panel places still get their own page.
  const panel = new Set(baseline.settMed.keys());
  const inPanel = (eks: string[]) => eks.filter((ek) => panel.has(ek));
  // index of the day ~30 days before latest (for change30d)
  const latestMs = Date.parse(latestDate);
  let day30 = baseline;
  for (const d of days) {
    if (latestMs - Date.parse(d.date) >= 30 * 86400_000) day30 = d;
  }

  // ── geography: which settlements belong to each oblast / muni ──
  const allEkattes = new Set<string>();
  for (const d of days) for (const ek of d.settMin.keys()) allEkattes.add(ek);
  const place = new Map<string, PlaceLoc>();
  for (const ek of allEkattes) {
    const p = resolvePlace(ek);
    if (p) place.set(ek, p);
  }
  const oblastSetts = new Map<string, string[]>();
  const muniSetts = new Map<string, string[]>();
  for (const [ek, p] of place) {
    (
      oblastSetts.get(p.oblast) ?? oblastSetts.set(p.oblast, []).get(p.oblast)!
    ).push(ek);
    (
      muniSetts.get(p.obshtina) ??
      muniSetts.set(p.obshtina, []).get(p.obshtina)!
    ).push(ek);
  }

  const allEk = [...allEkattes];
  // Precompute national + per-oblast representative prices per day (from the
  // MEDIAN price — see settMed note above).
  const repNat: Map<number, number>[] = days.map((d) =>
    repPrices(d.settMed, inPanel(allEk)),
  );
  const repObl = new Map<string, Map<number, number>[]>();
  for (const [obl, eks] of oblastSetts)
    repObl.set(
      obl,
      days.map((d) => repPrices(d.settMed, inPanel(eks))),
    );

  // ── index.json ──
  const natSeries = days.map((_, i) => ({
    d: dates[i],
    v: r1(jevons(repNat[i], repNat[0], ALL_PIDS) ?? 100),
  }));
  const byCategory: Record<number, { d: string; v: number }[]> = {};
  for (const cat of products.categories) {
    const pids = PIDS_BY_CAT.get(cat.id) ?? [];
    byCategory[cat.id] = days.map((_, i) => ({
      d: dates[i],
      v: r1(jevons(repNat[i], repNat[0], pids) ?? 100),
    }));
  }
  const promoShare = days.map((d, i) => {
    let cells = 0;
    let promo = 0;
    for (const byProd of Object.values(d.grid.cells))
      for (const agg of Object.values(byProd)) {
        cells++;
        if (agg.promoMin != null) promo++;
      }
    return { d: dates[i], v: cells ? r3(promo / cells) : 0 };
  });
  const regionsOut: Record<
    string,
    { name: string; index: { d: string; v: number }[] }
  > = {};
  for (const [obl, series] of repObl) {
    regionsOut[obl] = {
      name: oblastName.get(obl) ?? obl,
      index: days.map((_, i) => ({
        d: dates[i],
        v: r1(jevons(series[i], series[0], ALL_PIDS) ?? 100),
      })),
    };
  }

  const indexJson = {
    source: {
      name: "КЗП — Колко струва",
      nameEn: "CPC — How Much Does It Cost",
      url: "https://kolkostruva.bg/opendata",
    },
    fetchedAt: new Date(latestMs).toISOString(),
    firstDate: baselineDate,
    latestDate,
    baseline: baselineDate,
    note: "Monitoring basket index (unweighted Jevons of median-of-per-settlement-minimum prices). NOT official CPI/HICP.",
    coverage: {
      settlements: latest.settMin.size,
      chains: latest.grid.stats.chains,
      rows: latest.grid.stats.rows,
    },
    categories: products.categories,
    products: products.products,
    national: { index: natSeries, byCategory, promoShare },
    regions: regionsOut,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(indexJson));

  // ── core grocery basket for cross-place comparison ──
  // The products present in ~all settlements are non-food packaged goods (tea,
  // water, toothpaste) — a poor "cost of groceries" proxy. So we fix a curated
  // staple food basket (each ≥82% present). Places not pricing the full core
  // are tiny outlets and get rank=null; their index/change still compute.
  const commonBasket = [1, 6, 9, 11, 35, 38, 40, 42, 52, 54, 55, 61].filter(
    (g) => ALL_PIDS.includes(g),
  );

  // ── outlier guard for basket-level comparison ──
  // Several КЗП basket items — notably the two cheeses (сирене id 9, кашкавал
  // id 11) — span a 200 g–1 kg pack range, so a shop selling only a 1 kg pack /
  // by the kilo reports ~5× a small-pack shop. In a single-store village that
  // lone reading becomes the settlement "minimum" with nothing cheaper to offset
  // it, and a cluster of such villages then drags the oblast/muni
  // median-of-minimums (КООП's flat 12.78 €/kg kashkaval, replicated across 7 of
  // Ruse oblast's 11 panel settlements, doubled its basket to ~30 € — twice any
  // other oblast). Treat any per-settlement minimum above 3× the national median
  // of per-settlement minimums for that product as not a comparable basket
  // observation and skip it. The 10 well-behaved staples never trip this (their
  // national max is < 3× the median); only the pack-ambiguous cheeses are
  // guarded. Effect: a settlement whose only cheese is sold by the kilo drops
  // out of the basket leaderboard (nPriced < core size → unranked) instead of
  // registering a spurious ~30 € basket, and the regional/chain rollups reflect
  // real small-pack markets. The per-product min/avg/max shown on each place
  // page (and the Jevons index, which uses price ratios that cancel pack size)
  // are untouched — this guards only the absolute basket-level sum.
  const BASKET_OUTLIER_MULT = 3;
  const basketCap = new Map<number, number>();
  for (const g of commonBasket) {
    const mins: number[] = [];
    for (const m of latest.settMin.values()) {
      const v = m.get(g);
      if (v != null && v > 0) mins.push(v);
    }
    if (mins.length) basketCap.set(g, BASKET_OUTLIER_MULT * median(mins));
  }
  const withinBasketCap = (g: number, v: number): boolean => {
    const c = basketCap.get(g);
    return c == null || v <= c;
  };

  // Sample dates for the settlement sparkline: all days when the series is
  // short, else weekly (every 7th, keeping first + last). Once the full
  // contiguous backfill lands the weekly stride lines up with calendar weeks.
  const allIdx = days.map((_, i) => i);
  const weeklyIdx =
    days.length <= 60
      ? allIdx
      : allIdx.filter((i) => i === 0 || i === days.length - 1 || i % 7 === 0);

  // ── settlement/<ekatte>.json ──
  // Built into memory first; the per-place `rank` block is attached after
  // ranks are computed, then written — so the place dashboard can read its
  // rank from its own shard and never load the 128 KB ranking.json.
  const settDir = path.join(OUT_DIR, "settlement");
  fs.rmSync(settDir, { recursive: true, force: true });
  fs.mkdirSync(settDir, { recursive: true });
  const settJsonByEk = new Map<string, Record<string, unknown>>();

  // per-place rank inputs accumulate here for ranking.json
  interface RankRow {
    code: string;
    tier: "settlement" | "muni" | "oblast";
    name: string;
    muni?: string;
    oblast: string;
    basketLevel: number | null;
    nPriced: number;
    indexSinceEuro: number;
    change30d: number;
    popBand: PopBand | null;
    sinceEuro: boolean; // present on euro day → eligible for since-euro board
  }
  const rankRows: RankRow[] = [];

  const firstSeen = new Map<string, number>(); // ekatte -> day index first present
  for (let i = 0; i < days.length; i++)
    for (const ek of days[i].settMin.keys())
      if (!firstSeen.has(ek)) firstSeen.set(ek, i);

  for (const ek of latest.settMin.keys()) {
    const p = place.get(ek)!;
    const cell = latest.grid.cells[ek];
    const baseIdx = firstSeen.get(ek) ?? 0;
    const nowMin = latest.settMin.get(ek)!; // cheapest-store prices (for basket level)
    // index/movers use median (typical) prices to avoid single-store noise
    const baseMed = days[baseIdx].settMed.get(ek) ?? new Map();
    const nowMed = latest.settMed.get(ek) ?? new Map();
    const med30 = day30.settMed.get(ek) ?? baseMed;
    const idxNow = jevons(nowMed, baseMed, ALL_PIDS) ?? 100;
    const idx30 = jevons(nowMed, med30, ALL_PIDS) ?? 100;

    const productsOut = Object.entries(cell)
      .map(([pid, agg]) => ({
        id: +pid,
        min: r2(agg.min),
        avg: r2(agg.avg),
        max: r2(agg.max),
        median: r2(agg.median),
        cheapestEik: agg.cheapestEik,
        cheapestChain: latest.grid.chainNames[agg.cheapestEik] ?? "",
        stores: agg.stores,
        promoMin: agg.promoMin == null ? null : r2(agg.promoMin),
      }))
      .sort((a, b) => a.id - b.id);

    // per-category change since euro
    const byCat = products.categories
      .map((c) => {
        const pids = PIDS_BY_CAT.get(c.id) ?? [];
        const v = jevons(nowMed, baseMed, pids);
        const v30 = jevons(nowMed, med30, pids);
        return v == null
          ? null
          : {
              id: c.id,
              changeSinceEuro: r3(v / 100 - 1),
              change30d: v30 == null ? 0 : r3(v30 / 100 - 1),
            };
      })
      .filter(Boolean);

    // per-product movers since euro (median price)
    const movers = ALL_PIDS.map((g) => {
      const pn = nowMed.get(g);
      const pb = baseMed.get(g);
      if (!pn || !pb) return null;
      return { id: g, change: r3(pn / pb - 1) };
    })
      .filter((x): x is { id: number; change: number } => !!x)
      .sort((a, b) => b.change - a.change);

    const basketSeriesWeekly = weeklyIdx
      .filter((i) => i >= baseIdx)
      .map((i) => ({
        d: dates[i],
        v: r1(
          jevons(days[i].settMed.get(ek) ?? new Map(), baseMed, ALL_PIDS) ??
            100,
        ),
      }));

    const settJson = {
      ekatte: ek,
      name: p.name,
      nameEn: p.nameEn,
      obshtina: p.obshtina,
      oblast: p.oblast,
      latestDate,
      baselineDate: dates[baseIdx],
      basketChangeSinceEuro: r3(idxNow / 100 - 1),
      basketChange30d: r3(idx30 / 100 - 1),
      basketSeriesWeekly,
      byCategory: byCat,
      topMovers: { up: movers.slice(0, 5), down: movers.slice(-5).reverse() },
      products: productsOut,
    };
    settJsonByEk.set(ek, settJson);

    // basket level over common basket (per-kg pack outliers excluded — see note)
    let basketLevel: number | null = 0;
    let nPriced = 0;
    for (const g of commonBasket) {
      const v = nowMin.get(g);
      if (v != null && withinBasketCap(g, v)) {
        basketLevel += v;
        nPriced++;
      }
    }
    if (nPriced < commonBasket.length) basketLevel = null;
    rankRows.push({
      code: ek,
      tier: "settlement",
      name: p.name,
      muni: p.obshtina,
      oblast: p.oblast,
      basketLevel: basketLevel == null ? null : r2(basketLevel),
      nPriced,
      indexSinceEuro: r1(idxNow),
      change30d: r3(idx30 / 100 - 1),
      popBand: p.popBand,
      sinceEuro: panel.has(ek),
    });
  }

  // ── muni + oblast rank rows ──
  const addAggregateRow = (
    code: string,
    tier: "muni" | "oblast",
    name: string,
    oblast: string,
    allEks: string[],
  ) => {
    const eks = inPanel(allEks); // fixed panel for since-euro comparability
    const idxNow =
      jevons(
        repPrices(latest.settMed, eks),
        repPrices(baseline.settMed, eks),
        ALL_PIDS,
      ) ?? 100;
    const idx30 =
      jevons(
        repPrices(latest.settMed, eks),
        repPrices(day30.settMed, eks),
        ALL_PIDS,
      ) ?? 100;
    // representative cheapest level: median over panel settlements of each
    // settlement's minimum, excluding per-kg pack outliers (see note above) so a
    // cluster of single-store villages can't pin the regional median to one
    // chain's by-the-kilo cheese.
    let basketLevel: number | null = 0;
    let nPriced = 0;
    for (const g of commonBasket) {
      const vals: number[] = [];
      for (const ek of eks) {
        const v = latest.settMin.get(ek)?.get(g);
        if (v != null && withinBasketCap(g, v)) vals.push(v);
      }
      if (vals.length) {
        basketLevel += median(vals);
        nPriced++;
      }
    }
    if (nPriced < commonBasket.length) basketLevel = null;
    rankRows.push({
      code,
      tier,
      name,
      oblast,
      basketLevel: basketLevel == null ? null : r2(basketLevel),
      nPriced,
      indexSinceEuro: r1(idxNow),
      change30d: r3(idx30 / 100 - 1),
      popBand: null,
      sinceEuro: true,
    });
  };
  for (const [obl, eks] of oblastSetts)
    addAggregateRow(obl, "oblast", oblastName.get(obl) ?? obl, obl, eks);
  for (const [obsht, eks] of muniSetts)
    addAggregateRow(
      obsht,
      "muni",
      // Sofia's synthetic obshtina (SOF46) isn't in municipalities.json, so give
      // the city aggregate its real name rather than the raw code.
      obsht === "SOF46" ? "София" : (muniName.get(obsht) ?? obsht),
      place.get(eks[0])!.oblast,
      eks,
    );

  // ── assign ranks within peer groups ──
  const assignRanks = (
    rows: RankRow[],
    groupKey: (r: RankRow) => string | null,
  ): {
    rank: Map<string, number>;
    rankChange: Map<string, number>;
    peers: Map<string, number>;
  } => {
    const groups = new Map<string, RankRow[]>();
    for (const r of rows) {
      const k = groupKey(r);
      if (k == null) continue;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
    }
    const rank = new Map<string, number>();
    const rankChange = new Map<string, number>();
    const peers = new Map<string, number>();
    for (const g of groups.values()) {
      // Only rank real-market places (those pricing the full core basket) — keeps
      // sparse-data villages out of both the cheapest and the rose-most boards.
      const lvl = g.filter((r) => r.basketLevel != null);
      const cheapest = [...lvl].sort((a, b) => a.basketLevel! - b.basketLevel!);
      cheapest.forEach((r, i) => rank.set(r.code, i + 1));
      // since-euro board: only places present on euro day (genuine comparison)
      const chg = lvl
        .filter((r) => r.sinceEuro)
        .sort((a, b) => b.indexSinceEuro - a.indexSinceEuro);
      chg.forEach((r, i) => rankChange.set(r.code, i + 1));
      for (const r of lvl) peers.set(r.code, lvl.length);
    }
    return { rank, rankChange, peers };
  };

  const settRows = rankRows.filter((r) => r.tier === "settlement");
  const muniRows = rankRows.filter((r) => r.tier === "muni");
  const oblRows = rankRows.filter((r) => r.tier === "oblast");

  const natSett = assignRanks(settRows, () => "ALL");
  const sizeSett = assignRanks(settRows, (r) => r.popBand);
  const oblSett = assignRanks(settRows, (r) => r.oblast);
  const natMuni = assignRanks(muniRows, () => "ALL");
  const oblMuni = assignRanks(muniRows, (r) => r.oblast);
  const natObl = assignRanks(oblRows, () => "ALL");

  const places = rankRows.map((r) => {
    const pick = (
      g: ReturnType<typeof assignRanks>,
      m: "rank" | "rankChange" | "peers",
    ) => g[m].get(r.code) ?? null;
    const out: Record<string, unknown> = {
      code: r.code,
      tier: r.tier,
      name: r.name,
      oblast: r.oblast,
      basketLevel: r.basketLevel,
      nPriced: r.nPriced,
      indexSinceEuro: r.indexSinceEuro,
      change30d: r.change30d,
    };
    if (r.muni) out.muni = r.muni;
    if (r.popBand) out.popBand = r.popBand;
    if (r.tier === "settlement") {
      out.rank = {
        national: pick(natSett, "rank"),
        sizeClass: pick(sizeSett, "rank"),
        oblast: pick(oblSett, "rank"),
      };
      out.rankChange = {
        national: pick(natSett, "rankChange"),
        sizeClass: pick(sizeSett, "rankChange"),
        oblast: pick(oblSett, "rankChange"),
      };
      out.peers = {
        national: pick(natSett, "peers"),
        sizeClass: pick(sizeSett, "peers"),
        oblast: pick(oblSett, "peers"),
      };
    } else if (r.tier === "muni") {
      out.rank = {
        national: pick(natMuni, "rank"),
        oblast: pick(oblMuni, "rank"),
      };
      out.rankChange = {
        national: pick(natMuni, "rankChange"),
        oblast: pick(oblMuni, "rankChange"),
      };
      out.peers = {
        national: pick(natMuni, "peers"),
        oblast: pick(oblMuni, "peers"),
      };
    } else {
      out.rank = { national: pick(natObl, "rank") };
      out.rankChange = { national: pick(natObl, "rankChange") };
      out.peers = { national: pick(natObl, "peers") };
    }
    return out;
  });

  // per-place rank summary, keyed by code — embedded into each shard so place
  // dashboards read their rank from their own (already-loaded) shard instead of
  // pulling the full 128 KB ranking.json (only the governance leaderboards do).
  const rankByCode = new Map<string, Record<string, unknown>>();
  for (const p of places) {
    rankByCode.set(p.code as string, {
      basketLevel: p.basketLevel,
      nPriced: p.nPriced,
      indexSinceEuro: p.indexSinceEuro,
      change30d: p.change30d,
      popBand: p.popBand ?? null,
      rank: p.rank,
      rankChange: p.rankChange,
      peers: p.peers,
    });
  }

  // Write settlement shards now (with their own rank embedded).
  for (const [ek, json] of settJsonByEk) {
    json.rank = rankByCode.get(ek) ?? null;
    fs.writeFileSync(path.join(settDir, `${ek}.json`), JSON.stringify(json));
  }

  // dict.json — the small product/category dictionary + meta (no series), so a
  // place page resolves product names without the heavy index.json.
  fs.writeFileSync(
    path.join(OUT_DIR, "dict.json"),
    JSON.stringify({
      source: indexJson.source,
      fetchedAt: indexJson.fetchedAt,
      firstDate: baselineDate,
      latestDate,
      baseline: baselineDate,
      coverage: indexJson.coverage,
      categories: products.categories,
      products: products.products,
      commonBasket,
      commonBasketSize: commonBasket.length,
    }),
  );

  fs.writeFileSync(
    path.join(OUT_DIR, "ranking.json"),
    JSON.stringify({
      latestDate,
      baseline: baselineDate,
      commonBasket,
      commonBasketSize: commonBasket.length,
      places,
    }),
  );

  // ── chains.json (national) + chains/<muni>.json ──
  buildChains(latest, commonBasket, muniSetts, rankByCode, basketCap);

  console.log(
    `[prices] built index.json (${dates.length} days ${baselineDate}…${latestDate}), ` +
      `${settRows.length} settlement files, ranking.json (${places.length} places), ` +
      `commonBasket=${commonBasket.length} products`,
  );
};

// Chain comparison: score each chain on the intersection of the common basket
// it actually prices (show coverage), never raw totals across unequal baskets.
function buildChains(
  latest: LoadedDay,
  commonBasket: number[],
  muniSetts: Map<string, string[]>,
  rankByCode: Map<string, Record<string, unknown>>,
  basketCap: Map<number, number>,
): void {
  const chainNames = latest.grid.chainNames;
  // national: eik -> pid -> median over settlements of that chain's min
  const natChainPid = new Map<string, Map<number, number[]>>();
  for (const byEik of Object.values(latest.grid.chainCells)) {
    for (const [eik, byPid] of Object.entries(byEik)) {
      const m = natChainPid.get(eik) ?? new Map<number, number[]>();
      for (const [pid, v] of Object.entries(byPid)) {
        const arr = m.get(+pid) ?? [];
        arr.push(v);
        m.set(+pid, arr);
      }
      natChainPid.set(eik, m);
    }
  }
  // median + r2 reuse the module-level helpers (no local shadows)
  const chainBasket = (m: Map<number, number[]>) => {
    let total = 0;
    let nPriced = 0;
    for (const g of commonBasket) {
      const cap = basketCap.get(g);
      const arr = m.get(g)?.filter((v) => cap == null || v <= cap);
      if (arr && arr.length) {
        const v = median(arr);
        total += v;
        nPriced++;
      }
    }
    return { basket: r2(total), nPriced };
  };
  const national = [...natChainPid.entries()]
    .map(([eik, m]) => {
      const { basket, nPriced } = chainBasket(m);
      return {
        eik,
        chain: chainNames[eik] ?? eik,
        basket,
        nPriced,
        products: m.size,
      };
    })
    .filter((c) => c.nPriced >= 0.5 * commonBasket.length)
    .sort((a, b) => a.basket - b.basket);

  fs.writeFileSync(
    path.join(OUT_DIR, "chains.json"),
    JSON.stringify({
      latestDate: latest.date,
      commonBasketSize: commonBasket.length,
      note: "Chains scored on the common basket they price (nPriced of commonBasketSize). Compare like-with-like.",
      national,
    }),
  );

  // per-muni
  const chainsDir = path.join(OUT_DIR, "chains");
  fs.rmSync(chainsDir, { recursive: true, force: true });
  fs.mkdirSync(chainsDir, { recursive: true });
  for (const [obsht, eks] of muniSetts) {
    const muniChainPid = new Map<string, Map<number, number[]>>();
    for (const ek of eks) {
      const byEik = latest.grid.chainCells[ek];
      if (!byEik) continue;
      for (const [eik, byPid] of Object.entries(byEik)) {
        const m = muniChainPid.get(eik) ?? new Map<number, number[]>();
        for (const [pid, v] of Object.entries(byPid)) {
          const arr = m.get(+pid) ?? [];
          arr.push(v);
          m.set(+pid, arr);
        }
        muniChainPid.set(eik, m);
      }
    }
    const chains = [...muniChainPid.entries()]
      .map(([eik, m]) => {
        const { basket, nPriced } = chainBasket(m);
        return { eik, chain: chainNames[eik] ?? eik, basket, nPriced };
      })
      // Fairness: only rank chains pricing ≥half the core basket, so a kiosk
      // pricing 3 staples can't masquerade as "cheapest". nPriced is shipped
      // so the UI shows coverage.
      .filter((c) => c.nPriced >= 0.5 * commonBasket.length)
      .sort((a, b) => a.basket - b.basket);
    // Write a município shard whenever the muni has chains OR a rank row, so the
    // place dashboard can read its muni rank + chains from one small file.
    const rank = rankByCode.get(obsht) ?? null;
    if (chains.length || rank)
      fs.writeFileSync(
        path.join(chainsDir, `${obsht}.json`),
        JSON.stringify({
          obshtina: obsht,
          latestDate: latest.date,
          coreBasketSize: commonBasket.length,
          rank,
          chains,
        }),
      );
  }
}

if (process.argv[1] && /build_index\.ts$/.test(process.argv[1])) {
  buildPriceIndex();
}
