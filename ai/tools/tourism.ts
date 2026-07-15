// Туризъм (tourism) tools — the Eurostat visitor statistics behind the
// /sector/tourism dashboard, served from data/tourism/visitors.json. Nights
// spent by foreign vs domestic guests (seasonality) and by the tourist's country
// of origin (source markets). The unit is NIGHTS, not €. Mirrors the culture
// tool's Envelope shape; tools NEVER compute a number in prose — the narrator
// only ever reads `facts`.

import { fetchData } from "./dataClient";
import { fmtInt, fmtPct } from "./format";
import type { ToolArgs, ToolContext, Envelope } from "./types";
import {
  TOURISM_MARKET_NAMES_BG,
  MONTH_NAMES_BG,
  MONTH_NAMES_EN,
} from "@/lib/tourismLabels";

interface SeasonMonth {
  month: number;
  foreign: number;
  domestic: number;
}
interface OriginMarket {
  code: string;
  name: string;
  nights: number;
}
interface VisitorsFile {
  seasonalityYear: number;
  peakMonth: number;
  summerShareForeign: number;
  winterShareForeign: number;
  seasonality: SeasonMonth[];
  annualForeign: { year: number; nights: number }[];
  sourceMarketsYear: number;
  sourceMarketsForeignTotal: number;
  sourceMarkets: OriginMarket[];
}

const noData = (tool: string, bg: boolean): Envelope => ({
  tool,
  domain: "indicators",
  kind: "scalar",
  title: bg ? "Няма данни за туризъм" : "No tourism data",
  facts: {},
  viz: "none",
  provenance: ["tourism/visitors.json"],
});

export const tourismSeasonality = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const v = await fetchData<VisitorsFile | null>("/tourism/visitors.json");
  if (!v || !v.seasonality?.length) return noData("tourismSeasonality", bg);

  const names = bg ? MONTH_NAMES_BG : MONTH_NAMES_EN;
  const rows = v.seasonality.map((m) => ({
    month: names[m.month - 1],
    foreign: fmtInt(m.foreign, ctx.lang),
    domestic: fmtInt(m.domestic, ctx.lang),
  }));
  const latestForeign =
    v.annualForeign[v.annualForeign.length - 1]?.nights ?? 0;

  return {
    tool: "tourismSeasonality",
    domain: "indicators",
    kind: "table",
    title: bg
      ? `Сезонност на нощувките в България — ${v.seasonalityYear}`
      : `Bulgaria overnight-stay seasonality — ${v.seasonalityYear}`,
    subtitle: bg
      ? "Нощувки по месец (Евростат)"
      : "Nights per month (Eurostat)",
    columns: [
      { key: "month", label: bg ? "Месец" : "Month" },
      { key: "foreign", label: bg ? "Чуждестранни" : "Foreign", numeric: true },
      { key: "domestic", label: bg ? "Местни" : "Domestic", numeric: true },
    ],
    rows,
    viz: "bar",
    facts: {
      year: v.seasonalityYear,
      peakMonth: names[v.peakMonth - 1],
      summerShareForeign: fmtPct(v.summerShareForeign, ctx.lang),
      winterShareForeign: fmtPct(v.winterShareForeign, ctx.lang),
      foreignNightsLatest: fmtInt(latestForeign, ctx.lang),
    },
    provenance: ["tourism/visitors.json"],
  };
};

export const tourismSourceMarkets = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const v = await fetchData<VisitorsFile | null>("/tourism/visitors.json");
  if (!v || !v.sourceMarkets?.length) return noData("tourismSourceMarkets", bg);

  const total = v.sourceMarketsForeignTotal || 1;
  const rows = v.sourceMarkets.slice(0, 10).map((m) => ({
    country: bg ? (TOURISM_MARKET_NAMES_BG[m.code] ?? m.name) : m.name,
    nights: fmtInt(m.nights, ctx.lang),
    share: fmtPct(m.nights / total, ctx.lang),
  }));
  const lead = v.sourceMarkets[0];

  return {
    tool: "tourismSourceMarkets",
    domain: "indicators",
    kind: "table",
    title: bg
      ? `Пазари на произход на туристите — ${v.sourceMarketsYear}`
      : `Tourist source markets — ${v.sourceMarketsYear}`,
    subtitle: bg
      ? "Нощувки по държава на произход (Евростат)"
      : "Nights by country of origin (Eurostat)",
    columns: [
      { key: "country", label: bg ? "Държава" : "Country" },
      { key: "nights", label: bg ? "Нощувки" : "Nights", numeric: true },
      { key: "share", label: bg ? "Дял" : "Share", numeric: true },
    ],
    rows,
    viz: "bar",
    facts: {
      year: v.sourceMarketsYear,
      topMarket: lead
        ? bg
          ? (TOURISM_MARKET_NAMES_BG[lead.code] ?? lead.name)
          : lead.name
        : "—",
      topShare: lead ? fmtPct(lead.nights / total, ctx.lang) : "—",
      marketCount: fmtInt(v.sourceMarkets.length, ctx.lang),
    },
    provenance: ["tourism/visitors.json"],
  };
};
