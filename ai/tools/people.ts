// D1 — people & oversight tools: MP assets/connections, officials assets,
// party-financing filing compliance, polling accuracy.

import { fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt } from "./format";
import { ALL_ELECTIONS } from "./dataset";
import { matchParty } from "./matchParty";
import type { CompanyConnections } from "../../src/data/parliament/useCompanyConnections";
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

// ---- party campaign finance (income / expenses for one party) ---------------
// Reads the per-election filing at {election}/parties/financing.json (Court of
// Audit). financingOverview above is the cross-party *filing-compliance*
// catalogue; this is the actual money for ONE named party in one election.

type CikParty = { number: number; name: string; nickName?: string };
type FinBlock = { monetary: number; nonMonetary: number };
type FinIncome = {
  party: FinBlock;
  donors: FinBlock;
  candidates: FinBlock;
  mediaPackage: number;
};
type FinEntry = {
  party: number;
  filing: { income: FinIncome; expenses: unknown };
};

// recursive sum of every finite number under a value (expenses are deeply nested)
const sumNumbers = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (Array.isArray(v)) return v.reduce<number>((s, x) => s + sumNumbers(x), 0);
  if (v && typeof v === "object")
    return Object.values(v as Record<string, unknown>).reduce<number>(
      (s, x) => s + sumNumbers(x),
      0,
    );
  return 0;
};

const blockSum = (b: FinBlock): number => b.monetary + b.nonMonetary;

