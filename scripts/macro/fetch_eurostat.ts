/**
 * Fetch macroeconomic and governance indicators for Bulgaria and write
 * data/macro.json. Election-context indicators we overlay on the cabinet
 * timeline:
 *
 *   Eurostat   — quarterly: real GDP growth, HICP inflation, unemployment,
 *                gov debt, budget balance, current account
 *                annual: GDP per capita
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

// Absolute floors per cadence. A fetched series shorter than this is treated
// as a catastrophic upstream-query failure (mass-NULL response, dimension
// rejection, etc.) and the run is aborted. Per-indicator overrides via
// `minPoints` on the indicator entry. Floors are conservative — well below
// what every current indicator produces on a healthy day.
const MIN_POINTS_QUARTERLY = 60; // ~15 years of quarterly data
const MIN_POINTS_ANNUAL = 12; // ~12 years
// Regression threshold: if a series shrinks by more than this fraction
// compared to the previously-committed data/macro.json, abort. Catches the
// "filter narrowed silently" case the SKILL.md describes.
const REGRESSION_THRESHOLD = 0.1; // 10% drop = trip

const EUROSTAT_BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const WORLD_BANK_BASE = "https://api.worldbank.org/v2";

const START_YEAR = 2005;

type Cadence = "annual" | "quarterly";

// Quarterly-equivalent representation. Annual points omit `quarter`/`period`;
// quarterly points carry both. Existing consumers that read only {year,value}
// keep working — `year` is the calendar year on quarterly points too.
type MacroPoint = {
  year: number;
  value: number;
  quarter?: 1 | 2 | 3 | 4;
  period?: string;
};

type EurostatIndicator = {
  source: "eurostat";
  key: string;
  dataset: string;
  query: Record<string, string>;
  cadence: Cadence;
  // Set on indicators where the upstream dataset is monthly but we want
  // quarterly cadence on the chart. We bucket the 3 months into one
  // quarterly point (mean) and drop any incomplete trailing quarter.
  aggregate?: "monthlyAvgToQuarter";
  // Optional post-processing: convert a series of absolute values into
  // year-on-year % change. Useful when the upstream publishes a level
  // (e.g. real compensation in chain-linked EUR) and we want growth.
  // Drops the first 4 quarters / 1 year (no comparison available).
  derive?: "yoyGrowth";
  // Optional per-indicator minimum point count. If the fetch returns fewer,
  // the script throws — catches catastrophic upstream-query mass-failure.
  // Defaults to MIN_POINTS_QUARTERLY / MIN_POINTS_ANNUAL based on cadence.
  minPoints?: number;
  sourceUrl: string;
  unitLabelEn: string;
  unitLabelBg: string;
  titleEn: string;
  titleBg: string;
};

type WorldBankIndicator = {
  source: "worldbank";
  key: string;
  indicatorCode: string;
  cadence: Cadence;
  minPoints?: number;
  sourceUrl: string;
  unitLabelEn: string;
  unitLabelBg: string;
  titleEn: string;
  titleBg: string;
};

type CuratedIndicator = {
  source: "curated";
  key: string;
  cadence: Cadence;
  sourceUrl?: string;
  unitLabelEn: string;
  unitLabelBg: string;
  titleEn: string;
  titleBg: string;
  attributionEn: string;
  attributionBg: string;
  series: MacroPoint[];
};

type Indicator = EurostatIndicator | WorldBankIndicator | CuratedIndicator;

const EUROSTAT_INDICATORS: EurostatIndicator[] = [
  {
    source: "eurostat",
    key: "gdpGrowth",
    dataset: "namq_10_gdp",
    // Quarterly YoY (% change vs same period of previous year), seasonally and
    // calendar adjusted — the convention quarterly growth is normally reported
    // in. Less seasonal noise than QoQ; comparable in magnitude to the prior
    // annual series.
    query: {
      geo: "BG",
      unit: "CLV_PCH_SM",
      na_item: "B1GQ",
      s_adj: "SCA",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/namq_10_gdp/default/table",
    unitLabelEn: "% YoY (real, SCA)",
    unitLabelBg: "% спрямо същия период предходна година (реален, SCA)",
    titleEn: "Real GDP growth",
    titleBg: "Растеж на реалния БВП",
  },
  {
    source: "eurostat",
    key: "inflation",
    // prc_hicp_aind (the old annual series) ships only one point per year.
    // prc_hicp_manr is discontinued — replaced by prc_hicp_minr which uses
    // the new ECOICOP-2 classification (`coicop18` dimension). We fetch the
    // monthly index and average to quarterly so the chart x-axis stays at
    // quarter resolution.
    dataset: "prc_hicp_minr",
    query: { geo: "BG", unit: "RCH_A", coicop18: "TOTAL" },
    cadence: "quarterly",
    aggregate: "monthlyAvgToQuarter",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table",
    unitLabelEn: "% YoY (HICP, quarterly avg)",
    unitLabelBg: "% спрямо предходната година (ХИПЦ, тримес. ср.)",
    titleEn: "Inflation (HICP)",
    titleBg: "Инфлация (ХИПЦ)",
  },
  {
    source: "eurostat",
    key: "unemployment",
    // une_rt_q only publishes NSA for Bulgaria — the seasonally-adjusted
    // quarterly series is empty. NSA has visible winter peaks; the line
    // stays interpretable because the seasonal swing is much smaller than
    // the cycle (~1pp vs 8pp peak-to-trough across the 2009→2024 cycle).
    dataset: "une_rt_q",
    query: {
      geo: "BG",
      unit: "PC_ACT",
      age: "Y15-74",
      sex: "T",
      s_adj: "NSA",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/une_rt_q/default/table",
    unitLabelEn: "% of active population (NSA)",
    unitLabelBg: "% от активното население (NSA)",
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
    cadence: "annual",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/nama_10_pc/default/table",
    unitLabelEn: "EUR per capita (current prices)",
    unitLabelBg: "евро на глава (текущи цени)",
    titleEn: "GDP per capita",
    titleBg: "БВП на човек от населението",
  },
  {
    // Nominal GDP at market prices (current EUR, millions). The /budget
    // dashboard expresses each headline figure as a % of GDP — the direct
    // nama_10_gdp value is preferred over gdpPerCapita × population because
    // both factors are rounded upstream and the product accumulates the
    // rounding error.
    source: "eurostat",
    key: "nominalGdp",
    dataset: "nama_10_gdp",
    query: {
      geo: "BG",
      unit: "CP_MEUR",
      na_item: "B1GQ",
      freq: "A",
    },
    cadence: "annual",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/nama_10_gdp/default/table",
    unitLabelEn: "EUR million (current prices)",
    unitLabelBg: "млн. евро (текущи цени)",
    titleEn: "Nominal GDP",
    titleBg: "Номинален БВП",
  },
  {
    source: "eurostat",
    key: "govDebt",
    dataset: "gov_10q_ggdebt",
    query: {
      geo: "BG",
      unit: "PC_GDP",
      sector: "S13",
      na_item: "GD",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggdebt/default/table",
    unitLabelEn: "% of GDP",
    unitLabelBg: "% от БВП",
    titleEn: "Government gross debt",
    titleBg: "Брутен държавен дълг",
  },
  {
    source: "eurostat",
    key: "budgetBalance",
    // gov_10q_ggnfa publishes net lending/borrowing (B9) per quarter. SCA is
    // the seasonal-and-calendar-adjusted variant; still noisy quarter-to-
    // quarter, but the trend matches the annual EDP series.
    dataset: "gov_10q_ggnfa",
    query: {
      geo: "BG",
      unit: "PC_GDP",
      sector: "S13",
      na_item: "B9",
      s_adj: "SCA",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggnfa/default/table",
    unitLabelEn: "% of GDP (net lending/borrowing, SCA)",
    unitLabelBg: "% от БВП (нето кредит/заем, SCA)",
    titleEn: "Government budget balance",
    titleBg: "Бюджетен баланс",
  },
  {
    source: "eurostat",
    key: "currentAccount",
    dataset: "ei_bpm6ca_q",
    query: {
      geo: "BG",
      unit: "PC_GDP",
      s_adj: "NSA",
      sector10: "S1",
      sectpart: "S1",
      partner: "WRL_REST",
      stk_flow: "BAL",
      bop_item: "CA",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/ei_bpm6ca_q/default/table",
    unitLabelEn: "% of GDP",
    unitLabelBg: "% от БВП",
    titleEn: "Current account balance",
    titleBg: "Текуща сметка",
  },

  // ---- HICP breakdown (Phase 2). Same prc_hicp_minr fetcher as the headline
  // inflation series; only the coicop18 sub-component filter differs. Each
  // emits the monthly-aggregated quarterly mean of YoY rates.
  {
    source: "eurostat",
    key: "inflationFood",
    dataset: "prc_hicp_minr",
    query: { geo: "BG", unit: "RCH_A", coicop18: "CP01" },
    cadence: "quarterly",
    aggregate: "monthlyAvgToQuarter",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table",
    unitLabelEn: "% YoY (food + non-alcoholic bev., quarterly avg)",
    unitLabelBg: "% спрямо предходната година (храна и безалкохолни)",
    titleEn: "Inflation — food",
    titleBg: "Инфлация — храна",
  },
  {
    source: "eurostat",
    key: "inflationEnergy",
    dataset: "prc_hicp_minr",
    query: { geo: "BG", unit: "RCH_A", coicop18: "NRG" },
    cadence: "quarterly",
    aggregate: "monthlyAvgToQuarter",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table",
    unitLabelEn: "% YoY (energy, quarterly avg)",
    unitLabelBg: "% спрямо предходната година (енергия)",
    titleEn: "Inflation — energy",
    titleBg: "Инфлация — енергия",
  },
  {
    source: "eurostat",
    key: "inflationServices",
    dataset: "prc_hicp_minr",
    query: { geo: "BG", unit: "RCH_A", coicop18: "SERV" },
    cadence: "quarterly",
    aggregate: "monthlyAvgToQuarter",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table",
    unitLabelEn: "% YoY (services, quarterly avg)",
    unitLabelBg: "% спрямо предходната година (услуги)",
    titleEn: "Inflation — services",
    titleBg: "Инфлация — услуги",
  },
  {
    source: "eurostat",
    key: "inflationCore",
    dataset: "prc_hicp_minr",
    query: { geo: "BG", unit: "RCH_A", coicop18: "TOT_X_NRG_FOOD" },
    cadence: "quarterly",
    aggregate: "monthlyAvgToQuarter",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table",
    unitLabelEn: "% YoY (core: total ex. food + energy, quarterly avg)",
    unitLabelBg: "% спрямо предх. година (база: без храна и енергия)",
    titleEn: "Inflation — core (ex. food + energy)",
    titleBg: "Инфлация — базова (без храна и енергия)",
  },

  // ---- Activity + sentiment (Phase 3). Industrial production and retail
  // both emit an index (2021 = 100) — Eurostat does not publish a derived
  // YoY rate for BG in these datasets. The index level still shows the
  // cycle clearly and is the natural unit for cabinet-by-cabinet "did the
  // economy grow or shrink under X" reading.
  {
    source: "eurostat",
    key: "industrialProd",
    dataset: "sts_inpr_q",
    query: {
      geo: "BG",
      indic_bt: "PRD",
      nace_r2: "B-D",
      s_adj: "SCA",
      unit: "I21",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/sts_inpr_q/default/table",
    unitLabelEn: "index (2021=100, SCA)",
    unitLabelBg: "индекс (2021=100, SCA)",
    titleEn: "Industrial production",
    titleBg: "Промишлено производство",
  },
  {
    source: "eurostat",
    key: "retailVolume",
    dataset: "sts_trtu_m",
    query: {
      geo: "BG",
      indic_bt: "VOL_SLS",
      nace_r2: "G",
      s_adj: "SCA",
      unit: "I21",
    },
    // Eurostat publishes this series starting much later than START_YEAR
    // (around 2014-2015), so the natural floor of 60 quarterly points is
    // wrong. ~44 is the healthy baseline.
    minPoints: 35,
    cadence: "quarterly",
    aggregate: "monthlyAvgToQuarter",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/sts_trtu_m/default/table",
    unitLabelEn: "index (2021=100, SCA)",
    unitLabelBg: "индекс (2021=100, SCA)",
    titleEn: "Retail trade volume",
    titleBg: "Обем на търговията на дребно",
  },
  // ei_bssi_m_r2 publishes both the Consumer Confidence Indicator (balance,
  // ~0 = neutral) and the Economic Sentiment Indicator (index, 100 = LT avg).
  // Different scales — these need their own chart section, not overlaid on
  // % indicators.
  {
    source: "eurostat",
    key: "consumerConfidence",
    dataset: "ei_bssi_m_r2",
    query: { geo: "BG", indic: "BS-CCI-BAL", s_adj: "SA" },
    cadence: "quarterly",
    aggregate: "monthlyAvgToQuarter",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/ei_bssi_m_r2/default/table",
    unitLabelEn: "balance (positive = optimistic, SA)",
    unitLabelBg: "баланс (положително = оптимизъм, SA)",
    titleEn: "Consumer confidence",
    titleBg: "Потребителско доверие",
  },
  {
    source: "eurostat",
    key: "economicSentiment",
    dataset: "ei_bssi_m_r2",
    query: { geo: "BG", indic: "BS-ESI-I", s_adj: "SA" },
    cadence: "quarterly",
    aggregate: "monthlyAvgToQuarter",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/ei_bssi_m_r2/default/table",
    unitLabelEn: "index (long-term avg = 100, SA)",
    unitLabelBg: "индекс (дългосрочна средна = 100, SA)",
    titleEn: "Economic Sentiment Indicator",
    titleBg: "Индикатор за икономически нагласи",
  },

  // ---- Social (Phase 4). Three small tiles on /governments — household
  // and inequality signals.
  {
    source: "eurostat",
    key: "youthUnemployment",
    dataset: "une_rt_q",
    query: {
      geo: "BG",
      unit: "PC_ACT",
      age: "Y15-24",
      sex: "T",
      s_adj: "NSA",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/une_rt_q/default/table",
    unitLabelEn: "% of active 15-24 population (NSA)",
    unitLabelBg: "% от активното 15-24 г. население (NSA)",
    titleEn: "Youth unemployment (15-24)",
    titleBg: "Младежка безработица (15-24)",
  },
  {
    source: "eurostat",
    key: "housePricesYoY",
    dataset: "prc_hpi_q",
    query: { geo: "BG", purchase: "TOTAL", unit: "RCH_A", freq: "Q" },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/prc_hpi_q/default/table",
    unitLabelEn: "% YoY (house price index)",
    unitLabelBg: "% спрямо предходната година (индекс на жилищни цени)",
    titleEn: "House prices (YoY)",
    titleBg: "Цени на жилищата (YoY)",
  },
  {
    source: "eurostat",
    key: "gini",
    dataset: "ilc_di12",
    query: { geo: "BG", statinfo: "GINI_HND", age: "TOTAL", freq: "A" },
    cadence: "annual",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/ilc_di12/default/table",
    unitLabelEn: "Gini coefficient × 100 (0 = perfect equality)",
    unitLabelBg: "коефициент на Джини × 100 (0 = пълно равенство)",
    titleEn: "Gini coefficient (income inequality)",
    titleBg: "Коефициент на Джини (доходно неравенство)",
  },
  {
    source: "eurostat",
    key: "povertyRate",
    dataset: "ilc_li02",
    // LI_R_MD60 is the standard at-risk-of-poverty rate: % of population
    // with disposable income below 60% of the national median.
    query: {
      geo: "BG",
      indic_il: "LI_R_MD60",
      sex: "T",
      age: "TOTAL",
      unit: "PC",
      freq: "A",
    },
    cadence: "annual",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/ilc_li02/default/table",
    unitLabelEn: "% of population below 60% of median income",
    unitLabelBg: "% от населението под 60% от медианния доход",
    titleEn: "At-risk-of-poverty rate",
    titleBg: "Под прага на бедността",
  },
  {
    source: "eurostat",
    key: "labourIncome",
    // Quarterly national accounts: compensation of employees (D1) in current
    // prices. Eurostat does not publish a chain-linked-volumes variant of
    // D1 for Bulgaria, so this is nominal. We derive YoY growth in-fetcher
    // — the reader can mentally subtract HICP inflation (charted on the
    // same Economy tile via the headline pill) to estimate real wage growth.
    dataset: "namq_10_a10",
    query: {
      geo: "BG",
      na_item: "D1",
      unit: "CP_MEUR",
      s_adj: "SCA",
      nace_r2: "TOTAL",
      freq: "Q",
    },
    cadence: "quarterly",
    derive: "yoyGrowth",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/namq_10_a10/default/table",
    unitLabelEn: "% YoY (nominal compensation of employees, SCA)",
    unitLabelBg: "% спрямо предходната година (номинален доход от труд, SCA)",
    titleEn: "Labour income (nominal, YoY)",
    titleBg: "Доход от труд (номинален, YoY)",
  },
];

const WORLD_BANK_INDICATORS: WorldBankIndicator[] = [
  {
    source: "worldbank",
    key: "wgiRuleOfLaw",
    indicatorCode: "GOV_WGI_RL.EST",
    cadence: "annual",
    sourceUrl:
      "https://databank.worldbank.org/source/worldwide-governance-indicators",
    unitLabelEn: "score (-2.5 to +2.5)",
    unitLabelBg: "оценка (от -2,5 до +2,5)",
    titleEn: "WGI Rule of Law",
    titleBg: "WGI: върховенство на правото",
  },
  {
    source: "worldbank",
    key: "wgiControlOfCorruption",
    indicatorCode: "GOV_WGI_CC.EST",
    cadence: "annual",
    sourceUrl:
      "https://databank.worldbank.org/source/worldwide-governance-indicators",
    unitLabelEn: "score (-2.5 to +2.5)",
    unitLabelBg: "оценка (от -2,5 до +2,5)",
    titleEn: "WGI Control of Corruption",
    titleBg: "WGI: контрол върху корупцията",
  },
  {
    source: "worldbank",
    key: "wgiGovEffectiveness",
    indicatorCode: "GOV_WGI_GE.EST",
    cadence: "annual",
    sourceUrl:
      "https://databank.worldbank.org/source/worldwide-governance-indicators",
    unitLabelEn: "score (-2.5 to +2.5)",
    unitLabelBg: "оценка (от -2,5 до +2,5)",
    titleEn: "WGI Government Effectiveness",
    titleBg: "WGI: ефективност на управлението",
  },
];

// Transparency International CPI scores for Bulgaria (modernized 0–100 scale,
// methodology break in 2012; pre-2012 data was on a 0–10 scale and is not
// strictly comparable, so we omit it). Sourced from TI's annual CPI archive.
const TI_CPI: MacroPoint[] = [
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
const EB_TRUST_PARLIAMENT: MacroPoint[] = [
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

const EB_TRUST_GOVERNMENT: MacroPoint[] = [
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

const EB_TRUST_EU: MacroPoint[] = [
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

// Annual EU budget flows for Bulgaria, both directions (EUR billions).
// Sourced from the European Commission's per-Member-State spreadsheet
// "EU spending and revenue — data 2000-2023" (XLSX, updated yearly under the
// 2021-27 long-term-budget portal). One sheet per calendar year; we read the
// BG column's TOTAL EXPENDITURE and TOTAL National contributions rows.
//
// Values are in EUR billions, two decimals. Bulgaria joined 2007.
// Programming periods: 2007-13 (first cycle), 2014-20 (largest absorption
// push), 2021-27 (current; NGEU envelope rolled into the headline since 2021).
//
// EU_FUNDS = TOTAL EXPENDITURE row for BG — gross EU spending in Bulgaria.
// EU_CONTRIBUTION = TOTAL National contributions row for BG — gross outflow
//   (VAT, GNI, plastic-packaging waste, balances/adjustments; excludes
//   traditional own resources / customs duties which are EU revenue, not a
//   Member-State contribution).
// The visual gap between the two lines on the chart equals the net benefit.
//
// Note on 2008: the EU froze ~€825M of pre-accession funds (PHARE/ISPA) and
// withdrew accreditation from two Bulgarian managing agencies in July 2008,
// permanently losing ~€220M of PHARE. The gross-disbursement figure still
// rose YoY because CAP direct payments and structural-fund pre-financing
// continued — the freeze hit future commitments, not 2008 cash out.
const EU_FUNDS: MacroPoint[] = [
  { year: 2007, value: 0.59 },
  { year: 2008, value: 0.97 },
  { year: 2009, value: 0.98 },
  { year: 2010, value: 1.22 },
  { year: 2011, value: 1.11 },
  { year: 2012, value: 1.73 },
  { year: 2013, value: 1.98 },
  { year: 2014, value: 2.26 },
  { year: 2015, value: 2.73 },
  { year: 2016, value: 2.35 },
  { year: 2017, value: 1.9 },
  { year: 2018, value: 2.17 },
  { year: 2019, value: 2.2 },
  { year: 2020, value: 2.23 },
  { year: 2021, value: 2.56 },
  { year: 2022, value: 2.34 },
  { year: 2023, value: 2.81 },
  { year: 2024, value: 2.07 },
];

const EU_CONTRIBUTION: MacroPoint[] = [
  { year: 2007, value: 0.23 },
  { year: 2008, value: 0.28 },
  { year: 2009, value: 0.34 },
  { year: 2010, value: 0.31 },
  { year: 2011, value: 0.35 },
  { year: 2012, value: 0.37 },
  { year: 2013, value: 0.42 },
  { year: 2014, value: 0.4 },
  { year: 2015, value: 0.42 },
  { year: 2016, value: 0.39 },
  { year: 2017, value: 0.38 },
  { year: 2018, value: 0.49 },
  { year: 2019, value: 0.49 },
  { year: 2020, value: 0.59 },
  { year: 2021, value: 0.69 },
  { year: 2022, value: 0.69 },
  { year: 2023, value: 0.78 },
  { year: 2024, value: 0.75 },
];

const CURATED_INDICATORS: CuratedIndicator[] = [
  {
    source: "curated",
    key: "cpi",
    cadence: "annual",
    sourceUrl: "https://www.transparency.org/en/countries/bulgaria",
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
    cadence: "annual",
    sourceUrl: "https://europa.eu/eurobarometer/surveys/browse/all/series/4961",
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
    cadence: "annual",
    sourceUrl: "https://europa.eu/eurobarometer/surveys/browse/all/series/4961",
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
    cadence: "annual",
    sourceUrl: "https://europa.eu/eurobarometer/surveys/browse/all/series/4961",
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
    cadence: "annual",
    sourceUrl:
      "https://commission.europa.eu/strategy-and-policy/eu-budget/performance-and-reporting_en",
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
    cadence: "annual",
    sourceUrl:
      "https://commission.europa.eu/strategy-and-policy/eu-budget/performance-and-reporting_en",
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

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

const valueAt = (
  values: Record<string, number> | number[],
  idx: number,
): number | undefined => {
  const v = Array.isArray(values) ? values[idx] : values[String(idx)];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};

const aggregateMonthlyToQuarterly = (
  monthly: { year: number; month: number; value: number }[],
): MacroPoint[] => {
  type Bucket = {
    sum: number;
    count: number;
    year: number;
    quarter: 1 | 2 | 3 | 4;
  };
  const buckets = new Map<string, Bucket>();
  for (const p of monthly) {
    const quarter = Math.ceil(p.month / 3) as 1 | 2 | 3 | 4;
    const key = `${p.year}-Q${quarter}`;
    const b = buckets.get(key) ?? {
      sum: 0,
      count: 0,
      year: p.year,
      quarter,
    };
    b.sum += p.value;
    b.count += 1;
    buckets.set(key, b);
  }
  const out: MacroPoint[] = [];
  for (const [, b] of buckets) {
    // Drop incomplete trailing quarters so we never plot a partial month
    // as if it were the full quarter's average.
    if (b.count < 3) continue;
    out.push({
      year: b.year,
      quarter: b.quarter,
      period: `${b.year}-Q${b.quarter}`,
      value: round(b.sum / b.count, 2),
    });
  }
  return out.sort(
    (a, b) => a.year - b.year || (a.quarter ?? 0) - (b.quarter ?? 0),
  );
};

const fetchEurostat = async (i: EurostatIndicator): Promise<MacroPoint[]> => {
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

  if (i.aggregate === "monthlyAvgToQuarter") {
    const monthly: { year: number; month: number; value: number }[] = [];
    for (const [key, idx] of Object.entries(timeIndex)) {
      const m = /^(\d{4})-(\d{2})$/.exec(key);
      if (!m) continue;
      const year = +m[1];
      const month = +m[2];
      if (year < START_YEAR) continue;
      const v = valueAt(values, idx);
      if (v === undefined) continue;
      monthly.push({ year, month, value: v });
    }
    return aggregateMonthlyToQuarterly(monthly);
  }

  if (i.cadence === "quarterly") {
    // For yoyGrowth-derived series we need a year of warm-up data before
    // START_YEAR to compute the first valid YoY point. Collect everything,
    // sort, then filter to >= START_YEAR after the derivation.
    const all: MacroPoint[] = [];
    for (const [key, idx] of Object.entries(timeIndex)) {
      const m = /^(\d{4})-Q([1-4])$/.exec(key);
      if (!m) continue;
      const year = +m[1];
      const quarter = +m[2] as 1 | 2 | 3 | 4;
      // Keep one year of pre-window data for yoyGrowth lookback.
      if (i.derive === "yoyGrowth") {
        if (year < START_YEAR - 1) continue;
      } else if (year < START_YEAR) {
        continue;
      }
      const v = valueAt(values, idx);
      if (v === undefined) continue;
      all.push({
        year,
        quarter,
        period: `${year}-Q${quarter}`,
        value: v,
      });
    }
    all.sort((a, b) => a.year - b.year || (a.quarter ?? 0) - (b.quarter ?? 0));

    if (i.derive === "yoyGrowth") {
      const out: MacroPoint[] = [];
      for (let j = 4; j < all.length; j++) {
        const now = all[j];
        const prev = all[j - 4];
        if (now.year < START_YEAR) continue;
        const yoy = (now.value / prev.value - 1) * 100;
        if (!Number.isFinite(yoy)) continue;
        out.push({
          year: now.year,
          quarter: now.quarter,
          period: now.period,
          value: round(yoy, 2),
        });
      }
      return out;
    }

    return all.map((p) => ({ ...p, value: round(p.value, 2) }));
  }

  // annual
  const out: MacroPoint[] = [];
  for (const [key, idx] of Object.entries(timeIndex)) {
    const yearNum = Number(key);
    if (!Number.isInteger(yearNum) || yearNum < START_YEAR) continue;
    const v = valueAt(values, idx);
    if (v === undefined) continue;
    out.push({ year: yearNum, value: round(v, 2) });
  }
  return out.sort((a, b) => a.year - b.year);
};

const fetchWorldBank = async (i: WorldBankIndicator): Promise<MacroPoint[]> => {
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
  const out: MacroPoint[] = [];
  for (const p of points) {
    const yearNum = Number(p.date);
    if (!Number.isInteger(yearNum) || yearNum < START_YEAR) continue;
    if (typeof p.value === "number" && Number.isFinite(p.value)) {
      out.push({ year: yearNum, value: round(p.value, 3) });
    }
  }
  return out.sort((a, b) => a.year - b.year);
};

type IndicatorMeta = {
  titleEn: string;
  titleBg: string;
  unitLabelEn: string;
  unitLabelBg: string;
  cadence: Cadence;
  source: "eurostat" | "worldbank" | "curated";
  sourceUrl?: string;
  datasetCode?: string;
  attributionEn?: string;
  attributionBg?: string;
};

const readPriorSeries = (): Record<string, MacroPoint[]> | null => {
  if (!fs.existsSync(OUT_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(OUT_FILE, "utf8")) as {
      series?: Record<string, MacroPoint[]>;
    };
    return raw.series ?? null;
  } catch {
    return null;
  }
};

const floorFor = (ind: EurostatIndicator | WorldBankIndicator): number => {
  if (ind.minPoints !== undefined) return ind.minPoints;
  return ind.cadence === "quarterly" ? MIN_POINTS_QUARTERLY : MIN_POINTS_ANNUAL;
};

const main = async () => {
  const series: Record<string, MacroPoint[]> = {};
  const meta: Record<string, IndicatorMeta> = {};
  const prior = readPriorSeries();

  const all: Indicator[] = [
    ...EUROSTAT_INDICATORS,
    ...WORLD_BANK_INDICATORS,
    ...CURATED_INDICATORS,
  ];

  for (const ind of all) {
    process.stdout.write(`Loading ${ind.key} (${ind.source})... `);
    try {
      let data: MacroPoint[];
      if (ind.source === "eurostat") data = await fetchEurostat(ind);
      else if (ind.source === "worldbank") data = await fetchWorldBank(ind);
      else data = ind.series;

      // Absolute-floor check (Eurostat / WorldBank only — curated series
      // are inline constants and self-validating). Catches "upstream query
      // mass-failed and returned 0/few points" before we overwrite the
      // committed data/macro.json with a broken series.
      if (ind.source !== "curated") {
        const floor = floorFor(ind);
        if (data.length < floor) {
          throw new Error(
            `safety check: ${ind.key} (${ind.source}) returned ${data.length} points, below floor ${floor}. ` +
              `Likely upstream query rejected silently or dimension filtering broke. ` +
              `Refusing to overwrite data/macro.json with a near-empty series.`,
          );
        }
      }

      // Regression-vs-prior check. If we have a previously-committed series
      // for this key, abort when the new fetch returns materially fewer
      // points. Catches the case where the upstream still answers but with
      // a narrower window (e.g. dimension filter changed semantics).
      if (prior && prior[ind.key]) {
        const prev = prior[ind.key].length;
        if (prev > 0) {
          const drop = (prev - data.length) / prev;
          if (drop > REGRESSION_THRESHOLD) {
            throw new Error(
              `safety check: ${ind.key} dropped from ${prev} → ${data.length} points (${(drop * 100).toFixed(1)}% < -${(REGRESSION_THRESHOLD * 100).toFixed(0)}%). ` +
                `Upstream filter likely tightened. ` +
                `Refusing to overwrite data/macro.json — investigate before re-running.`,
            );
          }
        }
      }

      series[ind.key] = data;
      meta[ind.key] = {
        titleEn: ind.titleEn,
        titleBg: ind.titleBg,
        unitLabelEn: ind.unitLabelEn,
        unitLabelBg: ind.unitLabelBg,
        cadence: ind.cadence,
        source: ind.source,
        ...(ind.source === "eurostat"
          ? { sourceUrl: ind.sourceUrl, datasetCode: ind.dataset }
          : {}),
        ...(ind.source === "worldbank" ? { sourceUrl: ind.sourceUrl } : {}),
        ...(ind.source === "curated"
          ? {
              sourceUrl: ind.sourceUrl,
              attributionEn: ind.attributionEn,
              attributionBg: ind.attributionBg,
            }
          : {}),
      };
      const last = data[data.length - 1];
      const tail = last
        ? last.quarter
          ? `${last.year} Q${last.quarter}`
          : `${last.year}`
        : "—";
      console.log(`${data.length} points (latest ${tail})`);
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
