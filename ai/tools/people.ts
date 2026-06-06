// D1 — people & oversight tools: MP assets/connections, officials assets,
// party-financing filing compliance, polling accuracy.

import { fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt } from "./format";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

// ---- MP declared assets -----------------------------------------------------

type MpAsset = {
  label: string;
  partyGroupShort?: string;
  totalAssetsEur: number;
  totalDebtsEur?: number;
  netWorthEur?: number;
};

export const mpAssetsTop = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const d = await fetchData<{ topMps: MpAsset[] }>(
    "/parliament/assets-rankings-top.json",
  );
  const top = d.topMps.slice(0, 12);
  const columns: Column[] = [
    { key: "mp", label: ctx.lang === "bg" ? "Депутат" : "MP" },
    { key: "group", label: ctx.lang === "bg" ? "Група" : "Group" },
    {
      key: "assets",
      label: ctx.lang === "bg" ? "Активи" : "Assets",
      numeric: true,
    },
  ];
  const rows: Row[] = top.map((m) => ({
    mp: m.label,
    group: m.partyGroupShort ?? "—",
    assets: fmtEurCompact(m.totalAssetsEur, ctx.lang),
  }));
  return {
    tool: "mpAssetsTop",
    domain: "people",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? "Депутати с най-големи декларирани активи"
        : "MPs by declared assets",
    columns,
    rows,
    viz: "none",
    facts: {
      richest: top[0]?.label ?? "—",
      richest_assets: top[0]
        ? fmtEurCompact(top[0].totalAssetsEur, ctx.lang)
        : "—",
    },
    provenance: ["parliament/assets-rankings-top.json"],
  };
};

// ---- MP business connections ------------------------------------------------

type MpConn = {
  label: string;
  partyGroupShort?: string;
  totalDegree: number;
  highConfDegree?: number;
};

export const mpConnectionsTop = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const d = await fetchData<{ topMps: MpConn[] }>(
    "/parliament/connections-rankings-top.json",
  );
  const top = d.topMps.slice(0, 12);
  const columns: Column[] = [
    { key: "mp", label: ctx.lang === "bg" ? "Депутат" : "MP" },
    { key: "group", label: ctx.lang === "bg" ? "Група" : "Group" },
    {
      key: "links",
      label: ctx.lang === "bg" ? "Връзки" : "Links",
      numeric: true,
      format: "int",
    },
  ];
  const rows: Row[] = top.map((m) => ({
    mp: m.label,
    group: m.partyGroupShort ?? "—",
    links: m.totalDegree,
  }));
  return {
    tool: "mpConnectionsTop",
    domain: "people",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? "Депутати с най-много бизнес връзки"
        : "MPs by business connections",
    columns,
    rows,
    viz: "none",
    facts: {
      most_connected: top[0]?.label ?? "—",
      links: top[0]?.totalDegree ?? 0,
    },
    provenance: ["parliament/connections-rankings-top.json"],
  };
};

// ---- per-party rollups of MP assets / connections ---------------------------
// "which party's MPs are richest / most connected" — aggregate the full current
// roster by parliamentary group (the per-MP rankings already carry the group).

type GroupMp = {
  partyGroupShort?: string;
  isCurrent?: boolean;
  totalAssetsEur?: number;
  totalDegree?: number;
};

const cleanGroup = (g?: string): string =>
  (g ?? "—").replace(/^ПГ на\s+/i, "").trim();

const aggregateByParty = (
  mps: GroupMp[],
  value: (m: GroupMp) => number,
): { party: string; mps: number; sum: number; avg: number }[] => {
  const g = new Map<string, { mps: number; sum: number }>();
  for (const m of mps) {
    if (m.isCurrent === false) continue;
    const key = cleanGroup(m.partyGroupShort);
    if (key === "—") continue;
    const cur = g.get(key) ?? { mps: 0, sum: 0 };
    cur.mps += 1;
    cur.sum += value(m) || 0;
    g.set(key, cur);
  }
  return [...g].map(([party, t]) => ({
    party,
    mps: t.mps,
    sum: t.sum,
    avg: t.mps > 0 ? t.sum / t.mps : 0,
  }));
};

