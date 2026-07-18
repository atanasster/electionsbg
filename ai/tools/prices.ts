// КЗП "Колко струва" retail-price tools (euro-adoption monitoring feed).
// Served from Postgres (migration 048) via /api/db/price-payload — the
// data/prices/*.json tree is gone. The payload SHAPES are unchanged (byte
// parity verified), so only the fetch differs. The basket index is a MONITORING
// index, not official CPI — every envelope says so, and the LLM only narrates
// facts. See docs/plans/consumption-pg-v1.md.

import { fetchData, fetchDb } from "./dataClient";
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
  GeoOverlay,
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
  muni?: string; // obshtina code (settlement tier only) — used for the muni map
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

/** One price_payloads blob by (kind, key). Mirrors src/data/prices — same route,
 *  same shapes as the retired data/prices/*.json. Returns null for a missing
 *  place (an uncovered settlement/muni), so callers .catch(() => undefined) or
 *  guard on falsy exactly as they did against the old 404. */
const pricePayload = <T>(kind: string, key?: string) =>
  fetchDb<T>("price-payload", key ? { kind, key } : { kind });

const loadDict = () => pricePayload<DictFile>("dict");
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
  prov = "price_payloads (PG)",
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
  const idx = await pricePayload<IndexFile>("index");
  // price-payload returns null on an empty/pre-migration DB (200, not 404).
  if (!idx) return noData("priceIndex", "", { note: notCpi(ctx.lang) });
  const oblastArg =
    typeof args.oblast === "string" ? args.oblast.toUpperCase() : "";
  const region = oblastArg && idx.regions[oblastArg] ? oblastArg : "";
  const series = region ? idx.regions[region].index : idx.national.index;
  if (series.length < 2)
    return noData(
      "priceIndex",
      lang === "bg" ? "Няма ценови данни" : "No price data",
      {},
      "price_payloads (PG)",
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
    provenance: ["price_payloads (PG)", PROV],
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
  if (!dict) return noData("settlementPrices", "", { note: notCpi(ctx.lang) });

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
    sett = await pricePayload<SettFile>("place", ekatte).catch(() => undefined);

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
        // Surface a live promo when it beats the regular min (the promo store
        // isn't in the shard, so it's reported without a chain claim).
        ...(row.promoMin != null && row.promoMin < row.min
          ? { on_promo: eur(row.promoMin, lang) }
          : {}),
        as_of: sett.latestDate,
        note: notCpi(lang),
      },
      provenance: ["price_payloads (PG)", PROV],
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
  // Products on promotion right now (promoMin below the regular min) — the
  // local promo signal, so "цените в X" answers surface active offers.
  const onPromo = sett.products
    .filter((p) => p.promoMin != null && p.promoMin < p.min)
    .sort((a, b) => a.promoMin! / a.min - b.promoMin! / b.min)
    .slice(0, 3)
    .map((p) => `${prodName.get(p.id)} (${eur(p.promoMin!, lang)})`);
  if (onPromo.length) facts.on_promo = onPromo.join(", ");

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
    provenance: ["price_payloads (PG)", PROV],
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
  let prov = "price_payloads (PG)";
  let geoObshtina = "";
  let geoOblast = "";

  if (query && !Sofia.test(query.toLowerCase())) {
    const muni = await resolveMunicipality(query).catch(() => undefined);
    if (muni) {
      const f = await fetchDb<{
        chains: ChainRow[];
        coreBasketSize?: number;
      }>("price-payload", { kind: "chains-muni", key: muni.obshtina }).catch(
        () => undefined,
      );
      if (f && f.chains.length) {
        chains = f.chains;
        coreSize = f.coreBasketSize ?? 12;
        scope = lang === "bg" ? muni.name : muni.nameEn;
        prov = "price_payloads (PG)";
        geoObshtina = muni.obshtina;
        geoOblast = muni.oblast;
      }
    }
  }
  if (!chains.length) {
    const f = await pricePayload<ChainsFile>("chains");
    if (f) {
      chains = f.national;
      coreSize = f.commonBasketSize;
    }
  }
  if (!chains.length)
    return noData(
      "cheapestChains",
      lang === "bg" ? "Няма данни за вериги" : "No chain data",
      {},
      "price_payloads (PG)",
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
// 3b. localDeals — biggest current promos, national or scoped to one município
// =============================================================================

interface DealRow {
  slug: string;
  title: string;
  promo: number;
  reg: number;
  discPct: number;
  eik: string;
  chain: string;
}
interface DealsFile {
  latestDate: string;
  deals: DealRow[];
}

const DEAL =
  /промоц|намален|оферт|отстъпк|deal|discount|on sale|sale|намалени|-\d+ ?%/i;

/** Detect a promotions/deals query (router-side, sync). */
export const detectPriceDeal = (q: string): boolean => DEAL.test(q);

/** Resolve the ambient ?area= anchor (ekatte or obshtina id) to an obshtina
 *  key for the deals-muni / chains-muni payloads. An ekatte is mapped via its
 *  place shard; Sofia's aggregate codes fold to SOF46. */
const areaToObshtina = async (area: string): Promise<string | ""> => {
  if (/^SOF/i.test(area)) return "SOF46";
  if (/^\d/.test(area)) {
    const s = await pricePayload<SettFile>("place", area).catch(
      () => undefined,
    );
    return s?.obshtina ?? "";
  }
  return area;
};

export const localDeals = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const lang = ctx.lang;
  const query = String(args.place ?? "").trim();
  const productQ = String(args.product ?? "").trim();

  let obshtina = "";
  let scope = lang === "bg" ? "национално" : "national";
  const lc = query.toLowerCase();
  if (query && Sofia.test(lc)) {
    obshtina = "SOF46";
    scope = lang === "bg" ? "София" : "Sofia";
  } else if (query) {
    const muni = await resolveMunicipality(query).catch(() => undefined);
    if (muni) {
      obshtina = muni.obshtina;
      scope = lang === "bg" ? muni.name : muni.nameEn;
    } else {
      const s = await resolveSettlement(query).catch(() => undefined);
      if (s) {
        obshtina = s.obshtina;
        scope = lang === "bg" ? s.name : s.nameEn;
      }
    }
  }
  // Ambient location: a place-less "промоции край мен" uses the anchored area.
  if (!obshtina && ctx.area) {
    obshtina = await areaToObshtina(ctx.area);
    if (obshtina) scope = lang === "bg" ? "вашия район" : "your area";
  }

  let deals: DealRow[] = [];
  let latestDate = "";
  if (obshtina) {
    const f = await pricePayload<DealsFile>("deals-muni", obshtina).catch(
      () => undefined,
    );
    if (f && f.deals.length) {
      deals = f.deals;
      latestDate = f.latestDate;
    } else {
      // covered obshtina with no promos → fall through to the national feed
      scope = lang === "bg" ? "национално" : "national";
    }
  }
  if (!deals.length) {
    const f = await pricePayload<DealsFile>("deals");
    if (f) {
      deals = f.deals;
      latestDate = f.latestDate;
      scope = lang === "bg" ? "национално" : "national";
    }
  }
  if (productQ) {
    const pq = productQ.toLowerCase();
    deals = deals.filter((d) => d.title.toLowerCase().includes(pq));
  }
  if (!deals.length)
    return noData(
      "localDeals",
      lang === "bg"
        ? productQ
          ? `Няма текуща промоция за „${productQ}“ (${scope})`
          : `Няма текущи промоции (${scope})`
        : productQ
          ? `No current promotion for "${productQ}" (${scope})`
          : `No current promotions (${scope})`,
      { scope },
    );

  const top = deals.slice(0, 12);
  const columns: Column[] = [
    { key: "product", label: lang === "bg" ? "Продукт" : "Product" },
    { key: "chain", label: lang === "bg" ? "Верига" : "Chain" },
    { key: "promo", label: lang === "bg" ? "Промо" : "Promo", numeric: true },
    {
      key: "reg",
      label: lang === "bg" ? "Редовна" : "Regular",
      numeric: true,
    },
    { key: "off", label: lang === "bg" ? "Отстъпка" : "Off", numeric: true },
  ];
  const rows: Row[] = top.map((d) => ({
    product: d.title,
    chain: d.chain || "—",
    promo: eur(d.promo, lang),
    reg: eur(d.reg, lang),
    off: `−${d.discPct}%`,
  }));
  const best = top[0];
  return {
    tool: "localDeals",
    domain: "indicators",
    kind: "table",
    title: lang === "bg" ? `Промоции (${scope})` : `Promotions (${scope})`,
    subtitle:
      lang === "bg"
        ? `Промоционална спрямо редовна цена · ${notCpi(lang)}`
        : `Promo vs regular price · ${notCpi(lang)}`,
    columns,
    rows,
    viz: "none",
    facts: {
      scope,
      biggest_discount: best
        ? `${best.title}: −${best.discPct}% (${eur(best.promo, lang)})`
        : "—",
      deals_shown: top.length,
      as_of: latestDate,
      note: notCpi(lang),
    },
    provenance: ["price_payloads (PG)", PROV],
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

  const f = await pricePayload<RankingFile>("ranking");
  if (!f) return noData("priceRanking", "", { note: notCpi(ctx.lang) });
  const places = f.places.filter(
    (p) =>
      p.tier === tier && (byChange ? p.rankChange?.national : p.rank?.national),
  );
  if (!places.length)
    return noData(
      "priceRanking",
      lang === "bg" ? "Няма класация" : "No ranking",
      {},
      "price_payloads (PG)",
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

  // Choropleth over all ranked places. Oblast rows join the country oblast map
  // directly on the МИР code. There is no national settlement geojson, so —
  // exactly like rankPlaces' municipal rankings — settlement rows are painted on
  // the obshtina each one sits in (its `muni` code), keeping the best-ranked
  // settlement per município (`ranked` is already sorted best-first). Sofia's
  // prices-pipeline obshtina "SOF46" maps to the synthetic "SOF00" that the muni
  // map fans out into its 24 районни shards.
  let geo: GeoOverlay;
  if (tier === "oblast") {
    const geoAreas: GeoArea[] = ranked.map((p) => ({
      code: p.code,
      label: OBLASTS[p.code]?.[lang] ?? p.name,
      value: byChange ? p.indexSinceEuro : (p.basketLevel ?? undefined),
      display: valOf(p),
    }));
    geo = oblastChoropleth(geoAreas, { metricLabel, colorMode: "ramp" });
  } else {
    const byMuni = new Map<string, GeoArea>();
    for (const p of ranked) {
      const code = p.muni === "SOF46" ? "SOF00" : p.muni;
      if (!code || byMuni.has(code)) continue;
      byMuni.set(code, {
        code,
        label: p.name,
        value: byChange ? p.indexSinceEuro : (p.basketLevel ?? undefined),
        display: valOf(p),
      });
    }
    geo = nationMuniChoropleth([...byMuni.values()], {
      metricLabel,
      colorMode: "ramp",
    });
  }

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
    provenance: ["price_payloads (PG)", PROV],
  };
};

// =============================================================================
// 5. basketAffordability — basket cost relative to regional income (GDP/capita)
// =============================================================================
// Joins the КЗП oblast basket cost (ranking.json) to Eurostat GDP-per-capita
// (regional.json) so the same basket reads as a heavier burden in a poorer
// oblast — a stand-in for the (Infostat-walled) per-oblast net-wage index.
// GDP/capita is regional OUTPUT per person, NOT household net wage — labelled.

interface RegionalData {
  indicators?: Record<string, { sourceUrl?: string }>;
  series: Record<string, Record<string, { year: number; value: number }[]>>;
}

const SOFIA_MIR = /^S2[345]$/;

export const basketAffordability = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const lang = ctx.lang;
  const [rank, reg] = await Promise.all([
    pricePayload<RankingFile>("ranking"),
    fetchData<RegionalData>("/regional.json"),
  ]);
  if (!rank) return noData("basketAffordability", "", { note: notCpi(lang) });
  const gdp = reg.series?.gdpPerCapita ?? {};
  const latestGpc = (code: string): number | undefined => {
    const g = gdp[code];
    return g && g.length ? g[g.length - 1].value : undefined;
  };

  type Aff = {
    code: string;
    name: string;
    basket: number;
    gpc: number;
    share: number;
  };
  // NB: these ranking rules — skip PDV-00, collapse S23/S24/S25 into one
  // Sofia-city row, and the `share` formula — are mirrored in the on-screen
  // tile src/screens/consumption/ConsumptionAffordabilityTile.tsx. The ai/
  // layer is separately compiled (can't import src/), so keep the two in sync.
  const rows: Aff[] = []; // table — Sofia МИР collapsed into one city row
  const raw: Aff[] = []; // geo — every oblast incl. the 3 Sofia МИР
  const sofiaParts: number[] = [];
  let sofiaGpc: number | undefined;
  for (const p of rank.places) {
    if (p.tier !== "oblast" || p.basketLevel == null) continue;
    // PDV-00 is the Plovdiv-CITY МИР — a sub-oblast district inside the PDV
    // oblast (already listed), not a separate oblast; skip it so Plovdiv isn't
    // double-counted. (Sofia's 3 МИР together ARE the София-град oblast, so they
    // are consolidated below rather than skipped.)
    if (p.code === "PDV-00") continue;
    const gpc = latestGpc(p.code);
    if (!gpc || gpc <= 0) continue;
    const name = OBLASTS[p.code]?.[lang] ?? p.name;
    // share = annualized basket ÷ annual GDP/capita; ×52 is a constant across
    // oblasti, so only the RANK is meaningful.
    const share = (p.basketLevel * 52) / gpc;
    raw.push({ code: p.code, name, basket: p.basketLevel, gpc, share });
    if (SOFIA_MIR.test(p.code)) {
      sofiaParts.push(p.basketLevel);
      sofiaGpc = gpc;
      continue;
    }
    rows.push({ code: p.code, name, basket: p.basketLevel, gpc, share });
  }
  if (sofiaParts.length && sofiaGpc) {
    const basket = sofiaParts.reduce((a, b) => a + b, 0) / sofiaParts.length;
    rows.push({
      code: "SOF_CITY",
      name: lang === "bg" ? "София (столица)" : "Sofia (capital)",
      basket,
      gpc: sofiaGpc,
      share: (basket * 52) / sofiaGpc,
    });
  }
  if (rows.length < 5)
    return noData(
      "basketAffordability",
      lang === "bg" ? "Няма данни за достъпност" : "No affordability data",
      {},
      "regional.json",
    );

  const sorted = [...rows].sort((a, b) => a.share - b.share); // most affordable first
  const N = sorted.length;
  const gpcLabel = (n: number): string =>
    lang === "bg"
      ? `${Math.round(n / 100) / 10} хил. €`
      : `€${Math.round(n / 100) / 10}k`;
  const note =
    lang === "bg"
      ? "Достъпност = цена на кошницата спрямо БВП на човек в областта (Евростат). БВП на човек е приблизителен измерител на регионалния доход, не нетна работна заплата."
      : "Affordability = basket cost relative to the oblast's GDP-per-capita (Eurostat). GDP-per-capita proxies regional income, not net household wage.";

  // ---- single oblast asked ----
  const oblastArg =
    typeof args.oblast === "string" ? args.oblast.toUpperCase() : "";
  if (oblastArg) {
    const lookup = SOFIA_MIR.test(oblastArg) ? "SOF_CITY" : oblastArg;
    const me = rows.find((r) => r.code === lookup);
    if (me) {
      const pos = sorted.findIndex((r) => r.code === lookup) + 1;
      return {
        tool: "basketAffordability",
        domain: "indicators",
        kind: "scalar",
        title:
          lang === "bg"
            ? `Достъпност на кошницата — ${me.name}`
            : `Basket affordability — ${me.name}`,
        subtitle: note,
        viz: "none",
        geo: oblastLocator(lookup === "SOF_CITY" ? "S23" : lookup, me.name),
        facts: {
          place: me.name,
          affordability_rank:
            lang === "bg" ? `${pos}-о от ${N}` : `#${pos} of ${N}`,
          basket_cost: eur(me.basket, lang),
          gdp_per_capita: gpcLabel(me.gpc),
          note,
        },
        provenance: ["price_payloads (PG)", "regional.json", PROV],
      };
    }
  }

  // ---- national leaderboard (all oblasts, most→least affordable) ----
  const columns: Column[] = [
    { key: "rank", label: "#", numeric: true, format: "int" },
    { key: "place", label: lang === "bg" ? "Област" : "Oblast" },
    {
      key: "basket",
      label: lang === "bg" ? "Кошница" : "Basket",
      numeric: true,
    },
    {
      key: "gdp",
      label: lang === "bg" ? "БВП/човек" : "GDP/capita",
      numeric: true,
    },
  ];
  const tableRows: Row[] = sorted.map((r, i) => ({
    rank: i + 1,
    place: r.name,
    basket: eur(r.basket, lang),
    gdp: gpcLabel(r.gpc),
  }));

  const metricLabel =
    lang === "bg" ? "Кошница спрямо БВП на човек" : "Basket vs GDP per capita";
  const geoAreas: GeoArea[] = raw.map((r) => ({
    code: r.code,
    label: r.name,
    value: r.share,
    display: `${(r.share * 100).toFixed(1)}%`,
  }));

  const most = sorted[0];
  const least = sorted[sorted.length - 1];
  return {
    tool: "basketAffordability",
    domain: "indicators",
    kind: "table",
    title:
      lang === "bg"
        ? "Достъпност на кошницата по области (спрямо доходите)"
        : "Basket affordability by oblast (vs income)",
    subtitle: note,
    columns,
    rows: tableRows,
    viz: "none",
    geo: oblastChoropleth(geoAreas, { metricLabel, colorMode: "ramp" }),
    facts: {
      most_affordable: `${most.name}: ${eur(most.basket, lang)} · ${gpcLabel(most.gpc)}`,
      least_affordable: `${least.name}: ${eur(least.basket, lang)} · ${gpcLabel(least.gpc)}`,
      oblasts_ranked: N,
      note,
    },
    provenance: ["price_payloads (PG)", "regional.json", PROV],
  };
};

