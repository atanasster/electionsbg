// Fetch Eurostat Price Level Indices (PLI, EU27=100) for the FULL household
// consumption basket and MERGE them into data/macro_peers.json as a `pricePli`
// block. Official cross-country comparison from the Eurostat–OECD PPP programme
// (dataset prc_ppp_ind_1, COICOP 2018) — already VAT-handled and quality-adjusted
// at source, CC-BY 4.0. This powers the /consumption/eu "Цените спрямо ЕС" page
// (formerly food-only; cijene.dev was dropped — see docs/plans/consumption-hub-v1.md §1).
//
// Emits three things in one block:
//   • values  — PLI (EU27=100) per COICOP category: the headline "actual individual
//               consumption" (A01), the 12 divisions under it, and the food detail.
//   • volumes — VI_PPS_EU27_2020_HAB (real per-capita consumption volume, EU=100):
//               the income-adjusted counterpoint ("cheap prices, but how much do
//               people actually consume?"). Fetched for A01 + the divisions.
//   • trend   — the A01 price-level series since 2010 for BG + neighbour peers, so
//               the page can show price CONVERGENCE toward the EU average over time.
//
// Targeted: reads the existing macro_peers.json, sets .pricePli, writes back —
// does NOT re-run the whole peer fetch. Run: `npx tsx scripts/macro/fetch_food_pli.ts`.

import fs from "node:fs";
import path from "node:path";

const BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const OUT = path.resolve("data/macro_peers.json");

// Peer roster (mirrors fetch_eu_peers). EU27_2020 = the 100 baseline.
const GEOS = [
  "BG",
  "EU27_2020",
  "RO",
  "GR",
  "HU",
  "HR",
  "PL",
  "DE",
  "AT",
] as const;

// Neighbour peers shown in the convergence trend (kept small for readability).
const TREND_GEOS = ["BG", "RO", "GR", "HU", "HR"] as const;
const TREND_FROM = 2010;

// COICOP-2018 categories (ppp_cat18) with curated BG/EN labels.
//   kind: "headline" = actual individual consumption (the overall price level)
//         "division" = a top-level COICOP division (the main basket bars)
//         "food"     = the expandable food-detail rows under the food division
type Kind = "headline" | "division" | "food";
const CATS: {
  code: string;
  bg: string;
  en: string;
  kind: Kind;
  /** parent category code (for the food detail rows). */
  parent?: string;
}[] = [
  // Headline — overall consumption price level.
  {
    code: "A01",
    bg: "Потребление (общо)",
    en: "Consumption (overall)",
    kind: "headline",
  },
  // The 12 divisions under actual individual consumption.
  {
    code: "A0101",
    bg: "Храни и безалкохолни",
    en: "Food & non-alcoholic drinks",
    kind: "division",
  },
  {
    code: "A0102",
    bg: "Алкохол и тютюн",
    en: "Alcohol & tobacco",
    kind: "division",
  },
  {
    code: "A0103",
    bg: "Облекло и обувки",
    en: "Clothing & footwear",
    kind: "division",
  },
  {
    code: "A0104",
    bg: "Жилище, вода, енергия",
    en: "Housing, water, energy",
    kind: "division",
  },
  {
    code: "A0105",
    bg: "Обзавеждане и уреди",
    en: "Furnishings & household",
    kind: "division",
  },
  { code: "A0106", bg: "Здраве", en: "Health", kind: "division" },
  { code: "A0107", bg: "Транспорт", en: "Transport", kind: "division" },
  {
    code: "A0108",
    bg: "Съобщения",
    en: "Information & communication",
    kind: "division",
  },
  {
    code: "A0109",
    bg: "Развлечения и култура",
    en: "Recreation & culture",
    kind: "division",
  },
  { code: "A0110", bg: "Образование", en: "Education", kind: "division" },
  {
    code: "A0111",
    bg: "Ресторанти и хотели",
    en: "Restaurants & hotels",
    kind: "division",
  },
  {
    code: "A0112",
    bg: "Други стоки и услуги",
    en: "Miscellaneous goods & services",
    kind: "division",
  },
  // Food detail — expandable under the "Храни и безалкохолни" division. A010101
  // ("Food") is kept for the consumption-hub "food vs EU" stat, read by
  // ConsumptionEuScreen.tsx, ConsumptionScreen.tsx and PricesScreen.tsx.
  {
    code: "A010101",
    bg: "Храни (общо)",
    en: "Food (total)",
    kind: "food",
    parent: "A0101",
  },
  {
    code: "A01010101",
    bg: "Хляб и зърнени",
    en: "Bread & cereals",
    kind: "food",
    parent: "A0101",
  },
  { code: "A01010102", bg: "Месо", en: "Meat", kind: "food", parent: "A0101" },
  {
    code: "A01010103",
    bg: "Риба",
    en: "Fish & seafood",
    kind: "food",
    parent: "A0101",
  },
  {
    code: "A01010104",
    bg: "Мляко, млечни, яйца",
    en: "Milk, dairy & eggs",
    kind: "food",
    parent: "A0101",
  },
  {
    code: "A01010105",
    bg: "Масла и мазнини",
    en: "Oils & fats",
    kind: "food",
    parent: "A0101",
  },
  {
    code: "A01010106",
    bg: "Плодове",
    en: "Fruit & nuts",
    kind: "food",
    parent: "A0101",
  },
  {
    code: "A01010107",
    bg: "Зеленчуци",
    en: "Vegetables",
    kind: "food",
    parent: "A0101",
  },
  {
    code: "A01010108",
    bg: "Захар и сладки",
    en: "Sugar & confectionery",
    kind: "food",
    parent: "A0101",
  },
  {
    code: "A01010109",
    bg: "Готови храни",
    en: "Ready-made food",
    kind: "food",
    parent: "A0101",
  },
  {
    code: "A010102",
    bg: "Безалкохолни",
    en: "Non-alcoholic beverages",
    kind: "food",
    parent: "A0101",
  },
];