export const mpAssetsByParty = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const d = await fetchData<{ topMps: GroupMp[] }>(
    "/parliament/assets-rankings.json",
  );
  const rows0 = aggregateByParty(d.topMps, (m) => m.totalAssetsEur ?? 0).sort(
    (a, b) => b.avg - a.avg,
  );
  const top = rows0[0];
  const rows: Row[] = rows0.map((r) => ({
    party: r.party,
    mps: r.mps,
    avg: fmtEurCompact(r.avg, ctx.lang),
    total: fmtEurCompact(r.sum, ctx.lang),
  }));
  return {
    tool: "mpAssetsByParty",
    domain: "people",
    kind: "table",
    title: bg
      ? "Декларирани активи по партия (средно на депутат)"
      : "Declared assets by party (average per MP)",
    columns: [
      { key: "party", label: bg ? "Партия" : "Party" },
      {
        key: "mps",
        label: bg ? "Депутати" : "MPs",
        numeric: true,
        format: "int",
      },
      { key: "avg", label: bg ? "Средно" : "Average", numeric: true },
      { key: "total", label: bg ? "Общо" : "Total", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      richest_party: top
        ? `${top.party} (${fmtEurCompact(top.avg, ctx.lang)})`
        : "—",
    },
    provenance: ["parliament/assets-rankings.json"],
  };
};

export const mpConnectionsByParty = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const d = await fetchData<{ topMps: GroupMp[] }>(
    "/parliament/connections-rankings.json",
  );
  const rows0 = aggregateByParty(d.topMps, (m) => m.totalDegree ?? 0).sort(
    (a, b) => b.sum - a.sum,
  );
  const top = rows0[0];
  const rows: Row[] = rows0.map((r) => ({
    party: r.party,
    mps: r.mps,
    links: Math.round(r.sum),
    avg: Math.round(r.avg * 10) / 10,
  }));
  return {
    tool: "mpConnectionsByParty",
    domain: "people",
    kind: "table",
    title: bg ? "Бизнес връзки по партия" : "Business connections by party",
    subtitle: bg
      ? "Общ брой фирмени връзки на депутатите от групата"
      : "Total company links across the group's MPs",
    columns: [
      { key: "party", label: bg ? "Партия" : "Party" },
      {
        key: "mps",
        label: bg ? "Депутати" : "MPs",
        numeric: true,
        format: "int",
      },
      {
        key: "links",
        label: bg ? "Връзки" : "Links",
        numeric: true,
        format: "int",
      },
      { key: "avg", label: bg ? "Средно" : "Avg/MP", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      most_connected_party: top ? `${top.party} (${Math.round(top.sum)})` : "—",
    },
    provenance: ["parliament/connections-rankings.json"],
  };
};

// ---- officials declared assets ----------------------------------------------

type Official = {
  name: string;
  category: string;
  institution?: string;
  totalAssetsEur: number;
};
const OFFICIAL_CAT: Record<string, { bg: string; en: string }> = {
  cabinet: { bg: "кабинет", en: "cabinet" },
  deputy_minister: { bg: "зам.-министри", en: "deputy ministers" },
  agency_head: { bg: "агенции", en: "agency heads" },
  regional_governor: { bg: "областни управители", en: "regional governors" },
};

