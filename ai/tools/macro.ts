// Governance — macro indicator tools (national Eurostat/WB time series).

import { fetchData } from "./dataClient";
import { fmtInt } from "./format";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

type IndicatorMeta = {
  titleBg: string;
  titleEn: string;
  unitLabelBg?: string;
  unitLabelEn?: string;
  cadence?: string;
};
type Point = { year: number; quarter?: number; period?: string; value: number };
type MacroData = {
  indicators: Record<string, IndicatorMeta>;
  series: Record<string, Point[]>;
};

// Free-text -> macro indicator key. Shared with the router.
export const MACRO_ALIASES: Record<string, string> = {
  инфлация: "inflation",
  inflation: "inflation",
  безработица: "unemployment",
  unemployment: "unemployment",
  бвп: "gdpGrowth",
  растеж: "gdpGrowth",
  gdp: "gdpGrowth",
  growth: "gdpGrowth",
  дълг: "govDebt",
  debt: "govDebt",
  дефицит: "budgetBalance",
  баланс: "budgetBalance",
  deficit: "budgetBalance",
  бедност: "povertyRate",
  poverty: "povertyRate",
  корупция: "wgiControlOfCorruption",
  corruption: "wgiControlOfCorruption",
  доверие: "trustGovernment",
  trust: "trustGovernment",
  // wider coverage so the 40 indicators in macro.json are actually reachable
  "на човек": "gdpPerCapita",
  "per capita": "gdpPerCapita",
  заплат: "labourIncome",
  доход: "labourIncome",
  wage: "labourIncome",
  "текуща сметка": "currentAccount",
  "current account": "currentAccount",
  чужди: "fdiInward",
  fdi: "fdiInward",
  инвестиц: "fdiInward",
  приходи: "govRevenue",
  revenue: "govRevenue",
  разходи: "govExpenditure",
  expenditure: "govExpenditure",
  spending: "govExpenditure",
  резерв: "fiscalReserve",
  reserve: "fiscalReserve",
  младежка: "youthUnemployment",
  youth: "youthUnemployment",
  жилищ: "housePricesYoY",
  "house price": "housePricesYoY",
  имоти: "housePricesYoY",
  неравенств: "gini",
  gini: "gini",
  джини: "gini",
  убийств: "intentionalHomicideRate",
  homicide: "intentionalHomicideRate",
  затвор: "prisonPopulationRate",
  prison: "prisonPopulationRate",
  върховенство: "wgiRuleOfLaw",
  "rule of law": "wgiRuleOfLaw",
  ефективн: "wgiGovEffectiveness",
  effectiveness: "wgiGovEffectiveness",
  промишлен: "industrialProd",
  industrial: "industrialProd",
  търговия: "retailVolume",
  retail: "retailVolume",
  потребител: "consumerConfidence",
  confidence: "consumerConfidence",
  настроени: "economicSentiment",
  sentiment: "economicSentiment",
  цени: "cpi",
  cpi: "cpi",
};

export const resolveMacroKey = (raw: string): string | undefined => {
  const q = raw.toLowerCase().trim();
  if (MACRO_ALIASES[q]) return MACRO_ALIASES[q];
  for (const [k, v] of Object.entries(MACRO_ALIASES))
    if (q.includes(k)) return v;
  return undefined;
};

const OVERVIEW_KEYS = [
  "gdpGrowth",
  "inflation",
  "unemployment",
  "govDebt",
  "budgetBalance",
];

const lastPoint = (pts: Point[]) => pts[pts.length - 1];

export const macroIndicator = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const m = await fetchData<MacroData>("/macro.json");
  const key =
    (typeof args.indicator === "string" && resolveMacroKey(args.indicator)) ||
    "gdpGrowth";
  const meta = m.indicators[key];
  const series = m.series[key] ?? [];
  if (!meta || series.length === 0) {
    return {
      tool: "macroIndicator",
      domain: "indicators",
      kind: "scalar",
      title: ctx.lang === "bg" ? "Няма такъв показател" : "No such indicator",
      viz: "none",
      facts: { indicator: key },
      provenance: ["macro.json"],
    };
  }
  const n =
    typeof args.n === "number" ? args.n : parseInt(String(args.n ?? ""), 10);
  const take = Number.isFinite(n) && n > 0 ? Math.min(n, 60) : 24;
  const pts = series.slice(Math.max(0, series.length - take));
  const title = ctx.lang === "bg" ? meta.titleBg : meta.titleEn;
  const unit = ctx.lang === "bg" ? meta.unitLabelBg : meta.unitLabelEn;
  const last = lastPoint(pts);

  return {
    tool: "macroIndicator",
    domain: "indicators",
    kind: "series",
    title: unit ? `${title} (${unit})` : title,
    categories: pts.map((p) => p.period ?? String(p.year)),
    series: [
      {
        key: "value",
        label: title,
        points: pts.map((p) => ({ x: p.period ?? String(p.year), y: p.value })),
      },
    ],
    viz: "line",
    facts: {
      indicator: title,
      latest_period: last.period ?? String(last.year),
      latest_value: last.value,
    },
    provenance: ["macro.json"],
  };
};

