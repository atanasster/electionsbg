// NGO (ЮЛНЦ — сдружения / фондации / читалища) tools. The site pages serve NGO
// data live from Postgres, but the browser AI reads static JSON, so these tools
// read the compact aggregate at data/ngo/ai_summary.json (built by
// scripts/ngo/build_ai_summary.ts). They answer overview questions — how many
// NGOs, who gets the most public/external money, which authorities send the most
// to politically-linked suppliers. For a single NGO's detail the assistant
// points to /company/:eik and /procurement/ngos.

import { fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt } from "./format";
import type { Envelope, Row, ToolArgs, ToolContext } from "./types";

type NgoSummary = {
  totals: {
    ngos: number;
    touchingPublicMoney: number;
    externalFundingEur: number;
    contractsEur: number;
  };
  byType: { ngo_type: string; count: number }[];
  fundingBySource: { source: string; eur: number; ngos: number }[];
  topFunded: { eik: string; name: string; eur: number; sources: string[] }[];
  topKindexAwarders: {
    eik: string;
    name: string;
    sharePct: number;
    linkedEur: number;
    linkedSuppliers: number;
  }[];
  signals?: {
    withSignal: number;
    surface: number;
    byCode: { code: string; count: number }[];
    topByCode: Record<
      string,
      { eik: string; name: string; eur: number | null }[]
    >;
  };
};

const SUMMARY = "/ngo/ai_summary.json";
const clean = (s: string): string => s.replace(/&quot;/g, '"').trim();

const SOURCE_LABEL: Record<string, { bg: string; en: string }> = {
  eu_fts: { bg: "ЕС (пряко управление)", en: "EU (direct)" },
  budget_subsidy: { bg: "Държавна субсидия", en: "State subsidy" },
  abf: { bg: "Америка за България", en: "America for Bulgaria" },
  ned: { bg: "NED", en: "NED" },
};
// Public-interest signal codes (migration 080) → labels. Mirrors NGO_SIGNAL_META
// on the UI side; kept here because the AI bundle reads static JSON, not the app.
const SIGNAL_LABEL: Record<string, { bg: string; en: string }> = {
  politician_board: {
    bg: "Политик в ръководството",
    en: "Politician on board",
  },
  magistrate_board: {
    bg: "Магистрат в ръководството",
    en: "Magistrate on board",
  },
  related_party: {
    bg: "Свързана фирма в управата",
    en: "Related-party firm on board",
  },
  public_contracts: { bg: "Обществени поръчки", en: "Public contracts" },
  single_bid: { bg: "Един кандидат", en: "Single bidder" },
  eu_funds: { bg: "Средства от ЕС", en: "EU funds" },
  budget_subsidy: { bg: "Държавна субсидия", en: "State subsidy" },
  foreign_funded: { bg: "Външно финансиране", en: "External funding" },
  large: { bg: "Голям бюджет", en: "Large budget" },
};

const NGO_TYPE_LABEL: Record<string, { bg: string; en: string }> = {
  sport: { bg: "спортни клубове", en: "sports clubs" },
  chitalishte: { bg: "читалища", en: "community centres" },
  chamber: { bg: "браншови организации", en: "industry bodies" },
  school: { bg: "училищни настоятелства", en: "school boards" },
  hunting: { bg: "ловно-рибарски", en: "hunting & fishing" },
  professional: { bg: "професионални", en: "professional" },
  other: { bg: "други", en: "other" },
};