// Divisions that also carry a per-capita real-consumption volume (VI_PPS_HAB).
const VOLUME_CODES = [
  "A01",
  ...CATS.filter((c) => c.kind === "division").map((c) => c.code),
];

// Eurostat codes Greece as "EL"; the rest of the app uses ISO "GR". Query with
// EL, store under GR (mirrors fetch_eu_peers' EUROSTAT_GEO_FOR).
const EUROSTAT_GEO = (g: string): string => (g === "GR" ? "EL" : g);

interface JsonStat {
  id: string[];
  size: number[];
  value: Record<string, number>;
  dimension: Record<string, { category: { index: Record<string, number> } }>;
}

// A getter over a JSON-stat 2.0 response: coords {dim: code} → value | undefined.
const makeGetter = (j: JsonStat) => {
  const strides = new Array(j.id.length).fill(1);
  for (let i = j.id.length - 2; i >= 0; i--)
    strides[i] = strides[i + 1] * j.size[i + 1];
  const idx = j.id.map((d) => j.dimension[d].category.index);
  return (coords: Record<string, string>): number | undefined => {
    let flat = 0;
    for (let i = 0; i < j.id.length; i++) {
      const pos = idx[i][coords[j.id[i]]];
      if (pos == null) return undefined;
      flat += pos * strides[i];
    }
    return j.value[String(flat)];
  };
};

