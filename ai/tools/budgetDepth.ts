// D2 — budget execution depth: KFP monthly execution series, per-ministry
// budget, Приложение III investment projects.

import { fetchData } from "./dataClient";
import { fmtEurCompact } from "./format";
import { resolveOblast } from "./place";
import { fuzzyBestMatch } from "./resolve";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

// ---- KFP monthly execution series -------------------------------------------

const SERIES_LABELS: Record<string, { bg: string; en: string }> = {
  revenue: { bg: "Приходи", en: "Revenue" },
  expenditure: { bg: "Разходи", en: "Expenditure" },
  balance: { bg: "Салдо", en: "Balance" },
  euContribution: { bg: "Принос от ЕС", en: "EU contribution" },
  financing: { bg: "Финансиране", en: "Financing" },
};

export const resolveBudgetSeries = (raw: string): string => {
  const q = raw.toLowerCase();
  if (q.includes("разход") || q.includes("expenditure") || q.includes("spend"))
    return "expenditure";
  if (
    q.includes("салдо") ||
    q.includes("баланс") ||
    q.includes("balance") ||
    q.includes("дефицит") ||
    q.includes("deficit")
  )
    return "balance";
  if (q.includes("ес ") || q.includes("европейск") || q.includes("eu contrib"))
    return "euContribution";
  return "revenue";
};

type Money = { amountEur: number };
type Obs = {
  period: string;
  series: string;
  executed?: Money;
  planned?: Money;
};

export const budgetExecution = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const key = resolveBudgetSeries(
    String(args.series ?? args.indicator ?? "revenue"),
  );
  const d = await fetchData<{ observations: Obs[] }>("/budget/kfp.json");
  const pts = d.observations
    .filter((o) => o.series === key && o.executed)
    .sort((a, b) => a.period.localeCompare(b.period));
  const recent = pts.slice(Math.max(0, pts.length - 24));
  const label = SERIES_LABELS[key]?.[ctx.lang] ?? key;
  const last = recent[recent.length - 1];
  return {
    tool: "budgetExecution",
    domain: "fiscal",
    kind: "series",
    title:
      ctx.lang === "bg"
        ? `Изпълнение на бюджета — ${label} (месечно)`
        : `Budget execution — ${label} (monthly)`,
    categories: recent.map((o) => o.period),
    series: [
      {
        key: "executed",
        label,
        points: recent.map((o) => ({
          x: o.period,
          y: Math.round((o.executed?.amountEur ?? 0) / 1e6),
        })),
      },
    ],
    viz: "line",
    facts: {
      series: label,
      latest_period: last?.period ?? "—",
      latest: last
        ? fmtEurCompact(last.executed?.amountEur ?? 0, ctx.lang)
        : "—",
      unit: ctx.lang === "bg" ? "млн €" : "€m",
    },
    provenance: ["budget/kfp.json"],
  };
};

// ---- per-ministry budget ----------------------------------------------------

type AdminMin = { nameBg: string; nameEn?: string; nodeId: string };
type AdminFlow = { fiscalYears: Record<string, { ministries: AdminMin[] }> };
type Program = { nameBg: string; planned?: Money };
type MinistryYear = {
  fiscalYear: number;
  expenditure?: Money;
  programs?: Program[];
};
type MinistryFile = { nameBg: string; nameEn?: string; years: MinistryYear[] };