// Overview: how many NGOs, how much public + external money reaches them.
export const ngoOverview = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const s = await fetchData<NgoSummary>(SUMMARY);
  const t = s.totals;
  const rows: Row[] = [
    {
      metric: bg ? "Организации (ЮЛНЦ)" : "Non-profits (NPOs)",
      value: fmtInt(t.ngos, ctx.lang),
    },
    {
      metric: bg ? "С публично финансиране" : "Touching public money",
      value: fmtInt(t.touchingPublicMoney, ctx.lang),
    },
    {
      metric: bg ? "Външно финансиране (общо)" : "External funding (total)",
      value: fmtEurCompact(t.externalFundingEur, ctx.lang),
    },
    {
      metric: bg ? "Обществени поръчки (общо)" : "Public contracts (total)",
      value: fmtEurCompact(t.contractsEur, ctx.lang),
    },
  ];
  for (const src of s.fundingBySource) {
    const l = SOURCE_LABEL[src.source];
    rows.push({
      metric: `— ${l ? (bg ? l.bg : l.en) : src.source}`,
      value: fmtEurCompact(src.eur, ctx.lang),
    });
  }
  if (s.signals) {
    rows.push({
      metric: bg
        ? "С публично-значими сигнали"
        : "With public-interest signals",
      value: fmtInt(s.signals.withSignal, ctx.lang),
    });
  }
  const topTypes = s.byType
    .slice(0, 3)
    .map((x) => {
      const l = NGO_TYPE_LABEL[x.ngo_type];
      return `${l ? (bg ? l.bg : l.en) : x.ngo_type} (${fmtInt(x.count, ctx.lang)})`;
    })
    .join(", ");
  return {
    tool: "ngoOverview",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Организации с нестопанска цел — обзор"
      : "Non-profit organisations — overview",
    subtitle: bg
      ? `Най-чести видове: ${topTypes}`
      : `Most common types: ${topTypes}`,
    columns: [
      { key: "metric", label: bg ? "Показател" : "Metric" },
      { key: "value", label: bg ? "Стойност" : "Value", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      ngos: t.ngos,
      touching_public_money: t.touchingPublicMoney,
      external_funding: fmtEurCompact(t.externalFundingEur, ctx.lang),
      contracts: fmtEurCompact(t.contractsEur, ctx.lang),
      ...(s.signals ? { with_signal: s.signals.withSignal } : {}),
    },
    provenance: ["ngo/ai_summary.json"],
  };
};

// Signal distribution — how many NGOs carry each public-interest signal
// (procurement, EU funds, subsidies, external funding, single-bid, large).
export const ngoRiskSignals = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const s = await fetchData<NgoSummary>(SUMMARY);
  const sig = s.signals;
  const rows: Row[] = (sig?.byCode ?? []).map((c) => {
    const l = SIGNAL_LABEL[c.code];
    return {
      signal: l ? (bg ? l.bg : l.en) : c.code,
      ngos: fmtInt(c.count, ctx.lang),
    };
  });
  const top = sig?.byCode[0];
  return {
    tool: "ngoRiskSignals",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "НПО по публично-значими сигнали"
      : "NGOs by public-interest signal",
    subtitle: bg
      ? `${fmtInt(sig?.withSignal ?? 0, ctx.lang)} организации с поне един сигнал`
      : `${fmtInt(sig?.withSignal ?? 0, ctx.lang)} organisations with at least one signal`,
    columns: [
      { key: "signal", label: bg ? "Сигнал" : "Signal" },
      { key: "ngos", label: bg ? "Брой НПО" : "NGOs", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      with_signal: sig?.withSignal ?? 0,
      ...(top
        ? {
            top_signal: SIGNAL_LABEL[top.code]
              ? bg
                ? SIGNAL_LABEL[top.code].bg
                : SIGNAL_LABEL[top.code].en
              : top.code,
            top_signal_count: top.count,
          }
        : {}),
    },
    provenance: ["ngo/ai_summary.json"],
  };
};