// =============================================================================
// 6. basketVsInflation — КЗП basket (since euro) vs official Eurostat HICP + HPI
// =============================================================================
// Puts the cumulative-since-euro monitoring basket next to the official HICP
// (YoY food/overall/energy/core) + the national house-price index. Spells out
// that the two cover different windows, so it's a context juxtaposition, not a
// like-for-like comparison.

interface MacroPt {
  year: number;
  quarter?: number;
  period?: string;
  value: number;
}
interface MacroLite {
  indicators?: Record<string, { sourceUrl?: string }>;
  series: Record<string, MacroPt[]>;
}

export const basketVsInflation = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const lang = ctx.lang;
  const [idx, macro] = await Promise.all([
    pricePayload<IndexFile>("index"),
    fetchData<MacroLite>("/macro.json"),
  ]);
  if (!idx) return noData("basketVsInflation", "", { note: notCpi(lang) });
  const series = idx.national.index;
  const basketChange =
    series.length >= 2 ? series[series.length - 1].v / 100 - 1 : 0;
  const baseLabel = fmtBaseline(idx.firstDate || idx.baseline, lang);
  const last = (k: string): MacroPt | undefined => {
    const s = macro.series[k];
    return s && s.length ? s[s.length - 1] : undefined;
  };
  const overall = last("inflation");
  const food = last("inflationFood");
  const energy = last("inflationEnergy");
  const core = last("inflationCore");
  const period = overall?.period ?? food?.period ?? "";
  // macro values are already percentages (e.g. 4.13 = +4.13% YoY).
  const yoy = (v: number): string => pct(v / 100);

  const rows: Row[] = [];
  const add = (bg: string, en: string, p?: MacroPt) => {
    if (p) rows.push({ indicator: lang === "bg" ? bg : en, yoy: yoy(p.value) });
  };
  add("Храни", "Food", food);
  add("Обща", "Overall", overall);
  add("Енергия", "Energy", energy);
  add("Базова", "Core", core);

  const note =
    lang === "bg"
      ? "Кошницата на КЗП е кумулативен мониторингов индекс от въвеждането на еврото; ХИПЦ е официалният годишен темп на инфлация (Евростат). Различни прозорци и методология — не са пряко съпоставими."
      : "The CPC basket is a cumulative monitoring index since the euro changeover; HICP is the official year-on-year inflation rate (Eurostat). Different windows and methodology — not directly comparable.";

  return {
    tool: "basketVsInflation",
    domain: "indicators",
    kind: "table",
    title:
      lang === "bg"
        ? "Кошница на КЗП спрямо официалната инфлация (ХИПЦ)"
        : "CPC basket vs official inflation (HICP)",
    subtitle:
      lang === "bg"
        ? `Кошница ${pct(basketChange)} от ${baseLabel} · официална инфлация ${period}`
        : `Basket ${pct(basketChange)} since ${baseLabel} · official inflation ${period}`,
    columns: [
      {
        key: "indicator",
        label: lang === "bg" ? "Официална инфлация (ХИПЦ)" : "Official (HICP)",
      },
      { key: "yoy", label: lang === "bg" ? "Годишно" : "YoY", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      basket_change_since_euro: pct(basketChange),
      basket_baseline: baseLabel,
      ...(overall ? { hicp_overall: yoy(overall.value) } : {}),
      ...(food ? { hicp_food: yoy(food.value) } : {}),
      ...(energy ? { hicp_energy: yoy(energy.value) } : {}),
      hicp_period: period,
      note,
    },
    provenance: ["price_payloads (PG)", "macro.json", PROV],
  };
};

