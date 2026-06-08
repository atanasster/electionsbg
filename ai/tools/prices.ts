// КЗП "Колко струва" retail-price tools (euro-adoption monitoring feed).
// All read data/prices/* (served via the data bucket). The basket index is a
// MONITORING index, not official CPI — every envelope says so, and the LLM only
// narrates facts. See docs/plans/prices_kolkostruva_design.md.

import { fetchData } from "./dataClient";
import { resolveSettlement, resolveMunicipality, OBLASTS } from "./place";
import {
  settlementLocator,
  muniLocator,
  oblastLocator,
  oblastChoropleth,
  nationMuniChoropleth,
} from "./geo";
import type {
  Column,
  Envelope,
  GeoArea,
  Row,
  ToolArgs,
  ToolContext,
} from "./types";

// ---- shared shapes ----------------------------------------------------------

type Pt = { d: string; v: number };
type Product = { id: number; cat: number; bg: string; en: string };
type Category = { id: number; bg: string; en: string };

interface DictFile {
  source: { name: string; nameEn: string; url: string };
  latestDate: string;
  baseline: string;
  coverage: { settlements: number; chains: number; rows: number };
  categories: Category[];
  products: Product[];
  commonBasketSize: number;
}
interface IndexFile extends DictFile {
  firstDate: string;
  national: {
    index: Pt[];
    byCategory: Record<string, Pt[]>;
    promoShare: Pt[];
  };
  regions: Record<string, { name: string; index: Pt[] }>;
}
interface RankTriple {
  national?: number | null;
}
interface RankSummary {
  basketLevel: number | null;
  nPriced: number;
  indexSinceEuro: number;
  change30d: number;
  rank: RankTriple;
  rankChange: RankTriple;
  peers: RankTriple;
}
interface SettProduct {
  id: number;
  min: number;
  avg: number;
  max: number;
  median: number;
  cheapestChain: string;
  stores: number;
  promoMin: number | null;
}
interface SettFile {
  ekatte: string;
  name: string;
  nameEn: string;
  obshtina: string;
  oblast: string;
  latestDate: string;
  baselineDate: string;
  basketChangeSinceEuro: number;
  basketChange30d: number;
  basketSeriesWeekly: Pt[];
  byCategory: { id: number; changeSinceEuro: number; change30d: number }[];
  topMovers: {
    up: { id: number; change: number }[];
    down: { id: number; change: number }[];
  };
  products: SettProduct[];
  rank?: RankSummary | null;
}
interface RankPlace {
  code: string;
  tier: "settlement" | "muni" | "oblast";
  name: string;
  oblast: string;
  basketLevel: number | null;
  nPriced: number;
  indexSinceEuro: number;
  change30d: number;
  rank: RankTriple;
  rankChange: RankTriple;
  peers: RankTriple;
}
interface RankingFile {
  latestDate: string;
  baseline: string;
  commonBasketSize: number;
  places: RankPlace[];
}
interface ChainRow {
  eik: string;
  chain: string;
  basket: number;
  nPriced: number;
}
interface ChainsFile {
  latestDate: string;
  commonBasketSize: number;
  national: ChainRow[];
}

const loadDict = () => fetchData<DictFile>("/prices/dict.json");
const PROV = "kolkostruva.bg (КЗП)";

