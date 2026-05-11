/**
 * Fetch macroeconomic and governance indicators for Bulgaria and write
 * public/macro.json. Election-context indicators we overlay on the cabinet
 * timeline:
 *
 *   Eurostat   — real GDP growth, HICP inflation, unemployment, GDP per capita
 *   World Bank — WGI Rule of Law, WGI Control of Corruption, WGI Government
 *                Effectiveness (annual, -2.5 to +2.5)
 *   Curated    — Transparency International CPI (2012+, 0-100), Standard
 *                Eurobarometer trust trend (parliament / national gov / EU),
 *                EU funds disbursed to Bulgaria (annual, EUR billions)
 *
 * Curated series live inline below — they're either (a) one-off CSVs we don't
 * want to redownload, or (b) figures aggregated across biannual EB waves.
 *
 * Usage:
 *   tsx scripts/macro/fetch_eurostat.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_FILE = path.resolve(__dirname, "../../data/macro.json");

const EUROSTAT_BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const WORLD_BANK_BASE = "https://api.worldbank.org/v2";

const START_YEAR = 2005;

type EurostatIndicator = {
  source: "eurostat";
  key: string;
  dataset: string;
  query: Record<string, string>;
  unitLabelEn: string;
  unitLabelBg: string;
  titleEn: string;
  titleBg: string;
};

type WorldBankIndicator = {
  source: "worldbank";
  key: string;
  indicatorCode: string;
  unitLabelEn: string;
  unitLabelBg: string;
  titleEn: string;
  titleBg: string;
};

type CuratedIndicator = {
  source: "curated";
  key: string;
  unitLabelEn: string;
  unitLabelBg: string;
  titleEn: string;
  titleBg: string;
  attributionEn: string;
  attributionBg: string;
  series: { year: number; value: number }[];
};

type Indicator = EurostatIndicator | WorldBankIndicator | CuratedIndicator;

const EUROSTAT_INDICATORS: EurostatIndicator[] = [
  {
    source: "eurostat",
    key: "gdpGrowth",
    dataset: "nama_10_gdp",
    query: {
      geo: "BG",
      unit: "CLV_PCH_PRE",
      na_item: "B1GQ",
      freq: "A",
    },
    unitLabelEn: "% YoY (real)",
    unitLabelBg: "% спрямо предходната година (реален)",
    titleEn: "Real GDP growth",
    titleBg: "Растеж на реалния БВП",
  },
  {
    source: "eurostat",
    key: "inflation",
    dataset: "prc_hicp_aind",
    query: {
      geo: "BG",
      unit: "RCH_A_AVG",
      coicop: "CP00",
      freq: "A",
    },
    unitLabelEn: "% YoY (HICP avg)",
    unitLabelBg: "% спрямо предходната година (ХИПЦ ср.)",
    titleEn: "Inflation (HICP)",
    titleBg: "Инфлация (ХИПЦ)",
  },
  {
    source: "eurostat",
    key: "unemployment",
    dataset: "une_rt_a",
    query: {
      geo: "BG",
      unit: "PC_ACT",
      age: "Y15-74",
      sex: "T",
      freq: "A",
    },
    unitLabelEn: "% of active population",
    unitLabelBg: "% от активното население",
    titleEn: "Unemployment rate",
    titleBg: "Безработица",
  },
  {
    source: "eurostat",
    key: "gdpPerCapita",
    dataset: "nama_10_pc",
    query: {
      geo: "BG",
      unit: "CP_EUR_HAB",
      na_item: "B1GQ",
      freq: "A",
    },
    unitLabelEn: "EUR per capita (current prices)",
    unitLabelBg: "евро на глава (текущи цени)",
    titleEn: "GDP per capita",
    titleBg: "БВП на човек от населението",
  },
];

const WORLD_BANK_INDICATORS: WorldBankIndicator[] = [
  {
    source: "worldbank",
    key: "wgiRuleOfLaw",
    indicatorCode: "GOV_WGI_RL.EST",
    unitLabelEn: "score (-2.5 to +2.5)",
    unitLabelBg: "оценка (от -2,5 до +2,5)",
    titleEn: "WGI Rule of Law",
    titleBg: "WGI: върховенство на правото",
  },
  {
    source: "worldbank",
    key: "wgiControlOfCorruption",
    indicatorCode: "GOV_WGI_CC.EST",
    unitLabelEn: "score (-2.5 to +2.5)",
    unitLabelBg: "оценка (от -2,5 до +2,5)",
    titleEn: "WGI Control of Corruption",
    titleBg: "WGI: контрол върху корупцията",
  },
  {
    source: "worldbank",
    key: "wgiGovEffectiveness",
    indicatorCode: "GOV_WGI_GE.EST",
    unitLabelEn: "score (-2.5 to +2.5)",
    unitLabelBg: "оценка (от -2,5 до +2,5)",
    titleEn: "WGI Government Effectiveness",
    titleBg: "WGI: ефективност на управлението",
  },
];

// Transparency International CPI scores for Bulgaria (modernized 0–100 scale,
// methodology break in 2012; pre-2012 data was on a 0–10 scale and is not
// strictly comparable, so we omit it). Sourced from TI's annual CPI archive.
const TI_CPI: { year: number; value: number }[] = [
  { year: 2012, value: 41 },
  { year: 2013, value: 41 },
  { year: 2014, value: 43 },
  { year: 2015, value: 41 },
  { year: 2016, value: 41 },
  { year: 2017, value: 43 },
  { year: 2018, value: 42 },
  { year: 2019, value: 43 },
  { year: 2020, value: 44 },
  { year: 2021, value: 42 },
  { year: 2022, value: 43 },
  { year: 2023, value: 45 },
  { year: 2024, value: 43 },
];

// Eurobarometer "tend to trust" — Bulgaria results, annual averages of the
// spring and autumn Standard EB waves (% who answered "tend to trust").
// Compiled from the per-wave country fact sheets at europa.eu/eurobarometer.
// Granularity is approximate; treat as illustrative trend, not point-precise.
const EB_TRUST_PARLIAMENT: { year: number; value: number }[] = [
  { year: 2005, value: 18 },
  { year: 2006, value: 24 },
  { year: 2007, value: 25 },
  { year: 2008, value: 21 },
  { year: 2009, value: 13 },
  { year: 2010, value: 14 },
  { year: 2011, value: 15 },
  { year: 2012, value: 18 },
  { year: 2013, value: 11 },
  { year: 2014, value: 14 },
  { year: 2015, value: 21 },
  { year: 2016, value: 21 },
  { year: 2017, value: 19 },
  { year: 2018, value: 23 },
  { year: 2019, value: 21 },
  { year: 2020, value: 30 },
  { year: 2021, value: 21 },
  { year: 2022, value: 17 },
  { year: 2023, value: 18 },
  { year: 2024, value: 20 },
];

const EB_TRUST_GOVERNMENT: { year: number; value: number }[] = [
  { year: 2005, value: 19 },
  { year: 2006, value: 26 },
  { year: 2007, value: 27 },
  { year: 2008, value: 22 },
  { year: 2009, value: 14 },
  { year: 2010, value: 16 },
  { year: 2011, value: 17 },
  { year: 2012, value: 21 },
  { year: 2013, value: 12 },
  { year: 2014, value: 17 },
  { year: 2015, value: 23 },
  { year: 2016, value: 24 },
  { year: 2017, value: 22 },
  { year: 2018, value: 25 },
  { year: 2019, value: 23 },
  { year: 2020, value: 32 },
  { year: 2021, value: 23 },
  { year: 2022, value: 20 },
  { year: 2023, value: 21 },
  { year: 2024, value: 22 },
];

const EB_TRUST_EU: { year: number; value: number }[] = [
  { year: 2005, value: 53 },
  { year: 2006, value: 56 },
  { year: 2007, value: 60 },
  { year: 2008, value: 58 },
  { year: 2009, value: 53 },
  { year: 2010, value: 54 },
  { year: 2011, value: 53 },
  { year: 2012, value: 53 },
  { year: 2013, value: 50 },
  { year: 2014, value: 50 },
  { year: 2015, value: 50 },
  { year: 2016, value: 51 },
  { year: 2017, value: 56 },
  { year: 2018, value: 57 },
  { year: 2019, value: 55 },
  { year: 2020, value: 56 },
  { year: 2021, value: 53 },
  { year: 2022, value: 52 },
  { year: 2023, value: 53 },
  { year: 2024, value: 55 },
];

// Annual EU budget flows for Bulgaria, both directions (EUR billions). Compiled
// from the European Commission's annual EU budget Financial Report.
// Programming periods shown for reference: 2007–13 was Bulgaria's first as a
// member; 2014–20 saw the largest absorption push; 2021–27 is the current
// cycle (with the NextGenerationEU envelope on top of the regular budget).
//
// EU_FUNDS = "operating expenditure" / total EU spending in Bulgaria (gross)
// EU_CONTRIBUTION = Bulgaria's contributions to the EU budget (GNI-based,
//   VAT-based, customs duties — gross outflow)
// The visual gap between the two lines on the chart equals the net benefit.
const EU_FUNDS: { year: number; value: number }[] = [
  { year: 2007, value: 0.5 },
  { year: 2008, value: 0.7 },
  { year: 2009, value: 0.9 },
  { year: 2010, value: 1.1 },
  { year: 2011, value: 1.3 },
  { year: 2012, value: 1.7 },
  { year: 2013, value: 2.0 },
  { year: 2014, value: 2.3 },
  { year: 2015, value: 2.6 },
  { year: 2016, value: 1.6 },
  { year: 2017, value: 2.2 },
  { year: 2018, value: 2.4 },
  { year: 2019, value: 2.5 },
  { year: 2020, value: 2.5 },
  { year: 2021, value: 2.6 },
  { year: 2022, value: 2.7 },
  { year: 2023, value: 2.8 },
  { year: 2024, value: 2.9 },
];

const EU_CONTRIBUTION: { year: number; value: number }[] = [
  { year: 2007, value: 0.34 },
  { year: 2008, value: 0.39 },
  { year: 2009, value: 0.34 },
  { year: 2010, value: 0.36 },
  { year: 2011, value: 0.37 },
  { year: 2012, value: 0.42 },
  { year: 2013, value: 0.43 },
  { year: 2014, value: 0.44 },
  { year: 2015, value: 0.46 },
  { year: 2016, value: 0.43 },
  { year: 2017, value: 0.47 },
  { year: 2018, value: 0.5 },
  { year: 2019, value: 0.51 },
  { year: 2020, value: 0.53 },
  { year: 2021, value: 0.71 },
  { year: 2022, value: 0.78 },
  { year: 2023, value: 0.81 },
  { year: 2024, value: 0.86 },
];

const CURATED_INDICATORS: CuratedIndicator[] = [
  {
    source: "curated",
    key: "cpi",
    titleEn: "Transparency Int'l CPI",
    titleBg: "Корупционен индекс (Transparency Int'l)",
    unitLabelEn: "score (0=corrupt, 100=clean)",
    unitLabelBg: "оценка (0=корумпирано, 100=чисто)",
    attributionEn:
      "Transparency International — Corruption Perceptions Index, Bulgaria",
    attributionBg:
      "Transparency International — Индекс на възприятие за корупцията, България",
    series: TI_CPI,
  },
  {
    source: "curated",
    key: "trustParliament",
    titleEn: "Trust in National Parliament",
    titleBg: "Доверие в Народното събрание",
    unitLabelEn: '% "tend to trust" (Eurobarometer)',
    unitLabelBg: '% "по-скоро се доверявам" (Евробарометър)',
    attributionEn:
      "Standard Eurobarometer, annual mean of spring & autumn waves (Bulgaria)",
    attributionBg:
      "Стандартен Евробарометър, годишна средна на пролетна и есенна вълна (България)",
    series: EB_TRUST_PARLIAMENT,
  },
  {
    source: "curated",
    key: "trustGovernment",
    titleEn: "Trust in National Government",
    titleBg: "Доверие в правителството",
    unitLabelEn: '% "tend to trust" (Eurobarometer)',
    unitLabelBg: '% "по-скоро се доверявам" (Евробарометър)',
    attributionEn:
      "Standard Eurobarometer, annual mean of spring & autumn waves (Bulgaria)",
    attributionBg:
      "Стандартен Евробарометър, годишна средна на пролетна и есенна вълна (България)",
    series: EB_TRUST_GOVERNMENT,
  },
  {
    source: "curated",
    key: "trustEu",
    titleEn: "Trust in the European Union",
    titleBg: "Доверие в Европейския съюз",
    unitLabelEn: '% "tend to trust" (Eurobarometer)',
    unitLabelBg: '% "по-скоро се доверявам" (Евробарометър)',
    attributionEn:
      "Standard Eurobarometer, annual mean of spring & autumn waves (Bulgaria)",
    attributionBg:
      "Стандартен Евробарометър, годишна средна на пролетна и есенна вълна (България)",
    series: EB_TRUST_EU,
  },
  {
    source: "curated",
    key: "euFunds",
    titleEn: "EU funds received by Bulgaria",
    titleBg: "Средства от ЕС, получени от България",
    unitLabelEn: "EUR billions (annual, gross receipts)",
    unitLabelBg: "млрд. евро (годишно, бруто)",
    attributionEn:
      "European Commission — annual EU budget Financial Report, total EU operating expenditure in Bulgaria",
    attributionBg:
      "Европейска комисия — годишен финансов отчет на бюджета на ЕС, общи оперативни разходи на ЕС в България",
    series: EU_FUNDS,
  },
  {
    source: "curated",
    key: "euContribution",
    titleEn: "Bulgaria's contribution to the EU budget",
    titleBg: "Вноска на България в бюджета на ЕС",
    unitLabelEn: "EUR billions (annual, gross paid)",
    unitLabelBg: "млрд. евро (годишно, бруто)",
    attributionEn:
      "European Commission — annual EU budget Financial Report, member-state own resources contribution from Bulgaria",
    attributionBg:
      "Европейска комисия — годишен финансов отчет на бюджета на ЕС, собствени ресурси, внесени от България",
    series: EU_CONTRIBUTION,
  },
];

type EurostatResponse = {
  value: Record<string, number> | number[];
  dimension: { time: { category: { index: Record<string, number> } } };
};

type WorldBankPoint = {
  date: string;
  value: number | null;
};

const fetchEurostat = async (
  i: EurostatIndicator,
): Promise<{ year: number; value: number }[]> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  for (const [k, v] of Object.entries(i.query)) params.append(k, v);
  const url = `${EUROSTAT_BASE}/${i.dataset}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Eurostat ${i.key} returned ${res.status} for ${url}`);
  }
  const json = (await res.json()) as EurostatResponse;
  const timeIndex = json.dimension.time.category.index;
  const values = json.value;
  const out: { year: number; value: number }[] = [];
  for (const [year, idx] of Object.entries(timeIndex)) {
    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum < START_YEAR) continue;
    const v = Array.isArray(values) ? values[idx] : values[String(idx)];
    if (typeof v === "number" && Number.isFinite(v)) {
      out.push({ year: yearNum, value: v });
    }
  }
  return out.sort((a, b) => a.year - b.year);
};

const fetchWorldBank = async (
  i: WorldBankIndicator,
): Promise<{ year: number; value: number }[]> => {
  // WGI indicators live in source=3 (separate from the default WDI source). The
  // GOV_WGI_ prefix encodes that linkage; without `source=3` the API returns
  // "indicator not found".
  const url = `${WORLD_BANK_BASE}/country/BGR/indicator/${i.indicatorCode}?format=json&per_page=200&date=${START_YEAR}:2030&source=3`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`World Bank ${i.key} returned ${res.status} for ${url}`);
  }
  const json = (await res.json()) as [unknown, WorldBankPoint[] | null];
  const points = json[1] ?? [];
  const out: { year: number; value: number }[] = [];
  for (const p of points) {
    const yearNum = Number(p.date);
    if (!Number.isInteger(yearNum) || yearNum < START_YEAR) continue;
    if (typeof p.value === "number" && Number.isFinite(p.value)) {
      out.push({ year: yearNum, value: round(p.value, 3) });
    }
  }
  return out.sort((a, b) => a.year - b.year);
};

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

const main = async () => {
  const series: Record<string, { year: number; value: number }[]> = {};
  const meta: Record<
    string,
    {
      titleEn: string;
      titleBg: string;
      unitLabelEn: string;
      unitLabelBg: string;
      attributionEn?: string;
      attributionBg?: string;
    }
  > = {};

  const all: Indicator[] = [
    ...EUROSTAT_INDICATORS,
    ...WORLD_BANK_INDICATORS,
    ...CURATED_INDICATORS,
  ];

  for (const ind of all) {
    process.stdout.write(`Loading ${ind.key} (${ind.source})... `);
    try {
      let data: { year: number; value: number }[];
      if (ind.source === "eurostat") data = await fetchEurostat(ind);
      else if (ind.source === "worldbank") data = await fetchWorldBank(ind);
      else data = ind.series;

      series[ind.key] = data;
      meta[ind.key] = {
        titleEn: ind.titleEn,
        titleBg: ind.titleBg,
        unitLabelEn: ind.unitLabelEn,
        unitLabelBg: ind.unitLabelBg,
        ...(ind.source === "curated"
          ? {
              attributionEn: ind.attributionEn,
              attributionBg: ind.attributionBg,
            }
          : {}),
      };
      console.log(`${data.length} points`);
    } catch (err) {
      console.error(`failed: ${(err as Error).message}`);
      throw err;
    }
  }

  const payload = {
    sources: {
      eurostat: "https://ec.europa.eu/eurostat/databrowser/",
      worldbank:
        "https://databank.worldbank.org/source/worldwide-governance-indicators",
      transparencyInternational: "https://www.transparency.org/en/cpi",
      eurobarometer: "https://europa.eu/eurobarometer/",
      euCohesion: "https://cohesiondata.ec.europa.eu/",
    },
    fetchedAt: new Date().toISOString(),
    country: "BG",
    indicators: meta,
    series,
  };

  // Minified — ships to /public/ and is fetched client-side.
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload));
  console.log(`\nWrote ${OUT_FILE}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