// =============================================================================
// 6b. euFoodPriceLevels — BG food prices vs the EU (Eurostat PLI, EU27=100)
// =============================================================================
// Official Eurostat–OECD PPP-programme price level indices (prc_ppp_ind_1),
// merged into macro_peers.json as `foodPli`. Answers "по-скъпа ли е храната у нас
// от ЕС" with the per-category picture (dairy & oils above, meat/bread below).

interface FoodPliLite {
  foodPli?: {
    source: string;
    sourceUrl: string;
    year: number;
    categories: { code: string; bg: string; en: string; agg?: boolean }[];
    values: Record<string, Record<string, number>>;
  };
}

export const euFoodPriceLevels = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const lang = ctx.lang;
  const peers = await fetchData<FoodPliLite>("/macro_peers.json");
  const fp = peers?.foodPli;
  const title =
    lang === "bg"
      ? "Храната у нас спрямо ЕС (Евростат, ЕС=100)"
      : "Food here vs the EU (Eurostat, EU=100)";
  if (!fp || !fp.values.BG)
    return noData(
      "euFoodPriceLevels",
      title,
      { note: lang === "bg" ? "Няма данни." : "No data." },
      "Eurostat prc_ppp_ind_1",
    );

  const bgVals = fp.values.BG;
  const totalPli = bgVals["A010101"];
  const subs = fp.categories.filter((c) => !c.agg);
  const rows: Row[] = [];
  let dearest: { label: string; v: number } | null = null;
  let cheapest: { label: string; v: number } | null = null;
  for (const c of subs) {
    const v = bgVals[c.code];
    if (v == null) continue;
    const label = lang === "bg" ? c.bg : c.en;
    rows.push({
      category: label,
      pli: Math.round(v),
      vs:
        v > 100
          ? lang === "bg"
            ? "по-скъпо"
            : "dearer"
          : lang === "bg"
            ? "по-евтино"
            : "cheaper",
    });
    if (!dearest || v > dearest.v) dearest = { label, v };
    if (!cheapest || v < cheapest.v) cheapest = { label, v };
  }
  rows.sort((a, b) => (b.pli as number) - (a.pli as number));

  const delta = totalPli != null ? Math.round(Math.abs(totalPli - 100)) : null;
  const cheaperTotal = totalPli != null && totalPli < 100;

  return {
    tool: "euFoodPriceLevels",
    domain: "indicators",
    kind: "table",
    title,
    subtitle:
      totalPli != null
        ? lang === "bg"
          ? `Храна общо: ${Math.round(totalPli)} · ${delta}% ${cheaperTotal ? "под" : "над"} средното за ЕС · ${fp.year}`
          : `Food total: ${Math.round(totalPli)} · ${delta}% ${cheaperTotal ? "below" : "above"} the EU average · ${fp.year}`
        : undefined,
    columns: [
      { key: "category", label: lang === "bg" ? "Категория" : "Category" },
      {
        key: "pli",
        label: lang === "bg" ? "Индекс (ЕС=100)" : "Index (EU=100)",
        numeric: true,
      },
      { key: "vs", label: lang === "bg" ? "Спрямо ЕС" : "vs EU" },
    ],
    rows,
    viz: "none",
    facts: {
      ...(totalPli != null ? { bg_food_total_pli: Math.round(totalPli) } : {}),
      ...(delta != null
        ? {
            vs_eu_average:
              lang === "bg"
                ? `${delta}% ${cheaperTotal ? "под" : "над"} ЕС`
                : `${delta}% ${cheaperTotal ? "below" : "above"} the EU`,
          }
        : {}),
      ...(dearest
        ? { dearest: `${dearest.label} (${Math.round(dearest.v)})` }
        : {}),
      ...(cheapest
        ? { cheapest: `${cheapest.label} (${Math.round(cheapest.v)})` }
        : {}),
      year: fp.year,
      note:
        lang === "bg"
          ? "Официална статистика на Евростат (програма PPP), ЕС=100. Отчита ДДС и качеството; не отразява доходите."
          : "Official Eurostat statistics (PPP programme), EU=100. VAT- and quality-adjusted; does not reflect incomes.",
    },
    provenance: ["macro_peers.json", "Eurostat prc_ppp_ind_1"],
  };
};