// euro + percent formatting matching the project convention (`${n} €` / `€${n}`)
const eur = (n: number, lang: "bg" | "en", dp = 2): string => {
  const s = n.toLocaleString(lang === "bg" ? "bg-BG" : "en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  return lang === "bg" ? `${s} €` : `€${s}`;
};
const pct = (frac: number, dp = 1): string => {
  const v = frac * 100;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(dp)}%`;
};
const notCpi = (lang: "bg" | "en"): string =>
  lang === "bg"
    ? "Мониторингов индекс на КЗП, не официален ИПЦ."
    : "CPC monitoring basket index, not official CPI.";

const fmtBaseline = (iso: string | undefined, lang: "bg" | "en"): string =>
  iso
    ? new Date(iso).toLocaleDateString(lang === "bg" ? "bg-BG" : "en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

const Sofia = /софия|sofia|столиц/;

// ---- product resolution (free text → one of the 101 basket products) --------

const PRODUCT_ALIASES: [RegExp, number][] = [
  [/прясно мляко|fresh milk|млякото|мляко/, 6],
  [/бял хляб|хляб|bread/, 1],
  [/яйца|eggs/, 31],
  [/слънчогледово олио|олио|sunflower oil/, 42],
  [/зехтин|olive oil/, 43],
  [/кашкавал|kashkaval/, 11],
  [/сирене|cheese/, 9],
  [/масло|butter/, 12],
  [/брашно|flour/, 40],
  [/захар|sugar/, 38],
  [/ориз|rice/, 35],
  [/пилешко филе|chicken fillet/, 16],
  [/пиле|chicken/, 15],
  [/свинско|pork/, 18],
  [/телешко|veal|beef/, 23],
  [/кайма|мляно месо|minced/, 25],
  [/банани|bananas/, 52],
  [/ябълки|apples/, 53],
  [/домати|tomatoes/, 54],
  [/картофи|potatoes/, 61],
  [/лук|onion/, 55],
  [/краставици|cucumber/, 58],
  [/кафе|coffee/, 70],
  [/чай|tea/, 72],
  [/бира|beer/, 74],
  [/вино|wine/, 76],
  [/ракия|rakia/, 77],
  [/цигари|тютюн|cigarettes|tobacco/, 78],
  [/паста за зъби|toothpaste/, 81],
  [/шампоан|shampoo/, 82],
  [/сапун|soap/, 83],
  [/тоалетна хартия|toilet paper/, 85],
  [/лютеница|lyutenitsa/, 49],
];

/** Detect a basket-product reference in a free-text query (router-side, sync). */
export const detectPriceProduct = (q: string): boolean =>
  PRODUCT_ALIASES.some(([re]) => re.test(q));

const resolveProduct = (
  q: string,
  products: Product[],
): Product | undefined => {
  const lq = q.toLowerCase();
  for (const [re, id] of PRODUCT_ALIASES)
    if (re.test(lq)) return products.find((p) => p.id === id);
  // fall back to a direct name substring
  return products.find(
    (p) =>
      lq.includes(p.bg.toLowerCase().slice(0, 6)) ||
      lq.includes(p.en.toLowerCase().slice(0, 6)),
  );
};

const noData = (
  tool: string,
  title: string,
  facts: Record<string, string | number>,
  prov = "prices/dict.json",
): Envelope => ({
  tool,
  domain: "indicators",
  kind: "scalar",
  title,
  viz: "none",
  facts,
  provenance: [prov],
});

// =============================================================================
// 1. priceIndex — national or oblast basket index since the euro + categories
// =============================================================================

export const priceIndex = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const lang = ctx.lang;
  // index.json is a superset of dict.json, so fetch it directly (no dict round-trip)
  const idx = await fetchData<IndexFile>("/prices/index.json");
  const oblastArg =
    typeof args.oblast === "string" ? args.oblast.toUpperCase() : "";
  const region = oblastArg && idx.regions[oblastArg] ? oblastArg : "";
  const series = region ? idx.regions[region].index : idx.national.index;
  if (series.length < 2)
    return noData(
      "priceIndex",
      lang === "bg" ? "Няма ценови данни" : "No price data",
      {},
      "prices/index.json",
    );
  const latest = series[series.length - 1].v;
  const change = latest / 100 - 1;
  const baseLabel = fmtBaseline(idx.firstDate || idx.baseline, lang);
  const placeName = region
    ? (OBLASTS[region]?.[lang] ?? idx.regions[region].name)
    : lang === "bg"
      ? "България"
      : "Bulgaria";

  // category movers (national only)
  const catName = new Map(
    idx.categories.map((c) => [c.id, lang === "bg" ? c.bg : c.en]),
  );
  const catMovers = region
    ? []
    : Object.entries(idx.national.byCategory)
        .map(([cid, s]) => ({
          id: +cid,
          change: (s[s.length - 1]?.v ?? 100) / 100 - 1,
        }))
        .sort((a, b) => b.change - a.change);
  const topUp = catMovers[0];
  const topDown = catMovers[catMovers.length - 1];

  const facts: Record<string, string | number> = {
    place: placeName,
    basket_change_since_euro: pct(change),
    latest_date: idx.latestDate,
    baseline: baseLabel,
    note: notCpi(lang),
  };
  if (!region) {
    facts.settlements = idx.coverage.settlements;
    if (topUp)
      facts.biggest_riser = `${catName.get(topUp.id)}: ${pct(topUp.change)}`;
    if (topDown)
      facts.biggest_faller = `${catName.get(topDown.id)}: ${pct(topDown.change)}`;
    const promo =
      idx.national.promoShare[idx.national.promoShare.length - 1]?.v;
    if (promo != null) facts.basket_on_promo = pct(promo, 0);
  }

  return {
    tool: "priceIndex",
    domain: "indicators",
    kind: "series",
    title:
      lang === "bg"
        ? `Цени — кошница от въвеждането на еврото (${placeName})`
        : `Prices — basket since the euro (${placeName})`,
    subtitle:
      lang === "bg"
        ? `${pct(change)} спрямо ${baseLabel} · ${notCpi(lang)}`
        : `${pct(change)} vs ${baseLabel} · ${notCpi(lang)}`,
    categories: series.map((p) => p.d),
    series: [
      {
        key: "index",
        label: lang === "bg" ? "Индекс (база 100)" : "Index (base 100)",
        points: series.map((p) => ({ x: p.d, y: p.v })),
      },
    ],
    viz: "line",
    geo: region ? oblastLocator(region, placeName) : undefined,
    facts,
    provenance: ["prices/index.json", PROV],
  };
};

// =============================================================================
// 2. settlementPrices — cost of the basket in one place (+ optional product)
// =============================================================================

export const settlementPrices = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const lang = ctx.lang;
  const query = String(args.place ?? "").trim();
  const productQ = String(args.product ?? "").trim();
  const dict = await loadDict();

  // resolve the place to an EKATTE-keyed settlement shard (Sofia → 68134).
  let ekatte = "";
  let obshtina = "";
  if (Sofia.test(query.toLowerCase()) || (!query && productQ)) {
    ekatte = "68134";
    obshtina = "SOF46";
  } else {
    const place = await resolveSettlement(query).catch(() => undefined);
    if (place) {
      ekatte = place.ekatte;
      obshtina = place.obshtina;
    }
  }

  let sett: SettFile | undefined;
  if (ekatte)
    sett = await fetchData<SettFile>(`/prices/settlement/${ekatte}.json`).catch(
      () => undefined,
    );

  // município fallback (no per-settlement shard) — show its cheapest chains.
  if (!sett) {
    const muni = await resolveMunicipality(query).catch(() => undefined);
    if (muni) return cheapestChains({ place: query }, ctx);
    return noData(
      "settlementPrices",
      lang === "bg"
        ? `Няма ценови данни за „${query}“ (обхванати са ~${dict.coverage.settlements} населени места)`
        : `No price data for "${query}" (~${dict.coverage.settlements} settlements covered)`,
      { query },
    );
  }

  const prodName = new Map(
    dict.products.map((p) => [p.id, lang === "bg" ? p.bg : p.en]),
  );
  const placeName = lang === "bg" ? sett.name : sett.nameEn;

  // ---- single product asked ("колко струва млякото в Пловдив") ----
  if (productQ) {
    const product = resolveProduct(productQ, dict.products);
    const row = product
      ? sett.products.find((p) => p.id === product.id)
      : undefined;
    if (!product || !row)
      return noData(
        "settlementPrices",
        lang === "bg"
          ? `Няма цена за този продукт в ${placeName}`
          : `No price for that product in ${placeName}`,
        { place: placeName, product: productQ },
      );
    const label = lang === "bg" ? product.bg : product.en;
    return {
      tool: "settlementPrices",
      domain: "indicators",
      kind: "scalar",
      title: `${label} — ${placeName}`,
      subtitle: notCpi(lang),
      value: row.min,
      valueFormat: "text",
      viz: "none",
      geo: settlementLocator(ekatte, obshtina, placeName),
      facts: {
        place: placeName,
        product: label,
        lowest_price: eur(row.min, lang),
        cheapest_chain: row.cheapestChain,
        median_price: eur(row.median, lang),
        highest_price: eur(row.max, lang),
        stores: row.stores,
        as_of: sett.latestDate,
        note: notCpi(lang),
      },
      provenance: [`prices/settlement/${ekatte}.json`, PROV],
    };
  }

  // ---- whole-basket snapshot ----
  const FEATURED = [1, 6, 31, 42, 9, 16, 52, 61];
  const columns: Column[] = [
    { key: "product", label: lang === "bg" ? "Продукт" : "Product" },
    {
      key: "min",
      label: lang === "bg" ? "Най-ниска" : "Lowest",
      numeric: true,
    },
    { key: "avg", label: lang === "bg" ? "Средна" : "Avg", numeric: true },
    { key: "chain", label: lang === "bg" ? "Най-евтино в" : "Cheapest at" },
  ];
  const rows: Row[] = FEATURED.map((id) =>
    sett!.products.find((p) => p.id === id),
  )
    .filter((p): p is SettProduct => !!p)
    .map((p) => ({
      product: prodName.get(p.id) ?? String(p.id),
      min: eur(p.min, lang),
      avg: eur(p.avg, lang),
      chain: p.cheapestChain,
    }));

  const facts: Record<string, string | number> = {
    place: placeName,
    basket_change_since_euro: pct(sett.basketChangeSinceEuro),
    as_of: sett.latestDate,
    note: notCpi(lang),
  };
  const r = sett.rank;
  if (r?.rank?.national && r.peers?.national)
    facts.cheapest_rank =
      lang === "bg"
        ? `${r.rank.national}-о най-евтино от ${r.peers.national} места`
        : `#${r.rank.national} cheapest of ${r.peers.national}`;
  if (r?.basketLevel != null) facts.core_basket_cost = eur(r.basketLevel, lang);
  const up = sett.topMovers.up[0];
  const down = sett.topMovers.down[0];
  if (up) facts.biggest_riser = `${prodName.get(up.id)}: ${pct(up.change)}`;
  if (down)
    facts.biggest_faller = `${prodName.get(down.id)}: ${pct(down.change)}`;

  return {
    tool: "settlementPrices",
    domain: "indicators",
    kind: "table",
    title: lang === "bg" ? `Цени — ${placeName}` : `Prices — ${placeName}`,
    subtitle:
      lang === "bg"
        ? `Кошницата ${pct(sett.basketChangeSinceEuro)} от въвеждането на еврото · ${notCpi(lang)}`
        : `Basket ${pct(sett.basketChangeSinceEuro)} since the euro · ${notCpi(lang)}`,
    columns,
    rows,
    viz: "none",
    geo: settlementLocator(ekatte, obshtina, placeName),
    facts,
    provenance: [`prices/settlement/${ekatte}.json`, PROV],
  };
};

