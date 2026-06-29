// Governance — macro indicator tools (national Eurostat/WB time series).

import { pickYearPoint } from "./args";
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
  // Cash КФП balance and overdue obligations are checked first so "касов
  // дефицит" / "просрочени задължения" win over the generic "дефицит" → ESA
  // budgetBalance alias below.
  if (/кфп|касов|cash balance|cash deficit/.test(q)) return "cashBalance";
  if (/просроч|overdue|arrears/.test(q)) return "arrears";
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
  // a named year pins the reported point (from the FULL series, so an older year
  // isn't lost to the default window); when pinned we show the whole series so
  // the marker is visible, else the last `take` points.
  const sel = pickYearPoint(series, args.year);
  const pinned = sel.year != null && !sel.missing;
  const n =
    typeof args.n === "number" ? args.n : parseInt(String(args.n ?? ""), 10);
  const take = Number.isFinite(n) && n > 0 ? Math.min(n, 60) : 24;
  const pts = pinned ? series : series.slice(Math.max(0, series.length - take));
  const title = ctx.lang === "bg" ? meta.titleBg : meta.titleEn;
  const unit = ctx.lang === "bg" ? meta.unitLabelBg : meta.unitLabelEn;
  const point = sel.point ?? lastPoint(pts);
  const xOf = (p: Point) => p.period ?? String(p.year);

  return {
    tool: "macroIndicator",
    domain: "indicators",
    kind: "series",
    title: `${unit ? `${title} (${unit})` : title}${pinned ? ` — ${sel.year}` : ""}`,
    subtitle: sel.missing
      ? ctx.lang === "bg"
        ? `Няма данни за ${sel.year}; показано е ${xOf(point)}.`
        : `No data for ${sel.year}; showing ${xOf(point)}.`
      : undefined,
    categories: pts.map(xOf),
    series: [
      {
        key: "value",
        label: title,
        points: pts.map((p) => ({ x: xOf(p), y: p.value })),
      },
    ],
    viz: "line",
    markers: pinned ? [{ x: xOf(point), label: String(sel.year) }] : undefined,
    facts: {
      indicator: title,
      latest_period: xOf(point),
      latest_value: point.value,
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
      "cashBalance",
      "govRevenue",
      "govExpenditure",
      "fiscalReserve",
      "arrears",
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

// ---- EU peer comparison (BG vs EU27 + CEE peers) ----------------------------
// Reads macro_peers.json — the data behind /indicators/compare. One indicator
// plotted over time for BG + EU27 + RO/GR/HU/HR, with BG-vs-EU27 latest in facts.

type PeerPoint = { period: string; value: number | null };
type PeerIndicator = {
  direction?: "higher" | "lower";
  series: Record<string, PeerPoint[]>;
};
type MacroPeers = {
  geos: string[];
  indicators: Record<string, PeerIndicator>;
  indicatorsAnnual: Record<string, PeerIndicator>;
};

const PEER_GEOS: { code: string; bg: string; en: string }[] = [
  { code: "BG", bg: "България", en: "Bulgaria" },
  { code: "EU27_2020", bg: "ЕС-27", en: "EU-27" },
  { code: "RO", bg: "Румъния", en: "Romania" },
  { code: "GR", bg: "Гърция", en: "Greece" },
  { code: "HU", bg: "Унгария", en: "Hungary" },
  { code: "HR", bg: "Хърватия", en: "Croatia" },
];

const PEER_INDICATORS: {
  key: string;
  bg: string;
  en: string;
  aliases: string[];
}[] = [
  {
    key: "inflation",
    bg: "Инфлация (ХИПЦ)",
    en: "Inflation (HICP)",
    aliases: ["инфлац", "hicp", "inflation"],
  },
  {
    key: "gdpGrowth",
    bg: "Ръст на БВП",
    en: "GDP growth",
    aliases: ["растеж", "ръст на бвп", "gdp growth", "икономически растеж"],
  },
  {
    key: "unemployment",
    bg: "Безработица",
    en: "Unemployment",
    aliases: ["безработиц", "unemployment"],
  },
  {
    key: "youthUnemployment",
    bg: "Младежка безработица",
    en: "Youth unemployment",
    aliases: ["младежк", "youth unemploy"],
  },
  {
    key: "govDebt",
    bg: "Държавен дълг (% БВП)",
    en: "Government debt (% GDP)",
    aliases: ["дълг", " debt"],
  },
  {
    key: "budgetBalance",
    bg: "Бюджетно салдо (% БВП)",
    en: "Budget balance (% GDP)",
    aliases: ["салдо", "дефицит", "balance", "deficit"],
  },
  {
    key: "currentAccount",
    bg: "Текуща сметка (% БВП)",
    en: "Current account (% GDP)",
    aliases: ["текуща сметка", "current account"],
  },
  {
    key: "housePricesYoY",
    bg: "Цени на жилищата (год.)",
    en: "House prices (YoY)",
    aliases: ["жилищ", "имотн", "house price", "property price"],
  },
  {
    key: "gini",
    bg: "Коефициент на Джини",
    en: "Gini coefficient",
    aliases: ["джини", "gini", "неравенств", "inequality"],
  },
  {
    key: "incomeQuintileRatio",
    bg: "Съотношение S80/S20",
    en: "Income quintile ratio S80/S20",
    aliases: ["квинтил", "quintile", "s80"],
  },
  {
    key: "arope",
    bg: "Риск от бедност (AROPE)",
    en: "At-risk-of-poverty (AROPE)",
    aliases: ["бедност", "poverty", "arope"],
  },
  {
    key: "lifeExpectancy",
    bg: "Продължителност на живота",
    en: "Life expectancy",
    aliases: ["продължителност на живот", "life expectancy"],
  },
  {
    key: "intentionalHomicideRate",
    bg: "Убийства (на 100 хил.)",
    en: "Intentional homicide rate (per 100k)",
    aliases: ["убийств", "homicide"],
  },
  {
    key: "prisonPopulationRate",
    bg: "Затворници (на 100 хил.)",
    en: "Prisoners (per 100k)",
    aliases: ["затворниц", "prison"],
  },
];

const resolvePeerIndicator = (raw: string) => {
  const q = raw.toLowerCase();
  return (
    PEER_INDICATORS.find((i) => i.aliases.some((a) => q.includes(a))) ??
    PEER_INDICATORS.find((i) => q.includes(i.key.toLowerCase()))
  );
};

export const euComparison = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const r2 = (n: number): number => Math.round(n * 100) / 100;
  const ind = resolvePeerIndicator(String(args.indicator ?? args.metric ?? ""));
  if (!ind) {
    return {
      tool: "euComparison",
      domain: "indicators",
      kind: "scalar",
      title: bg
        ? "Посочете показател за сравнение с ЕС"
        : "Name an indicator to compare with the EU",
      subtitle: PEER_INDICATORS.slice(0, 8)
        .map((i) => (bg ? i.bg : i.en))
        .join(", "),
      viz: "none",
      facts: { query: String(args.indicator ?? args.metric ?? "") },
      provenance: ["macro_peers.json"],
    };
  }
  const d = await fetchData<MacroPeers>("/macro_peers.json");
  const meta = d.indicators[ind.key] ?? d.indicatorsAnnual[ind.key];
  if (!meta) {
    return {
      tool: "euComparison",
      domain: "indicators",
      kind: "scalar",
      title: bg
        ? `Няма съпоставими данни за „${ind.bg}“`
        : `No comparable data for "${ind.en}"`,
      viz: "none",
      facts: { indicator: bg ? ind.bg : ind.en },
      provenance: ["macro_peers.json"],
    };
  }
  const lastOf = (geo: string): PeerPoint | undefined => {
    const s = meta.series[geo] ?? [];
    for (let i = s.length - 1; i >= 0; i--) if (s[i].value != null) return s[i];
    return undefined;
  };
  const present = PEER_GEOS.filter((g) => (meta.series[g.code] ?? []).length);
  const series = present.map((g) => ({
    key: g.code,
    label: bg ? g.bg : g.en,
    points: (meta.series[g.code] ?? []).map((p) => ({
      x: p.period,
      y: p.value,
    })),
  }));
  const categories = (meta.series.BG ?? []).map((p) => p.period);
  const bgLast = lastOf("BG");
  const euLast = lastOf("EU27_2020");
  const gap =
    bgLast && euLast && bgLast.value != null && euLast.value != null
      ? r2(bgLast.value - euLast.value)
      : null;
  return {
    tool: "euComparison",
    domain: "indicators",
    kind: "series",
    title: bg
      ? `${ind.bg}: България спрямо ЕС`
      : `${ind.en}: Bulgaria vs the EU`,
    subtitle: bg
      ? "България, ЕС-27, Румъния, Гърция, Унгария, Хърватия"
      : "Bulgaria, EU-27, Romania, Greece, Hungary, Croatia",
    categories,
    series,
    viz: "line",
    facts: {
      indicator: bg ? ind.bg : ind.en,
      bg: bgLast?.value != null ? r2(bgLast.value) : "—",
      eu27: euLast?.value != null ? r2(euLast.value) : "—",
      gap_vs_eu27: gap != null ? gap : "—",
      period: bgLast?.period ?? "—",
      direction: meta.direction ?? "—",
    },
    provenance: ["macro_peers.json"],
  };
};
