/**
 * Fetch macroeconomic and governance indicators for Bulgaria and write
 * data/macro.json. Election-context indicators we overlay on the cabinet
 * timeline:
 *
 *   Eurostat   — quarterly: real GDP growth, HICP inflation, unemployment
 *                (SA), employment + activity rate (LFS, 20-64), gov debt,
 *                budget balance, current account
 *                annual: GDP per capita, labour-market slack
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
import { CASH_META } from "./fetch_cash_balance";

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
const MIN_POINTS_MONTHLY = 180; // ~15 years of monthly data
// Regression threshold: if a series shrinks by more than this fraction
// compared to the previously-committed data/macro.json, abort. Catches the
// "filter narrowed silently" case the SKILL.md describes.
const REGRESSION_THRESHOLD = 0.1; // 10% drop = trip

const EUROSTAT_BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const WORLD_BANK_BASE = "https://api.worldbank.org/v2";

const START_YEAR = 2005;

type Cadence = "annual" | "quarterly" | "monthly";

// Quarterly-equivalent representation. Annual points omit `quarter`/`period`;
// quarterly points carry both. Existing consumers that read only {year,value}
// keep working — `year` is the calendar year on quarterly points too.
type MacroPoint = {
  year: number;
  value: number;
  quarter?: 1 | 2 | 3 | 4;
  // Set on monthly-cadence points (1-12). Mutually exclusive with `quarter`.
  month?: number;
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

// A single latest-reading pulled from a *monthly* Eurostat dataset, attached to
// a quarterly series so the chart can show a fresher headline number than the
// last completed quarter. The chart axis stays quarterly (some series — GDP,
// labour income — have no monthly frequency at all), but for series that do
// publish monthly (unemployment, HICP) we surface the newest month as a
// callout. We store only the single most recent non-null point.
type MonthlyLatestSpec = {
  // Must match an existing quarterly series `key` in EUROSTAT_INDICATORS.
  key: string;
  dataset: string;
  query: Record<string, string>;
  // True when the monthly cut is seasonally adjusted (Eurostat's headline
  // monthly unemployment is SA). Recorded so the UI can label it honestly.
  // The quarterly `unemployment` line is now also SA, so the callout and the
  // line share the same seasonal treatment.
  seasonallyAdjusted: boolean;
  sourceUrl: string;
};

// Eurostat headline monthly unemployment is SA, age TOTAL (= 15-74, matching
// the quarterly line's population base), % of active population. This is the
// internationally-cited "X%, lowest/highest in EU" figure.
const MONTHLY_LATEST_SPECS: MonthlyLatestSpec[] = [
  {
    key: "unemployment",
    dataset: "une_rt_m",
    query: {
      geo: "BG",
      unit: "PC_ACT",
      age: "TOTAL",
      sex: "T",
      s_adj: "SA",
      freq: "M",
    },
    seasonallyAdjusted: true,
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/une_rt_m/default/table",
  },
];

// The latest monthly reading we attach per series key.
type MonthlyLatest = {
  period: string; // "YYYY-MM"
  year: number;
  month: number;
  value: number;
  seasonallyAdjusted: boolean;
  datasetCode: string;
  sourceUrl: string;
};

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
    // Seasonally adjusted (SA). une_rt_q now publishes a full SA quarterly
    // series for Bulgaria (2009-Q1→, same length as NSA), so we take it —
    // it removes the winter peaks and, crucially, matches the SA monthly
    // callout (une_rt_m) rendered beside this line, killing the old
    // NSA-line-vs-SA-callout inconsistency.
    dataset: "une_rt_q",
    query: {
      geo: "BG",
      unit: "PC_ACT",
      age: "Y15-74",
      sex: "T",
      s_adj: "SA",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/une_rt_q/default/table",
    unitLabelEn: "% of active population (SA)",
    unitLabelBg: "% от активното население (сезонно изгладено)",
    titleEn: "Unemployment rate",
    titleBg: "Безработица",
  },
  {
    source: "eurostat",
    key: "unemploymentMonthly",
    // Full MONTHLY unemployment series (une_rt_m, SA, age TOTAL = 15-74) — the
    // internationally-cited headline number. Monthly cadence gives ~3x the
    // resolution of the quarterly line and surfaces the freshest reading
    // (~6-week lag) as the last point rather than as a separate callout.
    dataset: "une_rt_m",
    query: {
      geo: "BG",
      unit: "PC_ACT",
      age: "TOTAL",
      sex: "T",
      s_adj: "SA",
      freq: "M",
    },
    cadence: "monthly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/une_rt_m/default/table",
    unitLabelEn: "% of active population (monthly, SA)",
    unitLabelBg: "% от активното население (месечно, сезонно изгладено)",
    titleEn: "Unemployment rate (monthly)",
    titleBg: "Безработица (месечна)",
  },
  {
    source: "eurostat",
    key: "employmentRate",
    // Employment rate, ages 20-64 — the EU headline labour-market target
    // metric (% of the 20-64 population in work). For Bulgaria this tells
    // the real story the ~4% unemployment rate hides: the shrinking,
    // ageing working-age base. Seasonally adjusted, quarterly (LFS).
    dataset: "lfsi_emp_q",
    query: {
      geo: "BG",
      indic_em: "EMP_LFS",
      s_adj: "SA",
      sex: "T",
      age: "Y20-64",
      unit: "PC_POP",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/lfsi_emp_q/default/table",
    unitLabelEn: "% of population 20-64 (SA)",
    unitLabelBg: "% от населението 20-64 г. (сезонно изгладено)",
    titleEn: "Employment rate (20-64)",
    titleBg: "Коефициент на заетост (20-64)",
  },
  {
    source: "eurostat",
    key: "activityRate",
    // Activity / participation rate, ages 20-64 (% of the 20-64 population
    // either working or looking for work). The denominator behind the
    // unemployment rate: a low activity rate means people have left the
    // labour force entirely (emigration, discouragement) rather than shown
    // up as "unemployed". Seasonally adjusted, quarterly (LFS).
    dataset: "lfsi_emp_q",
    query: {
      geo: "BG",
      indic_em: "ACT",
      s_adj: "SA",
      sex: "T",
      age: "Y20-64",
      unit: "PC_POP",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/lfsi_emp_q/default/table",
    unitLabelEn: "% of population 20-64 (SA)",
    unitLabelBg: "% от населението 20-64 г. (сезонно изгладено)",
    titleEn: "Activity rate (20-64)",
    titleBg: "Коефициент на икономическа активност (20-64)",
  },
  {
    source: "eurostat",
    key: "labourSlack",
    // Labour market slack, ages 20-64 — the broad "true unemployment"
    // measure: unemployed + underemployed part-timers + persons available
    // but not seeking + persons seeking but not available. Annual only, and
    // expressed as % of the EXTENDED labour force (PC_ELF) — a different
    // denominator from the headline unemployment rate (% of active
    // population), so the two are not numerically interchangeable even
    // though slack runs ~1.5-2x the headline rate. Surfaced as a contextual
    // callout, not a chart line.
    dataset: "lfsi_sla_a",
    query: {
      geo: "BG",
      wstatus: "SLACK",
      sex: "T",
      age: "Y20-64",
      unit: "PC_ELF",
      freq: "A",
    },
    cadence: "annual",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/lfsi_sla_a/default/table",
    unitLabelEn: "% of extended labour force",
    unitLabelBg: "% от разширената работна сила",
    titleEn: "Labour market slack (20-64)",
    titleBg: "Разширена безработица (20-64)",
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
    key: "esaBalanceAnnual",
    // AUTHORITATIVE annual ESA deficit/surplus ratio, straight from the EDP
    // notification table (gov_10dd_edpt1, B9, S13, % of GDP). This is the
    // figure Eurostat headlines (e.g. BG 2025 = -3.5%, 2021 = -4.0%).
    //
    // Do NOT reconstruct the annual deficit by summing the quarterly
    // `budgetBalance` / `budgetBalanceNominal` SCA series and dividing by GDP:
    // seasonal-and-calendar adjustment plus the different quarterly-GFS vintage
    // make that derivation drift 0.1-0.5pp from the official annual (it read
    // -3.6% for 2025 and -3.5% for 2021 before this series existed). Consumers
    // that need the per-year headline deficit must read THIS series; the
    // quarterly SCA triple is only for within-year shape.
    dataset: "gov_10dd_edpt1",
    query: {
      geo: "BG",
      na_item: "B9",
      sector: "S13",
      unit: "PC_GDP",
      freq: "A",
    },
    cadence: "annual",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/gov_10dd_edpt1/default/table",
    unitLabelEn: "% of GDP (general gov net lending/borrowing, EDP, annual)",
    unitLabelBg:
      "% от БВП (нето кредит/заем на сектор „Държавно управление“, ПСД, годишно)",
    titleEn: "Government budget balance (annual, EDP)",
    titleBg: "Бюджетно салдо (годишно, ПСД)",
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

  // ---- Nominal-EUR variants of the fiscal/external series. Same datasets
  // as the % of GDP triple above, but with unit MIO_EUR — answers "how many
  // euros of debt, deficit, current-account surplus did this cabinet add",
  // not just "what share of GDP". Net new debt issued per quarter is derived
  // client-side as the quarter-on-quarter Δ of govDebtNominal.
  {
    source: "eurostat",
    key: "govDebtNominal",
    dataset: "gov_10q_ggdebt",
    query: {
      geo: "BG",
      unit: "MIO_EUR",
      sector: "S13",
      na_item: "GD",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggdebt/default/table",
    unitLabelEn: "EUR million (gross debt stock, end of period)",
    unitLabelBg: "млн. евро (брутен дълг, край на периода)",
    titleEn: "Government gross debt (nominal)",
    titleBg: "Брутен държавен дълг (номинален)",
  },
  {
    source: "eurostat",
    key: "budgetBalanceNominal",
    dataset: "gov_10q_ggnfa",
    query: {
      geo: "BG",
      unit: "MIO_EUR",
      sector: "S13",
      na_item: "B9",
      s_adj: "SCA",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggnfa/default/table",
    unitLabelEn: "EUR million (net lending/borrowing, SCA)",
    unitLabelBg: "млн. евро (нето кредит/заем, SCA)",
    titleEn: "Budget balance (nominal)",
    titleBg: "Бюджетен баланс (номинален)",
  },
  {
    source: "eurostat",
    key: "currentAccountNominal",
    dataset: "ei_bpm6ca_q",
    query: {
      geo: "BG",
      unit: "MIO_EUR",
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
    unitLabelEn: "EUR million (current account balance)",
    unitLabelBg: "млн. евро (текуща сметка)",
    titleEn: "Current account balance (nominal)",
    titleBg: "Текуща сметка (номинална)",
  },
  // Government revenue + expenditure — the two sides of the budget. Plotted
  // overlaid on one chart; the vertical gap between them equals the deficit.
  {
    source: "eurostat",
    key: "govRevenue",
    dataset: "gov_10q_ggnfa",
    query: {
      geo: "BG",
      unit: "MIO_EUR",
      sector: "S13",
      na_item: "TR",
      s_adj: "SCA",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggnfa/default/table",
    unitLabelEn: "EUR million (total general gov revenue, SCA)",
    unitLabelBg: "млн. евро (общи държавни приходи, SCA)",
    titleEn: "Government revenue",
    titleBg: "Държавни приходи",
  },
  {
    source: "eurostat",
    key: "govExpenditure",
    dataset: "gov_10q_ggnfa",
    query: {
      geo: "BG",
      unit: "MIO_EUR",
      sector: "S13",
      na_item: "TE",
      s_adj: "SCA",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/gov_10q_ggnfa/default/table",
    unitLabelEn: "EUR million (total general gov expenditure, SCA)",
    unitLabelBg: "млн. евро (общи държавни разходи, SCA)",
    titleEn: "Government expenditure",
    titleBg: "Държавни разходи",
  },
  // Net inward FDI flows, BPM6, annual. Series begins 2013 — set a relaxed
  // floor (Eurostat only published BG flows starting that year).
  {
    source: "eurostat",
    key: "fdiInward",
    dataset: "bop_fdi6_flow",
    query: {
      geo: "BG",
      partner: "WRL_REST",
      entity: "TOTAL",
      nace_r2: "FDI",
      fdi_item: "DI__D__F",
      stk_flow: "NI",
      currency: "MIO_EUR",
      freq: "A",
    },
    cadence: "annual",
    minPoints: 10,
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/bop_fdi6_flow/default/table",
    unitLabelEn: "EUR million (net FDI inward, annual)",
    unitLabelBg: "млн. евро (нетни входящи ПЧИ, годишно)",
    titleEn: "Foreign direct investment (net inward)",
    titleBg: "Преки чуждестранни инвестиции (нетно входящи)",
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
    // SA — matches the headline `unemployment` series so total and youth
    // lines share the same seasonal treatment in the labour-market panel.
    query: {
      geo: "BG",
      unit: "PC_ACT",
      age: "Y15-24",
      sex: "T",
      s_adj: "SA",
      freq: "Q",
    },
    cadence: "quarterly",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/une_rt_q/default/table",
    unitLabelEn: "% of active 15-24 population (SA)",
    unitLabelBg: "% от активното 15-24 г. население (сезонно изгладено)",
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
    // Standard at-risk-of-poverty rate: % of population with disposable
    // income below 60% of the national median. Eurostat restructured this
    // dataset on 2026-06-10, dropping `indic_il=LI_R_MD60` in favour of
    // `rskpovth=B_60` (below 60% threshold band) + `statinfo=MED_EI`
    // (median equivalised-income basis).
    query: {
      geo: "BG",
      rskpovth: "B_60",
      statinfo: "MED_EI",
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
    // Intentional homicide rate per 100K — the most cross-country comparable
    // crime indicator (definition is universal under ICCS0101). Eurostat
    // doesn't publish a sub-national breakdown for the full crime series,
    // so this is national-grain only.
    source: "eurostat",
    key: "intentionalHomicideRate",
    dataset: "crim_off_cat",
    query: { geo: "BG", iccs: "ICCS0101", unit: "P_HTHAB", freq: "A" },
    cadence: "annual",
    // The dataset starts in 2008, so the standard 12-year floor is fine.
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/crim_off_cat/default/table",
    unitLabelEn: "per 100,000 inhabitants",
    unitLabelBg: "на 100 000 жители",
    titleEn: "Intentional homicide rate",
    titleBg: "Умишлени убийства",
  },
  {
    // Prison population per 100K. Higher is not unambiguously worse —
    // reflects both crime levels and punitiveness — so the rank pill on the
    // peer overlay is intentionally suppressed (see fetch_eu_peers).
    source: "eurostat",
    key: "prisonPopulationRate",
    dataset: "crim_pris_age",
    query: { geo: "BG", age: "TOTAL", sex: "T", unit: "P_HTHAB", freq: "A" },
    cadence: "annual",
    sourceUrl:
      "https://ec.europa.eu/eurostat/databrowser/view/crim_pris_age/default/table",
    unitLabelEn: "per 100,000 inhabitants",
    unitLabelBg: "на 100 000 жители",
    titleEn: "Prison population",
    titleBg: "Затворници",
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
  { year: 2025, value: 40 },
];

// Eurobarometer "tend to trust" — Bulgaria results, annual averages of the
// spring and autumn Standard EB waves (% who answered "tend to trust").
// Read from the per-wave Standard Eurobarometer DATA ANNEX (QA6 "How much trust
// do you have in certain institutions?", BG "Tend to trust" column) at
// europa.eu/eurobarometer — the authoritative per-country tables.
// 2025 = mean of STD103 (Spring) + STD104 (Autumn) 2025; both waves read equal.
// 2026 = STD105 (Spring 2026) only — the autumn 2026 wave is not out yet, so this
// latest point is a single-wave reading and will be re-meaned when autumn lands.
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
  { year: 2025, value: 19 },
  { year: 2026, value: 16 },
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
  { year: 2025, value: 25 },
  { year: 2026, value: 22 },
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
  { year: 2025, value: 46 },
  { year: 2026, value: 52 },
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

// Fiscal reserve (фискален резерв) — quarterly stock in EUR million, sourced
// from minfin.bg monthly КФП bulletins via Wayback Machine. Generated by
// scripts/macro/fetch_fiscal_reserve.ts; cached output read here so a routine
// `npm run data` refresh doesn't need to re-scrape the PDFs.
const FISCAL_RESERVE_CACHE = path.resolve(
  __dirname,
  "../../data/_cache/fiscal-reserve.json",
);

// Pre-2015 year-end backfill (2005–2014), parsed by
// scripts/macro/fetch_fiscal_reserve_history.ts from manually-dropped minfin
// PDFs. Merged in for years the Wayback quarterly cache doesn't cover.
const FISCAL_RESERVE_HISTORY = path.resolve(
  __dirname,
  "../../data/_cache/fiscal-reserve-history.json",
);

const loadFiscalReserveHistory = (): MacroPoint[] => {
  if (!fs.existsSync(FISCAL_RESERVE_HISTORY)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(FISCAL_RESERVE_HISTORY, "utf8")) as {
      annual: Array<{
        year: number;
        quarter: 1 | 2 | 3 | 4;
        period: string;
        value: number | null;
      }>;
    };
    return raw.annual
      .filter((p) => typeof p.value === "number")
      .map((p) => ({
        year: p.year,
        quarter: p.quarter,
        period: p.period,
        value: p.value as number,
      }));
  } catch {
    return [];
  }
};

const loadFiscalReserve = (): MacroPoint[] => {
  const history = loadFiscalReserveHistory();
  if (!fs.existsSync(FISCAL_RESERVE_CACHE)) {
    if (history.length === 0)
      console.warn(
        `Fiscal-reserve cache missing (${FISCAL_RESERVE_CACHE}); run \`tsx scripts/macro/fetch_fiscal_reserve.ts\` to populate it.`,
      );
    return history;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(FISCAL_RESERVE_CACHE, "utf8")) as {
      quarterly: Array<{
        year: number;
        quarter: 1 | 2 | 3 | 4;
        period: string;
        value: number;
      }>;
    };
    const quarterly = raw.quarterly.map((p) => ({
      year: p.year,
      quarter: p.quarter,
      period: p.period,
      value: p.value,
    }));
    // Merge the pre-2015 history for years the quarterly cache doesn't cover.
    const yearsPresent = new Set(quarterly.map((p) => p.year));
    const merged = [
      ...history.filter((p) => !yearsPresent.has(p.year)),
      ...quarterly,
    ];
    return merged.sort(
      (a, b) => a.year - b.year || (a.quarter ?? 0) - (b.quarter ?? 0),
    );
  } catch (err) {
    console.warn(
      `Failed to read fiscal-reserve cache: ${(err as Error).message}`,
    );
    return history;
  }
};

CURATED_INDICATORS.push({
  source: "curated",
  key: "fiscalReserve",
  cadence: "quarterly",
  sourceUrl: "https://www.minfin.bg/bg/statistics/5",
  titleEn: "Fiscal reserve (фискален резерв)",
  titleBg: "Фискален резерв",
  unitLabelEn: "EUR million (end-of-quarter stock)",
  unitLabelBg: "млн. евро (натрупан обем, край на тримесечие)",
  attributionEn:
    "Ministry of Finance — monthly КФП bulletin, Фискален резерв row; archived via Wayback Machine",
  attributionBg:
    "Министерство на финансите — месечен бюлетин по КФП, ред „Фискален резерв“; архивирано чрез Wayback Machine",
  series: loadFiscalReserve(),
});

// Overdue obligations (просрочени задължения) — annual year-end consolidated
// stock from minfin.bg/bg/statistics/10, parsed by scripts/macro/fetch_arrears.ts
// from manually-dropped year-end XLS files (Cloudflare blocks automation). The
// committed cache (data/_cache/arrears.json) is read here so a routine macro
// refresh re-bakes the series; the suspect-year guard already ran upstream.
const ARREARS_CACHE = path.resolve(__dirname, "../../data/_cache/arrears.json");

const loadArrears = (): MacroPoint[] => {
  if (!fs.existsSync(ARREARS_CACHE)) {
    console.warn(
      `Arrears cache missing (${ARREARS_CACHE}); run \`tsx scripts/macro/fetch_arrears.ts\` to populate it.`,
    );
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(ARREARS_CACHE, "utf8")) as {
      annual: Array<{ year: number; value: number | null; suspect?: boolean }>;
    };
    return raw.annual
      .filter((p) => !p.suspect && typeof p.value === "number")
      .map((p) => ({ year: p.year, value: p.value as number }));
  } catch (err) {
    console.warn(`Failed to read arrears cache: ${(err as Error).message}`);
    return [];
  }
};

CURATED_INDICATORS.push({
  source: "curated",
  key: "arrears",
  cadence: "annual",
  sourceUrl: "https://www.minfin.bg/bg/statistics/10",
  titleEn: "Overdue obligations (просрочени задължения)",
  titleBg: "Просрочени задължения",
  unitLabelEn: "EUR million (year-end consolidated stock)",
  unitLabelBg: "млн. евро (натрупан обем към края на годината)",
  attributionEn:
    "Ministry of Finance — Просрочени задължения (year-end Обобщена справка, Общо row): consolidated central + social-security + local government",
  attributionBg:
    "Министерство на финансите — Просрочени задължения (обобщена справка към края на годината, ред „Общо“): консолидирано централно правителство, социалноосигурителни фондове и местно правителство",
  series: loadArrears(),
});

// Cash budget balance (касов баланс по КФП) — the МФ headline cash deficit/
// surplus, distinct from the Eurostat ESA balance above. Recent years come from
// our own КФП ingest (data/budget/index.json); older years from a manual МФ drop
// (data/_cache/minfin_kfp/cash-manual.json). Assembled by
// scripts/macro/fetch_cash_balance.ts into data/_cache/cash-balance.json, read
// here so a routine macro refresh re-bakes the series.
const CASH_BALANCE_CACHE = path.resolve(
  __dirname,
  "../../data/_cache/cash-balance.json",
);

const loadCashBalance = (): MacroPoint[] => {
  if (!fs.existsSync(CASH_BALANCE_CACHE)) {
    console.warn(
      `Cash-balance cache missing (${CASH_BALANCE_CACHE}); run \`tsx scripts/macro/fetch_cash_balance.ts\` to populate it.`,
    );
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CASH_BALANCE_CACHE, "utf8")) as {
      annual: Array<{ year: number; value: number | null }>;
    };
    return raw.annual
      .filter((p) => typeof p.value === "number")
      .map((p) => ({ year: p.year, value: p.value as number }));
  } catch (err) {
    console.warn(
      `Failed to read cash-balance cache: ${(err as Error).message}`,
    );
    return [];
  }
};

CURATED_INDICATORS.push({
  // Reuse the parser's own metadata so the attribution can't drift from what
  // fetch_cash_balance.ts actually reads (the МФ annual КФП workbook).
  ...CASH_META,
  key: "cashBalance",
  series: loadCashBalance(),
});

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

// Parse a Eurostat monthly time index ("YYYY-MM" keys) into raw monthly
// points, dropping nulls and anything before START_YEAR. Shared by the
// monthly-average-to-quarter aggregation and the full monthly-cadence branch.
const parseMonthlyPoints = (
  timeIndex: Record<string, number>,
  values: Record<string, number> | number[],
): { year: number; month: number; value: number }[] => {
  const out: { year: number; month: number; value: number }[] = [];
  for (const [key, idx] of Object.entries(timeIndex)) {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m) continue;
    const year = +m[1];
    const month = +m[2];
    if (year < START_YEAR) continue;
    const v = valueAt(values, idx);
    if (v === undefined) continue;
    out.push({ year, month, value: v });
  }
  return out;
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
    return aggregateMonthlyToQuarterly(parseMonthlyPoints(timeIndex, values));
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

  if (i.cadence === "monthly") {
    // Full monthly series (no aggregation). One point per YYYY-MM key.
    return parseMonthlyPoints(timeIndex, values)
      .map((p) => ({
        year: p.year,
        month: p.month,
        period: `${p.year}-${String(p.month).padStart(2, "0")}`,
        value: round(p.value, 2),
      }))
      .sort((a, b) => a.year - b.year || a.month - b.month);
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

const fetchMonthlyLatest = async (
  spec: MonthlyLatestSpec,
): Promise<MonthlyLatest | null> => {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  for (const [k, v] of Object.entries(spec.query)) params.append(k, v);
  const url = `${EUROSTAT_BASE}/${spec.dataset}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Eurostat monthly ${spec.key} returned ${res.status} for ${url}`,
    );
  }
  const json = (await res.json()) as EurostatResponse;
  const timeIndex = json.dimension.time.category.index;
  const values = json.value;
  // Walk every YYYY-MM key, keep only non-null, pick the chronologically latest.
  let best: { year: number; month: number; value: number } | null = null;
  for (const [key, idx] of Object.entries(timeIndex)) {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m) continue;
    const v = valueAt(values, idx);
    if (v === undefined) continue;
    const year = +m[1];
    const month = +m[2];
    if (
      !best ||
      year > best.year ||
      (year === best.year && month > best.month)
    ) {
      best = { year, month, value: v };
    }
  }
  if (!best) return null;
  return {
    period: `${best.year}-${String(best.month).padStart(2, "0")}`,
    year: best.year,
    month: best.month,
    value: round(best.value, 2),
    seasonallyAdjusted: spec.seasonallyAdjusted,
    datasetCode: spec.dataset,
    sourceUrl: spec.sourceUrl,
  };
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
  if (ind.cadence === "monthly") return MIN_POINTS_MONTHLY;
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

  // Monthly-latest callouts. A failure here is non-fatal — these are a
  // freshness garnish on top of the quarterly series, not core data — so a
  // single monthly dataset hiccup must not abort the whole macro build.
  const latestMonthly: Record<string, MonthlyLatest> = {};
  for (const spec of MONTHLY_LATEST_SPECS) {
    process.stdout.write(`Loading ${spec.key} monthly-latest... `);
    try {
      const point = await fetchMonthlyLatest(spec);
      if (point) {
        latestMonthly[spec.key] = point;
        console.log(`${point.period} = ${point.value}`);
      } else {
        console.log("no non-null month (skipped)");
      }
    } catch (err) {
      console.warn(`skipped: ${(err as Error).message}`);
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
    latestMonthly,
  };

  // Minified — ships to /public/ and is fetched client-side.
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload));
  console.log(`\nWrote ${OUT_FILE}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