// =============================================================================
// 7. productPrice — one specific product across chains (the browser, for chat)
// =============================================================================
// Resolves a free-text product to a canonical product via trigram search
// (price-search), then returns its cross-chain ladder (price-product). This is
// the product-grain unlock the old 101-group tools never had: "колко струва
// кафе Лаваца" resolves to the actual Lavazza SKU, not the whole coffee group.

interface ProductHit {
  slug: string;
  title: string;
  pid: number;
  chain_count: number;
  current_min_eur: number | null;
  pct_since_euro: number | null;
}
interface LadderRow {
  eik: string;
  chain: string;
  price_eur: number;
  promo_eur: number | null;
  stores: number;
}

const searchProduct = (q: string) =>
  fetchDb<ProductHit[]>("price-search", { q });

export const productPrice = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const lang = ctx.lang;
  const q = typeof args.product === "string" ? args.product.trim() : "";
  if (q.length < 2)
    return noData(
      "productPrice",
      q,
      { note: notCpi(lang) },
      "price_payloads (PG)",
    );

  const hits = await searchProduct(q);
  if (!hits || !hits.length)
    return noData(
      "productPrice",
      lang === "bg" ? `Няма продукт „${q}"` : `No product "${q}"`,
      { query: q, note: notCpi(lang) },
      "price_payloads (PG)",
    );
  const top = hits[0];
  const detail = await fetchDb<{
    product: ProductHit & { confidence: number };
    chains: LadderRow[];
  } | null>("price-product", { slug: top.slug });

  const ladder = (detail?.chains ?? []).slice(0, 8);
  const columns: Column[] = [
    { key: "chain", label: lang === "bg" ? "Верига" : "Chain" },
    { key: "price", label: lang === "bg" ? "Цена" : "Price", numeric: true },
  ];
  const rows: Row[] = ladder.map((c) => ({
    chain: c.chain,
    price: eur(c.promo_eur ?? c.price_eur, lang),
  }));

  const since =
    top.pct_since_euro == null
      ? lang === "bg"
        ? "нов след еврото"
        : "new since the euro"
      : `${pct(top.pct_since_euro / 100)} ${lang === "bg" ? "от еврото" : "since the euro"}`;

  return {
    tool: "productPrice",
    domain: "indicators",
    kind: "table",
    title: top.title,
    subtitle:
      top.current_min_eur != null
        ? `${lang === "bg" ? "от" : "from"} ${eur(top.current_min_eur, lang)} · ${top.chain_count} ${lang === "bg" ? "вериги" : "chains"} · ${since}`
        : since,
    columns,
    rows,
    viz: "none",
    facts: {
      product: top.title,
      slug: top.slug,
      lowest_price:
        top.current_min_eur != null ? eur(top.current_min_eur, lang) : "",
      chains: top.chain_count,
      since_euro: since,
      cheapest_chain: ladder[0]?.chain ?? "",
      note: notCpi(lang),
    },
    provenance: ["price_payloads (PG)", PROV],
  };
};