const fetchJsonStat = async (url: string): Promise<JsonStat> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Eurostat ${res.status} ${res.statusText}`);
  return (await res.json()) as JsonStat;
};

const main = async () => {
  // Candidate years, newest-first, derived from the current year so the window
  // self-advances when Eurostat publishes a new PLI vintage (~June annually) —
  // a hardcoded list would silently serve a year-old figure. The per-cell
  // `years.find(...)` fallback below handles the not-yet-published newest year.
  const nowY = new Date().getFullYear();
  const years = [nowY, nowY - 1, nowY - 2, nowY - 3].map(String);

  // --- 1. Price level indices (PLI) for the whole basket -------------------
  const pliParams = new URLSearchParams();
  pliParams.set("format", "JSON");
  pliParams.set("lang", "EN");
  pliParams.set("indic_ppp", "PLI_EU27_2020");
  for (const g of GEOS) pliParams.append("geo", EUROSTAT_GEO(g));
  for (const c of CATS) pliParams.append("ppp_cat18", c.code);
  for (const y of years) pliParams.append("time", y);
  const jPli = await fetchJsonStat(
    `${BASE}/prc_ppp_ind_1?${pliParams.toString()}`,
  );
  const getPli = makeGetter(jPli);

  // Newest year that actually carries BG headline data.
  const year =
    years.find(
      (y) =>
        getPli({
          freq: "A",
          indic_ppp: "PLI_EU27_2020",
          ppp_cat18: "A01",
          geo: "BG",
          time: y,
        }) != null,
    ) ?? years[years.length - 1];

  // Prefer the resolved headline `year` so the page reads one consistent vintage,
  // then fall back to the remaining years newest-first. `year` is dropped from the
  // tail so it is not probed twice.
  const yearOrder = [year, ...years.filter((y) => y !== year)];
  const cellPli = (geo: string, code: string): number | undefined => {
    for (const y of yearOrder) {
      const v = getPli({
        freq: "A",
        indic_ppp: "PLI_EU27_2020",
        ppp_cat18: code,
        geo: EUROSTAT_GEO(geo),
        time: y,
      });
      if (v != null) return v;
    }
    return undefined;
  };

  const values: Record<string, Record<string, number>> = {};
  for (const g of GEOS) {
    const row: Record<string, number> = {};
    for (const c of CATS) {
      const v = cellPli(g, c.code);
      if (v != null) row[c.code] = v;
    }
    if (Object.keys(row).length > 0) values[g] = row;
  }

  // --- 2. Real per-capita consumption volume (VI_PPS_HAB, EU=100) ----------
  const volParams = new URLSearchParams();
  volParams.set("format", "JSON");
  volParams.set("lang", "EN");
  volParams.set("indic_ppp", "VI_PPS_EU27_2020_HAB");
  for (const g of GEOS) volParams.append("geo", EUROSTAT_GEO(g));
  for (const c of VOLUME_CODES) volParams.append("ppp_cat18", c);
  for (const y of years) volParams.append("time", y);
  const jVol = await fetchJsonStat(
    `${BASE}/prc_ppp_ind_1?${volParams.toString()}`,
  );
  const getVol = makeGetter(jVol);
  const cellVol = (geo: string, code: string): number | undefined => {
    for (const y of yearOrder) {
      const v = getVol({
        freq: "A",
        indic_ppp: "VI_PPS_EU27_2020_HAB",
        ppp_cat18: code,
        geo: EUROSTAT_GEO(geo),
        time: y,
      });
      if (v != null) return v;
    }
    return undefined;
  };
  const volumes: Record<string, Record<string, number>> = {};
  for (const g of GEOS) {
    const row: Record<string, number> = {};
    for (const c of VOLUME_CODES) {
      const v = cellVol(g, c);
      if (v != null) row[c] = v;
    }
    if (Object.keys(row).length > 0) volumes[g] = row;
  }

  // --- 3. Convergence trend: A01 price level since 2010 --------------------
  const trendParams = new URLSearchParams();
  trendParams.set("format", "JSON");
  trendParams.set("lang", "EN");
  trendParams.set("indic_ppp", "PLI_EU27_2020");
  trendParams.set("ppp_cat18", "A01");
  for (const g of TREND_GEOS) trendParams.append("geo", EUROSTAT_GEO(g));
  const jTrend = await fetchJsonStat(
    `${BASE}/prc_ppp_ind_1?${trendParams.toString()}`,
  );
  const getTrend = makeGetter(jTrend);
  const trendYears: number[] = [];
  for (let y = TREND_FROM; y <= Number(year); y++) {
    const has = TREND_GEOS.some(
      (g) =>
        getTrend({
          freq: "A",
          indic_ppp: "PLI_EU27_2020",
          ppp_cat18: "A01",
          geo: EUROSTAT_GEO(g),
          time: String(y),
        }) != null,
    );
    if (has) trendYears.push(y);
  }
  const trendValues: Record<string, (number | null)[]> = {};
  for (const g of TREND_GEOS) {
    const row = trendYears.map(
      (y) =>
        getTrend({
          freq: "A",
          indic_ppp: "PLI_EU27_2020",
          ppp_cat18: "A01",
          geo: EUROSTAT_GEO(g),
          time: String(y),
        }) ?? null,
    );
    if (row.some((v) => v != null)) trendValues[g] = row;
  }

  const pricePli = {
    source: "Eurostat prc_ppp_ind_1 (PPP programme, EU27=100)",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/product/view/prc_ppp_ind_1",
    year: Number(year),
    baseline: "EU27_2020",
    geos: GEOS.filter((g) => values[g]),
    categories: CATS,
    values,
    volumes,
    trend: { years: trendYears, values: trendValues },
  };

  const peers = JSON.parse(fs.readFileSync(OUT, "utf8"));
  peers.pricePli = pricePli;
  delete peers.foodPli; // superseded by the full-basket block
  // Match fetch_eu_peers' 2-space pretty-print so the diff is only the new block.
  fs.writeFileSync(OUT, JSON.stringify(peers, null, 2));
  console.log(
    `pricePli merged into ${OUT}: year ${year}, ${pricePli.geos.length} geos, ${CATS.length} categories.`,
  );
  console.log(
    "BG overall PLI:",
    values.BG?.A01,
    "· BG real consumption/capita (EU=100):",
    volumes.BG?.A01,
    "· trend years:",
    trendYears.length,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