const norm = (s: string): string =>
  s.toLowerCase().replace(/[\s.,„“”"'`-]+/g, "");

// НАП and Агенция „Митници“ are second-level разпоредители under МФ — not in the
// ministries tree (admin_flow), so they carry their own budget in
// data/budget/agencies/. Resolve them here so "бюджетът на НАП / Митници?"
// answers off that file (same years[].expenditure shape, no programs).
const AGENCY_BUDGETS: { slug: string; match: (q: string) => boolean }[] = [
  {
    slug: "nap",
    match: (q) =>
      /(^|[^а-я])нап([^а-я]|$)/.test(q) ||
      q.includes("национална агенция за приход") ||
      q.includes("revenue agency") ||
      /(^|[^a-z])n[ar]a([^a-z]|$)/.test(q),
  },
  {
    slug: "customs",
    match: (q) => q.includes("митниц") || q.includes("customs"),
  },
];

const agencyBudget = async (
  slug: string,
  ctx: ToolContext,
): Promise<Envelope> => {
  const file = await fetchData<MinistryFile>(`/budget/agencies/${slug}.json`);
  const years = [...file.years]
    .filter((y) => y.expenditure)
    .sort((a, b) => b.fiscalYear - a.fiscalYear);
  const latest = years[0];
  const columns: Column[] = [
    { key: "year", label: ctx.lang === "bg" ? "Година" : "Year" },
    {
      key: "budget",
      label: ctx.lang === "bg" ? "Бюджет (разходи)" : "Budget (expenditure)",
      numeric: true,
    },
  ];
  const rows: Row[] = years.map((y) => ({
    year: y.fiscalYear,
    budget: fmtEurCompact(y.expenditure?.amountEur ?? 0, ctx.lang),
  }));
  return {
    tool: "ministryBudget",
    domain: "fiscal",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Бюджет — ${file.nameBg} (${latest?.fiscalYear ?? "—"})`
        : `Budget — ${file.nameEn || file.nameBg} (${latest?.fiscalYear ?? "—"})`,
    columns,
    rows,
    viz: "none",
    facts: {
      agency: file.nameBg,
      year: latest?.fiscalYear ?? "—",
      expenditure: latest?.expenditure
        ? fmtEurCompact(latest.expenditure.amountEur, ctx.lang)
        : "—",
      note:
        ctx.lang === "bg"
          ? "Собствен ведомствен бюджет (годишен уточнен план) — второстепенен разпоредител по бюджета на МФ."
          : "The agency's own budget (adjusted annual plan) — a second-level spending unit under the Ministry of Finance.",
    },
    provenance: [`budget/agencies/${slug}.json`],
  };
};

export const ministryBudget = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const query = String(args.ministry ?? args.place ?? "");
  const agency = AGENCY_BUDGETS.find((a) => a.match(query.toLowerCase()));
  if (agency) return agencyBudget(agency.slug, ctx);
  const flow = await fetchData<AdminFlow>("/budget/derived/admin_flow.json");
  // de-dupe ministries across years into name -> nodeId
  const byNode = new Map<string, AdminMin>();
  for (const fy of Object.values(flow.fiscalYears))
    for (const m of fy.ministries) byNode.set(m.nodeId, m);
  const all = [...byNode.values()];
  const q = norm(query);
  // exact / containment first (when args.ministry is a clean name)
  let match =
    all.find((m) => norm(m.nameBg) === q) ||
    (q.length > 5
      ? all.find(
          (m) => norm(m.nameBg).includes(q) || q.includes(norm(m.nameBg)),
        )
      : undefined);
  // otherwise score by distinctive-word overlap, so a whole-question input
  // ("какъв е бюджетът на министерството на транспорта?") still resolves
  if (!match) {
    const STOP = new Set([
      "министерство",
      "министерството",
      "министерски",
      "министерския",
      "министър",
      "министри",
      "на",
      "за",
      "и",
      "по",
      "агенция",
      "държавна",
      "държавната",
      "комисия",
      "национален",
      "национална",
      "дирекция",
      "съвет",
      "съвета",
      "администрация",
    ]);
    const qn = query.toLowerCase();
    let best = 0;
    for (const m of all) {
      const words = m.nameBg
        .toLowerCase()
        .split(/[\s.,„“”"'`-]+/)
        .filter((w) => w.length >= 5 && !STOP.has(w));
      let score = 0;
      for (const w of words) if (qn.includes(w.slice(0, 6))) score += w.length;
      if (score > best) {
        best = score;
        match = m;
      }
    }
  }
  if (!match) {
    // typo fallback on the ministry name ("транспрт", "правосъдито"). minLen 6 so
    // a stray short word can't snap to a ministry; the word-overlap scorer above
    // already handles whole-question phrasing, so this only rescues misspellings.
    match = fuzzyBestMatch(
      query,
      all.map((m) => ({
        item: m,
        keys: [m.nameBg, m.nameEn].filter(Boolean) as string[],
      })),
      { threshold: 0.3, minLen: 6 },
    )?.item;
  }
  if (!match) {
    return {
      tool: "ministryBudget",
      domain: "fiscal",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Не намерих ведомство „${query}“`
          : `No ministry matched "${query}"`,
      viz: "none",
      facts: { query },
      provenance: ["budget/derived/admin_flow.json"],
    };
  }
  const file = await fetchData<MinistryFile>(
    `/budget/ministries/${match.nodeId}.json`,
  );
  const withData = file.years.filter(
    (y) => y.programs?.length || y.expenditure,
  );
  const year = withData.sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
  const programs = [...(year?.programs ?? [])]
    .filter((p) => p.planned?.amountEur)
    .sort((a, b) => (b.planned?.amountEur ?? 0) - (a.planned?.amountEur ?? 0))
    .slice(0, 10);
  const columns: Column[] = [
    { key: "program", label: ctx.lang === "bg" ? "Програма" : "Programme" },
    {
      key: "planned",
      label: ctx.lang === "bg" ? "Планирано" : "Planned",
      numeric: true,
    },
  ];
  const rows: Row[] = programs.map((p) => ({
    program: p.nameBg,
    planned: fmtEurCompact(p.planned?.amountEur ?? 0, ctx.lang),
  }));
  return {
    tool: "ministryBudget",
    domain: "fiscal",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Бюджет — ${match.nameBg} (${year?.fiscalYear ?? "—"})`
        : `Budget — ${match.nameBg} (${year?.fiscalYear ?? "—"})`,
    columns,
    rows,
    viz: "none",
    facts: {
      ministry: match.nameBg,
      year: year?.fiscalYear ?? "—",
      expenditure: year?.expenditure
        ? fmtEurCompact(year.expenditure.amountEur, ctx.lang)
        : "—",
      programs: programs.length,
    },
    provenance: [
      "budget/derived/admin_flow.json",
      `budget/ministries/${match.nodeId}.json`,
    ],
  };
};

