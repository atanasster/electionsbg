// Fetch Eurostat food Price Level Indices (PLI, EU27=100) and MERGE them into
// data/macro_peers.json as a `foodPli` block. Official cross-country comparison
// from the Eurostat–OECD PPP programme (dataset prc_ppp_ind_1, COICOP 2018) —
// already VAT-handled and quality-adjusted at source, CC-BY 4.0. This is the
// clean EU price comparison for /consumption/eu (cijene.dev was dropped — see
// docs/plans/consumption-hub-v1.md §1).
//
// Targeted: reads the existing macro_peers.json, sets .foodPli, writes back —
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

// COICOP-2018 food categories (ppp_cat18) with curated BG/EN labels — the
// subgroups, plus the "Food" aggregate as the headline.
const CATS: { code: string; bg: string; en: string; agg?: boolean }[] = [
  { code: "A010101", bg: "Храни (общо)", en: "Food (total)", agg: true },
  { code: "A01010101", bg: "Хляб и зърнени", en: "Bread & cereals" },
  { code: "A01010102", bg: "Месо", en: "Meat" },
  { code: "A01010103", bg: "Риба", en: "Fish & seafood" },
  { code: "A01010104", bg: "Мляко, млечни, яйца", en: "Milk, dairy & eggs" },
  { code: "A01010105", bg: "Масла и мазнини", en: "Oils & fats" },
  { code: "A01010106", bg: "Плодове", en: "Fruit & nuts" },
  { code: "A01010107", bg: "Зеленчуци", en: "Vegetables" },
  { code: "A01010108", bg: "Захар и сладки", en: "Sugar & confectionery" },
  { code: "A01010109", bg: "Готови храни", en: "Ready-made food" },
  { code: "A010102", bg: "Безалкохолни", en: "Non-alcoholic beverages" },
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

const main = async () => {
  const years = ["2024", "2023"]; // prefer 2024, fall back to 2023 per cell
  const params = new URLSearchParams();
  params.set("format", "JSON");
  params.set("lang", "EN");
  params.set("indic_ppp", "PLI_EU27_2020");
  for (const g of GEOS) params.append("geo", EUROSTAT_GEO(g));
  for (const c of CATS) params.append("ppp_cat18", c.code);
  for (const y of years) params.append("time", y);

  const url = `${BASE}/prc_ppp_ind_1?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Eurostat ${res.status} ${res.statusText}`);
  const j = (await res.json()) as JsonStat;
  const get = makeGetter(j);

  // Determine the newest year that actually carries BG food data.
  const yearOf = (): string => {
    for (const y of years)
      if (
        get({
          freq: "A",
          indic_ppp: "PLI_EU27_2020",
          ppp_cat18: "A010101",
          geo: "BG",
          time: y,
        }) != null
      )
        return y;
    return years[years.length - 1];
  };
  const year = yearOf();

  const values: Record<string, Record<string, number>> = {};
  for (const g of GEOS) {
    const row: Record<string, number> = {};
    for (const c of CATS) {
      // prefer the chosen year, fall back to the older one if a cell is missing
      let v: number | undefined;
      for (const y of [year, ...years]) {
        v = get({
          freq: "A",
          indic_ppp: "PLI_EU27_2020",
          ppp_cat18: c.code,
          geo: EUROSTAT_GEO(g),
          time: y,
        });
        if (v != null) break;
      }
      if (v != null) row[c.code] = v;
    }
    if (Object.keys(row).length > 0) values[g] = row;
  }

  const foodPli = {
    source: "Eurostat prc_ppp_ind_1 (PPP programme, EU27=100)",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/product/view/prc_ppp_ind_1",
    year: Number(year),
    baseline: "EU27_2020",
    geos: GEOS.filter((g) => values[g]),
    categories: CATS,
    values,
  };

  const peers = JSON.parse(fs.readFileSync(OUT, "utf8"));
  peers.foodPli = foodPli;
  // Match fetch_eu_peers' 2-space pretty-print so the diff is only the new block.
  fs.writeFileSync(OUT, JSON.stringify(peers, null, 2));
  console.log(
    `foodPli merged into ${OUT}: year ${year}, ${foodPli.geos.length} geos, ${CATS.length} categories.`,
  );
  console.log("BG food (total) PLI:", values.BG?.A010101);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
