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