// Top NGOs carrying a specific signal. `code` defaults to public_contracts.
export const ngoBySignal = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const s = await fetchData<NgoSummary>(SUMMARY);
  const code =
    typeof args?.code === "string" && SIGNAL_LABEL[args.code]
      ? args.code
      : "public_contracts";
  const list = s.signals?.topByCode[code] ?? [];
  const rows: Row[] = list.slice(0, 15).map((r) => ({
    name: clean(r.name),
    eik: r.eik,
    amount: r.eur != null ? fmtEurCompact(r.eur, ctx.lang) : "—",
  }));
  const label = SIGNAL_LABEL[code];
  const top = list[0];
  return {
    tool: "ngoBySignal",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `НПО със сигнал: ${label ? label.bg : code}`
      : `NGOs with signal: ${label ? label.en : code}`,
    subtitle: bg
      ? "Показател за публичен интерес — следа, не доказателство"
      : "Public-interest indicator — a trace, not proof",
    columns: [
      { key: "name", label: bg ? "Организация" : "Organisation" },
      { key: "eik", label: "ЕИК" },
      { key: "amount", label: bg ? "Сума" : "Amount", numeric: true },
    ],
    rows,
    viz: "none",
    facts: top
      ? {
          top_ngo: clean(top.name),
          ...(top.eur != null
            ? { top_amount: fmtEurCompact(top.eur, ctx.lang) }
            : {}),
        }
      : {},
    provenance: ["ngo/ai_summary.json"],
  };
};

// Top NGOs by external funding (EU direct funds + state subsidies).
export const ngoTopFunded = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const s = await fetchData<NgoSummary>(SUMMARY);
  const rows: Row[] = s.topFunded.slice(0, 15).map((r) => ({
    name: clean(r.name),
    eik: r.eik,
    source: r.sources
      .map((x) =>
        SOURCE_LABEL[x] ? (bg ? SOURCE_LABEL[x].bg : SOURCE_LABEL[x].en) : x,
      )
      .join(", "),
    amount: fmtEurCompact(r.eur, ctx.lang),
  }));
  const top = s.topFunded[0];
  return {
    tool: "ngoTopFunded",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Най-финансирани НПО (външно финансиране)"
      : "Best-funded NGOs (external funding)",
    subtitle: bg
      ? "Абсолютни суми от именувани донори — ЕС и държавни субсидии"
      : "Absolute amounts from named funders — EU + state subsidies",
    columns: [
      { key: "name", label: bg ? "Организация" : "Organisation" },
      { key: "eik", label: "ЕИК" },
      { key: "source", label: bg ? "Източник" : "Source" },
      { key: "amount", label: bg ? "Сума" : "Amount", numeric: true },
    ],
    rows,
    viz: "none",
    facts: top
      ? {
          top_ngo: clean(top.name),
          top_amount: fmtEurCompact(top.eur, ctx.lang),
        }
      : {},
    provenance: ["ngo/ai_summary.json"],
  };
};

// Awarder K-Index: authorities whose contract value most flows to suppliers
// linked to politics (owned/managed by an official, or governed via an NGO board).
export const ngoConflictAwarders = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const s = await fetchData<NgoSummary>(SUMMARY);
  const rows: Row[] = s.topKindexAwarders.slice(0, 15).map((r) => ({
    awarder: clean(r.name),
    share: `${Math.round(r.sharePct * 100)}%`,
    linked: fmtEurCompact(r.linkedEur, ctx.lang),
    suppliers: fmtInt(r.linkedSuppliers, ctx.lang),
  }));
  const top = s.topKindexAwarders[0];
  return {
    tool: "ngoConflictAwarders",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Възложители със свързани изпълнители (К-индекс)"
      : "Authorities with linked suppliers (K-Index)",
    subtitle: bg
      ? "Дял от възложените средства към политически свързани изпълнители"
      : "Share of awarded value going to politically linked suppliers",
    columns: [
      { key: "awarder", label: bg ? "Възложител" : "Authority" },
      { key: "share", label: bg ? "Дял" : "Share", numeric: true },
      { key: "linked", label: bg ? "Сума" : "Amount", numeric: true },
      {
        key: "suppliers",
        label: bg ? "Изпълнители" : "Suppliers",
        numeric: true,
      },
    ],
    rows,
    viz: "none",
    facts: top
      ? {
          top_awarder: clean(top.name),
          top_share: `${Math.round(top.sharePct * 100)}%`,
          top_linked: fmtEurCompact(top.linkedEur, ctx.lang),
        }
      : {},
    provenance: ["ngo/ai_summary.json"],
  };
};