export const macroOverview = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const m = await fetchData<MacroData>("/macro.json");
  const columns: Column[] = [
    { key: "indicator", label: ctx.lang === "bg" ? "Показател" : "Indicator" },
    {
      key: "latest",
      label: ctx.lang === "bg" ? "Последно" : "Latest",
      numeric: true,
    },
    { key: "period", label: ctx.lang === "bg" ? "Период" : "Period" },
  ];
  const rows: Row[] = [];
  const facts: Record<string, string | number> = {};
  for (const key of OVERVIEW_KEYS) {
    const meta = m.indicators[key];
    const pts = m.series[key];
    if (!meta || !pts || pts.length === 0) continue;
    const last = lastPoint(pts);
    const title = ctx.lang === "bg" ? meta.titleBg : meta.titleEn;
    rows.push({
      indicator: title,
      latest: `${last.value}${meta.unitLabelEn?.includes("%") ? "%" : ""}`,
      period: last.period ?? String(last.year),
    });
    facts[title] = `${last.value} (${last.period ?? last.year})`;
  }
  return {
    tool: "macroOverview",
    domain: "indicators",
    kind: "table",
    title: ctx.lang === "bg" ? "Макроикономически преглед" : "Macro snapshot",
    columns,
    rows,
    viz: "none",
    facts: { indicators: fmtInt(rows.length, ctx.lang), ...facts },
    provenance: ["macro.json"],
  };
};

// The 4 domain groupings the site uses (/indicators/economy|fiscal|governance|society).
const CATEGORIES: Record<
  string,
  { label: { bg: string; en: string }; keys: string[] }
> = {
  economy: {
    label: { bg: "Икономика", en: "Economy" },
    keys: [
      "gdpGrowth",
      "gdpPerCapita",
      "inflation",
      "unemployment",
      "industrialProd",
      "fdiInward",
    ],
  },
  fiscal: {
    label: { bg: "Фискални", en: "Fiscal" },
    keys: [
      "govDebt",
      "budgetBalance",
      "govRevenue",
      "govExpenditure",
      "fiscalReserve",
    ],
  },
  governance: {
    label: { bg: "Управление", en: "Governance" },
    keys: [
      "wgiRuleOfLaw",
      "wgiControlOfCorruption",
      "wgiGovEffectiveness",
      "trustGovernment",
      "trustParliament",
      "trustEu",
    ],
  },
  society: {
    label: { bg: "Общество", en: "Society" },
    keys: [
      "gini",
      "povertyRate",
      "youthUnemployment",
      "housePricesYoY",
      "intentionalHomicideRate",
      "prisonPopulationRate",
    ],
  },
};

const resolveCategory = (raw: string): string => {
  const q = raw.toLowerCase();
  if (q.includes("икон") || q.includes("econom")) return "economy";
  if (q.includes("фискал") || q.includes("fiscal") || q.includes("бюджет"))
    return "fiscal";
  if (
    q.includes("управл") ||
    q.includes("govern") ||
    q.includes("корупц") ||
    q.includes("доверие")
  )
    return "governance";
  if (
    q.includes("общест") ||
    q.includes("social") ||
    q.includes("society") ||
    q.includes("неравен")
  )
    return "society";
  return "economy";
};

export const macroByCategory = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const m = await fetchData<MacroData>("/macro.json");
  const cat =
    CATEGORIES[
      resolveCategory(String(args.category ?? args.indicator ?? "economy"))
    ];
  const columns: Column[] = [
    { key: "indicator", label: ctx.lang === "bg" ? "Показател" : "Indicator" },
    {
      key: "latest",
      label: ctx.lang === "bg" ? "Последно" : "Latest",
      numeric: true,
    },
    { key: "period", label: ctx.lang === "bg" ? "Период" : "Period" },
  ];
  const rows: Row[] = [];
  for (const key of cat.keys) {
    const meta = m.indicators[key];
    const pts = m.series[key];
    if (!meta || !pts || pts.length === 0) continue;
    const last = lastPoint(pts);
    rows.push({
      indicator: ctx.lang === "bg" ? meta.titleBg : meta.titleEn,
      latest: `${last.value}${meta.unitLabelEn?.includes("%") ? "%" : ""}`,
      period: last.period ?? String(last.year),
    });
  }
  return {
    tool: "macroByCategory",
    domain: "indicators",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Показатели — ${cat.label.bg}`
        : `Indicators — ${cat.label.en}`,
    columns,
    rows,
    viz: "none",
    facts: {
      category: cat.label[ctx.lang],
      indicators: fmtInt(rows.length, ctx.lang),
    },
    provenance: ["macro.json"],
  };
};