export const officialsAssetsTop = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const d = await fetchData<{ topOfficials: Official[] }>(
    "/officials/assets-rankings.json",
  );
  const catArg = String(args.category ?? "").toLowerCase();
  const cat = Object.keys(OFFICIAL_CAT).find(
    (k) =>
      catArg.includes(k) ||
      catArg.includes(OFFICIAL_CAT[k].bg) ||
      catArg.includes(OFFICIAL_CAT[k].en),
  );
  let list = d.topOfficials;
  if (cat) list = list.filter((o) => o.category === cat);
  const top = [...list]
    .sort((a, b) => b.totalAssetsEur - a.totalAssetsEur)
    .slice(0, 12);
  const columns: Column[] = [
    { key: "name", label: ctx.lang === "bg" ? "Лице" : "Official" },
    { key: "inst", label: ctx.lang === "bg" ? "Институция" : "Institution" },
    {
      key: "assets",
      label: ctx.lang === "bg" ? "Активи" : "Assets",
      numeric: true,
    },
  ];
  const rows: Row[] = top.map((o) => ({
    name: o.name,
    inst: o.institution ?? OFFICIAL_CAT[o.category]?.[ctx.lang] ?? o.category,
    assets: fmtEurCompact(o.totalAssetsEur, ctx.lang),
  }));
  return {
    tool: "officialsAssetsTop",
    domain: "people",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Висши служители с най-големи активи${cat ? ` (${OFFICIAL_CAT[cat].bg})` : ""}`
        : `Officials by declared assets${cat ? ` (${OFFICIAL_CAT[cat].en})` : ""}`,
    columns,
    rows,
    viz: "none",
    facts: {
      richest: top[0]?.name ?? "—",
      richest_assets: top[0]
        ? fmtEurCompact(top[0].totalAssetsEur, ctx.lang)
        : "—",
    },
    provenance: ["officials/assets-rankings.json"],
  };
};

// ---- party-financing filing compliance --------------------------------------

type FinYear = {
  year: number;
  counts: {
    on_time: number;
    late: number;
    non_compliant: number;
    not_filed: number;
  };
};
type FinReports = {
  totals: { distinctParties: number; filings: number };
  years: FinYear[];
};

export const financingOverview = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const d = await fetchData<FinReports>("/financing/reports.json");
  const years = [...d.years].sort((a, b) => b.year - a.year).slice(0, 8);
  const columns: Column[] = [
    {
      key: "year",
      label: ctx.lang === "bg" ? "Година" : "Year",
      format: "int",
    },
    {
      key: "on_time",
      label: ctx.lang === "bg" ? "Навреме" : "On time",
      numeric: true,
      format: "int",
    },
    {
      key: "late",
      label: ctx.lang === "bg" ? "Закъснели" : "Late",
      numeric: true,
      format: "int",
    },
    {
      key: "missing",
      label: ctx.lang === "bg" ? "Неподали" : "Not filed",
      numeric: true,
      format: "int",
    },
  ];
  const rows: Row[] = years.map((y) => ({
    year: y.year,
    on_time: y.counts.on_time,
    late: y.counts.late,
    missing: y.counts.non_compliant + y.counts.not_filed,
  }));
  const latest = years[0];
  return {
    tool: "financingOverview",
    domain: "people",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? "Партийни финансови отчети — подаване (Сметна палата)"
        : "Party financial reports — filing (Court of Audit)",
    columns,
    rows,
    viz: "none",
    facts: {
      distinct_parties: fmtInt(d.totals.distinctParties, ctx.lang),
      total_filings: fmtInt(d.totals.filings, ctx.lang),
      latest_year: latest?.year ?? "—",
      latest_on_time: latest?.counts.on_time ?? 0,
    },
    provenance: ["financing/reports.json"],
  };
};

// ---- polling accuracy -------------------------------------------------------

type AgencyProfile = {
  name_bg: string;
  name_en: string;
  totalPolls: number;
  overallMAE: number;
  overallRMSE?: number;
  grade?: string;
  barrierCallRate?: number;
};

export const pollAccuracy = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const d = await fetchData<{ agencyProfiles: AgencyProfile[] }>(
    "/polls/accuracy.json",
  );
  // lower mean absolute error = more accurate
  const ranked = [...d.agencyProfiles]
    .filter((a) => Number.isFinite(a.overallMAE))
    .sort((a, b) => a.overallMAE - b.overallMAE)
    .slice(0, 12);
  const columns: Column[] = [
    { key: "agency", label: ctx.lang === "bg" ? "Агенция" : "Agency" },
    { key: "grade", label: ctx.lang === "bg" ? "Оценка" : "Grade" },
    {
      key: "polls",
      label: ctx.lang === "bg" ? "Проучвания" : "Polls",
      numeric: true,
      format: "int",
    },
    {
      key: "mae",
      label: ctx.lang === "bg" ? "Грешка (MAE)" : "Error (MAE)",
      numeric: true,
    },
    {
      key: "threshold",
      label: ctx.lang === "bg" ? "Праг %" : "Threshold %",
      numeric: true,
    },
  ];
  const rows: Row[] = ranked.map((a) => ({
    agency: ctx.lang === "bg" ? a.name_bg : a.name_en,
    grade: a.grade ?? "—",
    polls: a.totalPolls,
    mae: `${a.overallMAE} pp`,
    threshold:
      a.barrierCallRate != null
        ? `${Math.round(a.barrierCallRate * 100)}%`
        : "—",
  }));
  const best = ranked[0];
  return {
    tool: "pollAccuracy",
    domain: "elections",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? "Точност на социологическите агенции"
        : "Polling-agency accuracy",
    columns,
    rows,
    viz: "none",
    facts: {
      most_accurate: best
        ? ctx.lang === "bg"
          ? best.name_bg
          : best.name_en
        : "—",
      best_grade: best?.grade ?? "—",
      best_mae: best ? `${best.overallMAE} pp` : "—",
    },
    provenance: ["polls/accuracy.json"],
  };
};
