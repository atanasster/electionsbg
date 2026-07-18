// Self-contained correctness harness for the location-aware promo tools
// (localDeals) + the settlementPrices promo narration. Unlike harness.ts this
// does NOT need local Postgres: it stubs the db fetcher with fixture payloads,
// so it runs anywhere. Run: npx tsx ai/tools/prices_deals.harness.ts
//
// Covers: detectPriceDeal; localDeals scoped to a município (ambient ?area=
// obshtina + ekatte), the uncovered-obshtina → national fallback, and a product
// filter; settlementPrices surfacing on_promo.

import { setFetcher, setDbFetcher } from "./dataClient";
import { localDeals, settlementPrices, detectPriceDeal } from "./prices";
import type { Envelope, ToolContext } from "./types";

// Any fetchData (JSON bucket) call would mean we hit an unstubbed path — fail
// loudly rather than reach the network.
setFetcher(async (p: string) => {
  throw new Error(`unexpected fetchData(${p}) — harness is db-only`);
});

const DICT = {
  source: { name: "КЗП", nameEn: "CPC", url: "https://kolkostruva.bg" },
  latestDate: "2026-07-18",
  baseline: "2026-01-02",
  coverage: { settlements: 245, chains: 10, rows: 1 },
  categories: [{ id: 1, bg: "Мляко и яйца", en: "Dairy" }],
  products: [
    { id: 6, cat: 1, bg: "Прясно мляко", en: "Fresh milk" },
    { id: 42, cat: 1, bg: "Олио", en: "Sunflower oil" },
  ],
  commonBasketSize: 12,
};

const DEALS_MUNI = {
  latestDate: "2026-07-18",
  deals: [
    {
      slug: "kafe-lavaca",
      title: "Кафе Лаваца 250г",
      promo: 4.99,
      reg: 7.49,
      discPct: 33,
      eik: "111",
      chain: "Kaufland",
    },
    {
      slug: "olio-1l",
      title: "Олио 1л",
      promo: 1.79,
      reg: 2.49,
      discPct: 28,
      eik: "222",
      chain: "Lidl",
    },
  ],
};

const DEALS_NAT = {
  latestDate: "2026-07-18",
  deals: [
    {
      slug: "nat-promo",
      title: "Национална оферта",
      promo: 1.0,
      reg: 2.0,
      discPct: 50,
      eik: "333",
      chain: "Billa",
    },
  ],
};

const PLACE_SOF = {
  ekatte: "68134",
  name: "София",
  nameEn: "Sofia",
  obshtina: "SOF46",
  oblast: "S23",
  latestDate: "2026-07-18",
  baselineDate: "2026-01-02",
  basketChangeSinceEuro: 0.036,
  basketChange30d: 0.01,
  basketSeriesWeekly: [
    { d: "2026-01-02", v: 100 },
    { d: "2026-07-18", v: 103.6 },
  ],
  byCategory: [],
  topMovers: {
    up: [{ id: 6, change: 0.1 }],
    down: [{ id: 42, change: -0.05 }],
  },
  products: [
    {
      id: 6,
      min: 1.5,
      avg: 1.7,
      max: 2.0,
      median: 1.6,
      cheapestChain: "Lidl",
      stores: 5,
      promoMin: 1.2,
    },
    {
      id: 42,
      min: 2.4,
      avg: 2.6,
      max: 3.0,
      median: 2.5,
      cheapestChain: "Kaufland",
      stores: 4,
      promoMin: null,
    },
  ],
  rank: {
    basketLevel: 14.15,
    nPriced: 12,
    indexSinceEuro: 103.6,
    change30d: 1,
    rank: { national: 24 },
    rankChange: { national: 5 },
    peers: { national: 28 },
  },
};

setDbFetcher(async (route, params) => {
  if (route !== "price-payload")
    throw new Error(`unexpected db route ${route}`);
  const kind = params.kind;
  const key = params.key;
  if (kind === "dict") return DICT;
  if (kind === "deals") return DEALS_NAT;
  if (kind === "place" && key === "68134") return PLACE_SOF;
  if (kind === "deals-muni" && (key === "PDV01" || key === "SOF46"))
    return DEALS_MUNI;
  if (kind === "deals-muni" && key === "EMPTY") return null; // uncovered
  return null;
});

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
};
const ctx = (area?: string): ToolContext => ({
  lang: "bg",
  election: "2026_04_19",
  area,
});
const factsOf = (e: Envelope) => e.facts ?? {};

const run = async () => {
  // detectPriceDeal
  assert(detectPriceDeal("промоции край мен"), "detectPriceDeal: промоции");
  assert(
    detectPriceDeal("има ли намаления на кафе"),
    "detectPriceDeal: намаления",
  );
  assert(
    !detectPriceDeal("цена на мляко в Пловдив"),
    "detectPriceDeal: plain price is not a deal",
  );

  // localDeals via ambient obshtina
  const d1 = await localDeals({}, ctx("PDV01"));
  assert(
    d1.kind === "table" && (d1.rows?.length ?? 0) === 2,
    "localDeals(area=PDV01): 2 rows",
  );
  assert(
    String(factsOf(d1).scope).includes("район"),
    "localDeals(area): scope = вашия район",
  );
  assert(
    String(factsOf(d1).biggest_discount).includes("−33%"),
    "localDeals: biggest discount −33%",
  );

  // localDeals via ambient ekatte → resolves to obshtina via place shard
  const d2 = await localDeals({}, ctx("68134"));
  assert(
    (d2.rows?.length ?? 0) === 2,
    "localDeals(area=68134 ekatte): resolves to muni deals",
  );

  // uncovered obshtina → national fallback
  const d3 = await localDeals({}, ctx("EMPTY"));
  assert(
    (d3.rows?.length ?? 0) === 1 &&
      String(factsOf(d3).scope).includes("национално"),
    "localDeals: uncovered → national",
  );

  // no area at all → national
  const d4 = await localDeals({}, ctx(undefined));
  assert((d4.rows?.length ?? 0) === 1, "localDeals(no area): national");

  // product filter
  const d5 = await localDeals({ product: "кафе" }, ctx("PDV01"));
  assert(
    (d5.rows?.length ?? 0) === 1,
    "localDeals(product=кафе): filtered to 1",
  );
  const d6 = await localDeals({ product: "несъществуващ" }, ctx("PDV01"));
  assert(d6.kind === "scalar", "localDeals(no match): no-data envelope");

  // settlementPrices on_promo (Sofia path avoids the settlement resolver)
  const s1 = await settlementPrices({ place: "София" }, ctx(undefined));
  assert(!!factsOf(s1).on_promo, "settlementPrices: on_promo present");
  assert(
    String(factsOf(s1).on_promo).includes("Прясно мляко"),
    "settlementPrices: milk on promo",
  );

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  if (failures) process.exit(1);
};

run();