// ---- investment program (Приложение III) ------------------------------------

type InvProject = {
  name: string;
  category?: string;
  municipalityNameBg?: string;
  oblastCode?: string;
  cost?: Money;
};
type InvData = {
  fiscalYear: number;
  grandTotal?: Money;
  projectCount: number;
  topProjects: InvProject[];
};

export const investmentProjects = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const idx = await fetchData<{ years: { fiscalYear: number }[] }>(
    "/budget/investment_program/index.json",
  );
  const year = idx.years.map((y) => y.fiscalYear).sort((a, b) => b - a)[0];
  const d = await fetchData<InvData>(`/budget/investment_program/${year}.json`);
  const obl = args.oblast ? resolveOblast(String(args.oblast)) : undefined;
  let projects = d.topProjects;
  if (obl) projects = projects.filter((p) => p.oblastCode === obl.code);
  const top = [...projects]
    .sort((a, b) => (b.cost?.amountEur ?? 0) - (a.cost?.amountEur ?? 0))
    .slice(0, 10);
  const columns: Column[] = [
    { key: "project", label: ctx.lang === "bg" ? "Проект" : "Project" },
    { key: "place", label: ctx.lang === "bg" ? "Място" : "Place" },
    {
      key: "cost",
      label: ctx.lang === "bg" ? "Стойност" : "Cost",
      numeric: true,
    },
  ];
  const rows: Row[] = top.map((p) => ({
    project: p.name.length > 64 ? `${p.name.slice(0, 64)}…` : p.name,
    place: p.municipalityNameBg ?? "—",
    cost: fmtEurCompact(p.cost?.amountEur ?? 0, ctx.lang),
  }));
  return {
    tool: "investmentProjects",
    domain: "fiscal",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Инвестиционна програма ${year}${obl ? ` — ${obl.name.bg}` : ""}`
        : `Investment programme ${year}${obl ? ` — ${obl.name.en}` : ""}`,
    columns,
    rows,
    viz: "none",
    facts: {
      year,
      project_count: d.projectCount,
      grand_total: d.grandTotal
        ? fmtEurCompact(d.grandTotal.amountEur, ctx.lang)
        : "—",
      top_project: top[0]?.name?.slice(0, 60) ?? "—",
    },
    provenance: [`budget/investment_program/${year}.json`],
  };
};