// "2024_10_27" -> "27.10.2024"
const electionDate = (name: string): string => {
  const m = name.match(/^(\d{4})_(\d{2})_(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : name;
};

export const partyFinance = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  // campaign-finance filings exist only for elections flagged hasFinancials;
  // honour a requested election if it has one, else the latest that does.
  const withFin = ALL_ELECTIONS.filter(
    (e) => (e as { hasFinancials?: boolean }).hasFinancials,
  ).map((e) => e.name);
  const reqEl = args.election ? String(args.election) : "";
  const election = withFin.includes(reqEl)
    ? reqEl
    : withFin.includes(ctx.election)
      ? ctx.election
      : withFin[0];
  const prov = [`${election ?? "—"}/parties/financing.json`];
  if (!election) {
    return {
      tool: "partyFinance",
      domain: "people",
      kind: "scalar",
      title: bg
        ? "Няма данни за партийно финансиране"
        : "No campaign-finance data",
      viz: "none",
      facts: {},
      provenance: prov,
    };
  }
  const parties = await fetchData<CikParty[]>(`/${election}/cik_parties.json`);
  const matched = matchParty(String(args.party ?? ""), parties);
  if (!matched) {
    return {
      tool: "partyFinance",
      domain: "people",
      kind: "scalar",
      title: bg
        ? `Не разпознах партия „${args.party ?? ""}“`
        : `No party matched "${args.party ?? ""}"`,
      viz: "none",
      facts: { query: String(args.party ?? "") },
      provenance: prov,
    };
  }
  const label = matched.nickName || matched.name;
  const fin = await fetchData<FinEntry[]>(
    `/${election}/parties/financing.json`,
  );
  const entry = fin.find((f) => f.party === matched.number);
  if (!entry) {
    return {
      tool: "partyFinance",
      domain: "people",
      kind: "scalar",
      title: bg
        ? `Няма финансов отчет за ${label} (${electionDate(election)})`
        : `No campaign-finance filing for ${label} (${electionDate(election)})`,
      viz: "none",
      facts: { party: label, election: electionDate(election) },
      provenance: prov,
    };
  }
  const inc = entry.filing.income;
  const fromParty = blockSum(inc.party);
  const fromDonors = blockSum(inc.donors);
  const fromCandidates = blockSum(inc.candidates);
  const media = inc.mediaPackage || 0;
  const totalIncome = fromParty + fromDonors + fromCandidates + media;
  const totalExpenses = sumNumbers(entry.filing.expenses);
  const rows: Row[] = [
    {
      item: bg ? "Собствени средства" : "Party's own funds",
      amount: fmtEurCompact(fromParty, ctx.lang),
    },
    {
      item: bg ? "Дарения" : "Donations",
      amount: fmtEurCompact(fromDonors, ctx.lang),
    },
    {
      item: bg ? "От кандидати" : "From candidates",
      amount: fmtEurCompact(fromCandidates, ctx.lang),
    },
    {
      item: bg ? "Медиен пакет" : "Media package",
      amount: fmtEurCompact(media, ctx.lang),
    },
    {
      item: bg ? "Общо приходи" : "Total income",
      amount: fmtEurCompact(totalIncome, ctx.lang),
    },
    {
      item: bg ? "Общо разходи" : "Total expenses",
      amount: fmtEurCompact(totalExpenses, ctx.lang),
    },
  ];
  return {
    tool: "partyFinance",
    domain: "people",
    kind: "table",
    title: bg
      ? `Кампанийни финанси — ${label} (${electionDate(election)})`
      : `Campaign finance — ${label} (${electionDate(election)})`,
    subtitle: bg ? "Източник: Сметна палата" : "Source: Court of Audit",
    columns: [
      { key: "item", label: bg ? "Перо" : "Item" },
      { key: "amount", label: bg ? "Сума" : "Amount", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      party: label,
      election: electionDate(election),
      total_income: fmtEurCompact(totalIncome, ctx.lang),
      from_donors: fmtEurCompact(fromDonors, ctx.lang),
      total_expenses: fmtEurCompact(totalExpenses, ctx.lang),
    },
    provenance: prov,
  };
};

// ---- company -> people-in-power connections (by EIK) ------------------------
// Reads parliament/company-connections/{eik}.json (Commerce Registry, GCS-only).
// Surfaces officers who hold public office (direct) + officers one company-hop
// from a politician (bridged). Name-match only — identity is never asserted.

const CONF_LABEL: Record<string, { bg: string; en: string }> = {
  medium: { bg: "средна", en: "medium" },
  low: { bg: "ниска", en: "low" },
};

export const companyConnections = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const raw = String(args.company ?? args.eik ?? "");
  const eik = raw.match(/\d{9,13}/)?.[0];
  if (!eik) {
    return {
      tool: "companyConnections",
      domain: "people",
      kind: "scalar",
      title: bg
        ? "Посочете ЕИК на фирмата (9 или 13 цифри)"
        : "Provide the company's EIK (9 or 13 digits)",
      viz: "none",
      facts: { query: raw },
      provenance: ["parliament/company-connections/{eik}.json"],
    };
  }
  let data: CompanyConnections | null = null;
  try {
    data = await fetchData<CompanyConnections>(
      `/parliament/company-connections/${eik}.json`,
    );
  } catch {
    data = null;
  }
  const coLabel = data?.name || eik;
  if (
    !data ||
    (data.directLinks.length === 0 && data.bridgedLinks.length === 0)
  ) {
    return {
      tool: "companyConnections",
      domain: "people",
      kind: "scalar",
      title: bg
        ? `Няма открити политически връзки за ЕИК ${eik}`
        : `No political connections on record for EIK ${eik}`,
      subtitle: bg
        ? "Никой служител не заема публична длъжност, нито е на една фирмена стъпка от такъв (по търговския регистър)."
        : "No officer holds public office, nor is one company-hop from someone who does (per the Commerce Registry).",
      viz: "none",
      facts: { eik, company: coLabel },
      provenance: [`parliament/company-connections/${eik}.json`],
    };
  }
  const roleWord = (kind: string): string =>
    kind === "mp" ? (bg ? "депутат" : "MP") : bg ? "служител" : "official";
  const conf = (c: string): string => CONF_LABEL[c]?.[ctx.lang] ?? c;
  const rows: Row[] = [];
  for (const d of data.directLinks)
    rows.push({
      person: d.power.name,
      office: d.power.roleLabel || roleWord(d.power.kind),
      link: bg ? "пряко (служител)" : "direct (officer)",
      confidence: conf(d.confidence),
    });
  for (const b of data.bridgedLinks)
    rows.push({
      person: b.power.name,
      office: b.power.roleLabel || roleWord(b.power.kind),
      link: bg
        ? `чрез ${b.bridgeName} → ${b.viaCompany ?? b.viaEik}`
        : `via ${b.bridgeName} → ${b.viaCompany ?? b.viaEik}`,
      confidence: conf(b.confidence),
    });
  const first =
    data.directLinks[0]?.power.name ?? data.bridgedLinks[0]?.power.name ?? "—";
  return {
    tool: "companyConnections",
    domain: "people",
    kind: "table",
    title: bg
      ? `Политически връзки — ${coLabel}`
      : `Political connections — ${coLabel}`,
    subtitle: bg
      ? "Съвпадение по име — самоличността не е потвърдена"
      : "Name match — identity not verified",
    columns: [
      { key: "person", label: bg ? "Лице" : "Person" },
      { key: "office", label: bg ? "Длъжност" : "Office" },
      { key: "link", label: bg ? "Връзка" : "Link" },
      { key: "confidence", label: bg ? "Сигурност" : "Confidence" },
    ],
    rows: rows.slice(0, 15),
    viz: "none",
    facts: {
      eik,
      company: coLabel,
      officers: data.officers.length,
      direct_links: data.directLinks.length,
      bridged_links: data.bridgedLinks.length,
      first_connection: first,
    },
    provenance: [`parliament/company-connections/${eik}.json`],
  };
};