// =============================================================================
// 8. chainProfile — a retail chain's retail position + money-flows footprint
// =============================================================================
// Resolves a big-chain name to its EIK via the `chains` payload, then joins the
// company rollup (/api/db/company) — so "какви поръчки печели Кауфланд" is answered
// with both the retail basket rank AND the public-procurement footprint. Big
// chains only (the router gate excludes the метро=subway namesake).

// The big, unambiguous chains, each with its Commerce-Register EIK so a query
// resolves to the company regardless of language AND regardless of whether the
// chain prices the comparable basket (not all do — Kaufland/Sopharmacy aren't in
// the fairness-filtered `chains` set, but they DO have a company footprint). Long
// alias stems keep false matches out; the метро=subway case is filtered in the
// router by requiring a chain/retail/procurement context.
const CHAIN_MATCH: { re: RegExp; eik: string }[] = [
  { re: /кауфланд|kaufland/i, eik: "131129282" },
  { re: /билла|billa/i, eik: "130007884" },
  { re: /лидл|lidl/i, eik: "131071587" },
  { re: /фантастико|fantastico/i, eik: "206255903" },
  { re: /метро|metro/i, eik: "121644736" },
  { re: /софармаси|sopharmacy/i, eik: "175334310" },
];

export const detectChain = (q: string): boolean =>
  CHAIN_MATCH.some((m) => m.re.test(q));