// =============================================================================
// 3. cheapestChains — chain comparison (national, or one município)
// =============================================================================

export const cheapestChains = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const lang = ctx.lang;
  const query = String(args.place ?? "").trim();

  let chains: ChainRow[] = [];
  let coreSize = 12;
  let scope = lang === "bg" ? "национално" : "national";
  let prov = "prices/chains.json";
  let geoObshtina = "";
  let geoOblast = "";

  if (query && !Sofia.test(query.toLowerCase())) {
    const muni = await resolveMunicipality(query).catch(() => undefined);
    if (muni) {
      const f = await fetchData<{
        chains: ChainRow[];
        coreBasketSize?: number;
      }>(`/prices/chains/${muni.obshtina}.json`).catch(() => undefined);
      if (f && f.chains.length) {
        chains = f.chains;
        coreSize = f.coreBasketSize ?? 12;
        scope = lang === "bg" ? muni.name : muni.nameEn;
        prov = `prices/chains/${muni.obshtina}.json`;
        geoObshtina = muni.obshtina;
        geoOblast = muni.oblast;
      }
    }
  }
  if (!chains.length) {
    const f = await fetchData<ChainsFile>("/prices/chains.json");
    chains = f.national;
    coreSize = f.commonBasketSize;
  }
  if (!chains.length)
    return noData(
      "cheapestChains",
      lang === "bg" ? "Няма данни за вериги" : "No chain data",
      {},
      "prices/chains.json",
    );

  const top = chains.slice(0, 12);
  const columns: Column[] = [
    { key: "rank", label: "#", numeric: true, format: "int" },
    { key: "chain", label: lang === "bg" ? "Верига" : "Chain" },
    {
      key: "basket",
      label: lang === "bg" ? "Кошница" : "Basket",
      numeric: true,
    },
    {
      key: "cover",
      label: lang === "bg" ? "Продукти" : "Priced",
      numeric: true,
    },
  ];
  const rows: Row[] = top.map((c, i) => ({
    rank: i + 1,
    chain: c.chain,
    basket: eur(c.basket, lang),
    cover: `${c.nPriced}/${coreSize}`,
  }));
  return {
    tool: "cheapestChains",
    domain: "indicators",
    kind: "table",
    title:
      lang === "bg"
        ? `Най-евтини вериги за кошницата (${scope})`
        : `Cheapest chains for the basket (${scope})`,
    subtitle:
      lang === "bg"
        ? `Сравнено върху общата кошница, която всяка верига предлага (брой продукти). ${notCpi(lang)}`
        : `Compared on the shared basket each chain prices (coverage). ${notCpi(lang)}`,
    columns,
    rows,
    viz: "none",
    geo: geoObshtina ? muniLocator(geoObshtina, geoOblast, scope) : undefined,
    facts: {
      scope,
      cheapest_chain: top[0]
        ? `${top[0].chain}: ${eur(top[0].basket, lang)}`
        : "—",
      chains_compared: chains.length,
      note: notCpi(lang),
    },
    provenance: [prov, PROV],
  };
};

// =============================================================================
// 4. priceRanking — cheapest / rose-most places (settlements or oblasts) + map
// =============================================================================

const ROSE =
  /поскъп|поскъпна|rose|increase|по-скъп|най-голямо поскъпване|risen/;
const RANK_OBLAST = /област|region|oblast/;

export const priceRanking = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const lang = ctx.lang;
  const q = String(args.metric ?? "").toLowerCase();
  const byChange = ROSE.test(q);
  const wantOblast = RANK_OBLAST.test(q);
  const tier: "settlement" | "oblast" = wantOblast ? "oblast" : "settlement";
  const n = Math.max(3, Math.min(Number(args.n) || 8, 20));

  const f = await fetchData<RankingFile>("/prices/ranking.json");
  const places = f.places.filter(
    (p) =>
      p.tier === tier && (byChange ? p.rankChange?.national : p.rank?.national),
  );
  if (!places.length)
    return noData(
      "priceRanking",
      lang === "bg" ? "Няма класация" : "No ranking",
      {},
      "prices/ranking.json",
    );

  // by-change: highest index first (rose most). by-level: cheapest basket first.
  const ranked = byChange
    ? [...places].sort((a, b) => b.indexSinceEuro - a.indexSinceEuro)
    : [...places]
        .filter((p) => p.basketLevel != null)
        .sort((a, b) => a.basketLevel! - b.basketLevel!);
  const top = ranked.slice(0, n);

  const metricLabel = byChange
    ? lang === "bg"
      ? "Поскъпване от еврото"
      : "Rise since the euro"
    : lang === "bg"
      ? "Цена на кошницата"
      : "Basket cost";
  const valOf = (p: RankPlace): string =>
    byChange
      ? pct(p.indexSinceEuro / 100 - 1)
      : p.basketLevel != null
        ? eur(p.basketLevel, lang)
        : "—";

  const columns: Column[] = [
    { key: "rank", label: "#", numeric: true, format: "int" },
    { key: "place", label: lang === "bg" ? "Място" : "Place" },
    { key: "value", label: metricLabel, numeric: true },
  ];
  const rows: Row[] = top.map((p, i) => ({
    rank: i + 1,
    place: tier === "oblast" ? (OBLASTS[p.code]?.[lang] ?? p.name) : p.name,
    value: valOf(p),
  }));

  // choropleth over all ranked places
  const geoAreas: GeoArea[] = ranked.map((p) => ({
    code: p.code,
    label: tier === "oblast" ? (OBLASTS[p.code]?.[lang] ?? p.name) : p.name,
    value: byChange ? p.indexSinceEuro : (p.basketLevel ?? undefined),
    display: valOf(p),
  }));
  const geo =
    tier === "oblast"
      ? oblastChoropleth(geoAreas, { metricLabel, colorMode: "ramp" })
      : nationMuniChoropleth(geoAreas, { metricLabel, colorMode: "ramp" });

  const dirWord = byChange
    ? lang === "bg"
      ? "най-голямо поскъпване"
      : "biggest rise"
    : lang === "bg"
      ? "най-евтини"
      : "cheapest";
  const tierWord =
    tier === "oblast"
      ? lang === "bg"
        ? "области"
        : "oblasts"
      : lang === "bg"
        ? "места"
        : "places";

  return {
    tool: "priceRanking",
    domain: "indicators",
    kind: "table",
    title:
      lang === "bg"
        ? `Класация на цените: ${dirWord} (${tierWord})`
        : `Price ranking: ${dirWord} (${tierWord})`,
    subtitle: notCpi(lang),
    columns,
    rows,
    viz: "none",
    geo,
    facts: {
      order: dirWord,
      tier: tierWord,
      leader: top[0] ? `${rows[0].place}: ${rows[0].value}` : "—",
      ranked: ranked.length,
      note: notCpi(lang),
    },
    provenance: ["prices/ranking.json", PROV],
  };
};