interface CompanyLite {
  company?: { name: string } | null;
  procurement?: { totalEur: number; contractCount: number } | null;
}

export const chainProfile = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const lang = ctx.lang;
  const T = (b: string, e: string) => (lang === "bg" ? b : e);
  const q = typeof args.chain === "string" ? args.chain.trim() : "";
  const hit = CHAIN_MATCH.find((m) => m.re.test(q));
  if (!hit)
    return noData(
      "chainProfile",
      lang === "bg" ? `Няма верига „${q}"` : `No chain "${q}"`,
      { query: q, note: notCpi(lang) },
    );
  const eik = hit.eik;

  // Retail basket + rank IF the chain prices the comparable basket (not all do).
  const chains = await pricePayload<ChainsFile>("chains");
  let basketInfo: {
    chain: string;
    basket: number;
    rank: number;
    total: number;
  } | null = null;
  if (chains) {
    const sorted = [...chains.national].sort((a, b) => a.basket - b.basket);
    const idx = sorted.findIndex((c) => c.eik === eik);
    if (idx >= 0)
      basketInfo = {
        chain: sorted[idx].chain,
        basket: sorted[idx].basket,
        rank: idx + 1,
        total: sorted.length,
      };
  }

  // Money-flows footprint by EIK (procurement won as a state supplier).
  const company = await fetchDb<CompanyLite | null>("company", { eik });
  const proc = company?.procurement;
  const name = basketInfo?.chain ?? company?.company?.name ?? q;

  const rows: Row[] = [];
  if (basketInfo) {
    rows.push({
      metric: T("Кошница", "Basket"),
      value: eur(basketInfo.basket, lang),
    });
    rows.push({
      metric: T("Място по цена", "Rank by price"),
      value: `${basketInfo.rank}/${basketInfo.total}`,
    });
  }
  if (proc && proc.contractCount > 0)
    rows.push({
      metric: T(
        "Обществени поръчки (изпълнител)",
        "Public contracts (supplier)",
      ),
      value: `${proc.contractCount} · ${eur(proc.totalEur, lang)}`,
    });
  if (rows.length === 0)
    rows.push({
      metric: T("Профил", "Profile"),
      value: T(
        "няма съпоставима кошница · не печели поръчки",
        "not in the comparable basket · wins no contracts",
      ),
    });

  return {
    tool: "chainProfile",
    domain: "indicators",
    kind: "table",
    title: name,
    subtitle: basketInfo
      ? T(
          `Търговска верига · кошница ${eur(basketInfo.basket, lang)} · ${basketInfo.rank}-о от ${basketInfo.total}`,
          `Retail chain · basket ${eur(basketInfo.basket, lang)} · #${basketInfo.rank} of ${basketInfo.total}`,
        )
      : T("Търговска верига", "Retail chain"),
    columns: [
      { key: "metric", label: T("Показател", "Metric") },
      { key: "value", label: T("Стойност", "Value"), numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      chain: name,
      eik,
      ...(basketInfo
        ? {
            basket: eur(basketInfo.basket, lang),
            rank_by_price: `${basketInfo.rank}/${basketInfo.total}`,
          }
        : {}),
      ...(proc && proc.contractCount > 0
        ? {
            as_supplier_contracts: proc.contractCount,
            as_supplier_eur: eur(proc.totalEur, lang),
          }
        : {}),
      note: notCpi(lang),
    },
    provenance: ["price_payloads (PG)", "contracts (PG)", PROV],
  };
};
