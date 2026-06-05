// Governance — fiscal tools (budget, COFOG, procurement, EU funds). All read
// headline index/rollup files; amounts are in EUR.

import { fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt } from "./format";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

// ---- budget overview --------------------------------------------------------

type Money = { amount: number; amountEur: number; currency: string };
type FiscalYear = {
  fiscalYear: number;
  complete?: boolean;
  actual?: {
    revenue?: Money;
    expenditure?: Money;
    balance?: Money;
    euContribution?: Money;
  };
};
type BudgetIndex = { fiscalYears: FiscalYear[] };

export const budgetOverview = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const idx = await fetchData<BudgetIndex>("/budget/index.json");
  const withActual = idx.fiscalYears.filter((y) => y.actual?.balance);
  const requested =
    args.year &&
    withActual.find((y) => String(y.fiscalYear) === String(args.year));
  // default to the latest COMPLETE fiscal year (a partial in-progress year would
  // understate the full-year figures); fall back to the latest with actuals.
  const complete = withActual.filter((y) => y.complete);
  const year =
    requested ||
    (complete.length
      ? complete[complete.length - 1]
      : withActual[withActual.length - 1]);
  if (!year) {
    return {
      tool: "budgetOverview",
      domain: "fiscal",
      kind: "scalar",
      title: ctx.lang === "bg" ? "Няма бюджетни данни" : "No budget data",
      viz: "none",
      facts: {},
      provenance: ["budget/index.json"],
    };
  }
  const a = year.actual!;
  const eur = (m?: Money) => (m ? m.amountEur : 0);
  const rows: Row[] = [
    {
      metric: ctx.lang === "bg" ? "Приходи" : "Revenue",
      value: fmtEurCompact(eur(a.revenue), ctx.lang),
    },
    {
      metric: ctx.lang === "bg" ? "Разходи" : "Expenditure",
      value: fmtEurCompact(eur(a.expenditure), ctx.lang),
    },
    {
      metric: ctx.lang === "bg" ? "Салдо" : "Balance",
      value: fmtEurCompact(eur(a.balance), ctx.lang),
    },
    {
      metric: ctx.lang === "bg" ? "Принос от ЕС" : "EU contribution",
      value: fmtEurCompact(eur(a.euContribution), ctx.lang),
    },
  ];
  return {
    tool: "budgetOverview",
    domain: "fiscal",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Държавен бюджет — изпълнение ${year.fiscalYear}`
        : `State budget — ${year.fiscalYear} execution`,
    columns: [
      { key: "metric", label: ctx.lang === "bg" ? "Показател" : "Metric" },
      {
        key: "value",
        label: ctx.lang === "bg" ? "Сума" : "Amount",
        numeric: true,
      },
    ],
    rows,
    viz: "none",
    facts: {
      year: year.fiscalYear,
      revenue: fmtEurCompact(eur(a.revenue), ctx.lang),
      expenditure: fmtEurCompact(eur(a.expenditure), ctx.lang),
      balance: fmtEurCompact(eur(a.balance), ctx.lang),
    },
    provenance: ["budget/index.json"],
  };
};

// ---- budget by function (COFOG) --------------------------------------------

const COFOG: Record<string, { bg: string; en: string }> = {
  GF01: { bg: "Общи държавни служби", en: "General public services" },
  GF02: { bg: "Отбрана", en: "Defence" },
  GF03: { bg: "Обществен ред и сигурност", en: "Public order & safety" },
  GF04: { bg: "Икономически дейности", en: "Economic affairs" },
  GF05: { bg: "Опазване на околната среда", en: "Environmental protection" },
  GF06: { bg: "Жилищно строителство", en: "Housing & community" },
  GF07: { bg: "Здравеопазване", en: "Health" },
  GF08: { bg: "Култура, спорт, религия", en: "Recreation, culture, religion" },
  GF09: { bg: "Образование", en: "Education" },
  GF10: { bg: "Социална защита", en: "Social protection" },
};

type CofogPoint = { year: number; valueEur: number };
type CofogData = { latestYear: number; series: Record<string, CofogPoint[]> };

export const budgetByFunction = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const c = await fetchData<CofogData>("/cofog.json");
  const year = args.year ? Number(args.year) : c.latestYear;
  const rows = Object.entries(c.series)
    .map(([gf, pts]) => {
      const p = pts.find((x) => x.year === year) ?? pts[pts.length - 1];
      const label = (COFOG[gf] ?? { bg: gf, en: gf })[ctx.lang];
      return { gf, label, value: p ? p.valueEur : 0 };
    })
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0);

  const columns: Column[] = [
    { key: "fn", label: ctx.lang === "bg" ? "Функция" : "Function" },
    {
      key: "amount",
      label: ctx.lang === "bg" ? "Разход" : "Spend",
      numeric: true,
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
  ];
  const facts: Record<string, string | number> = {
    year,
    total: fmtEurCompact(total, ctx.lang),
    top_function: rows[0]?.label ?? "—",
  };
  rows.slice(0, 3).forEach((r) => {
    facts[r.label] = fmtEurCompact(r.value, ctx.lang);
  });

  return {
    tool: "budgetByFunction",
    domain: "fiscal",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Бюджет по функция (COFOG, ${year})`
        : `Budget by function (COFOG, ${year})`,
    columns,
    rows: rows.map((r) => ({
      fn: r.label,
      amount: fmtEurCompact(r.value, ctx.lang),
      pct: total > 0 ? round2((100 * r.value) / total) : 0,
    })),
    categories: rows.map((r) => r.label),
    series: [
      {
        key: "amount",
        label: ctx.lang === "bg" ? "Разход (€)" : "Spend (€)",
        points: rows.map((r) => ({ x: r.label, y: Math.round(r.value) })),
      },
    ],
    viz: "bar",
    facts,
    provenance: ["cofog.json"],
  } as Envelope;
};

// ---- procurement totals -----------------------------------------------------

type ProcIndex = {
  totals: {
    contracts: number;
    totalEur: number;
    contractorCount: number;
    awarderCount: number;
  };
  crossReference: { mpCount: number; totalEur: number };
};

export const procurementTotals = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const p = await fetchData<ProcIndex>("/procurement/index.json");
  return {
    tool: "procurementTotals",
    domain: "fiscal",
    kind: "scalar",
    title:
      ctx.lang === "bg"
        ? "Обществени поръчки — общо (АОП)"
        : "Public procurement — totals (AOP)",
    viz: "none",
    facts: {
      contracts: fmtInt(p.totals.contracts, ctx.lang),
      total_value: fmtEurCompact(p.totals.totalEur, ctx.lang),
      contractors: fmtInt(p.totals.contractorCount, ctx.lang),
      buyers: fmtInt(p.totals.awarderCount, ctx.lang),
      mp_connected_value: fmtEurCompact(p.crossReference.totalEur, ctx.lang),
      mp_connected_count: p.crossReference.mpCount,
    },
    provenance: ["procurement/index.json"],
  };
};

// ---- EU funds overview ------------------------------------------------------

type FundRow = { name: string; contractedEur: number; mpTied?: boolean };
type FundsIndex = {
  totals: { beneficiaries: number; contractedEur: number; paidEur: number };
  topByContracted: FundRow[];
};

export const fundsOverview = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const f = await fetchData<FundsIndex>("/funds/index.json");
  const top = f.topByContracted.slice(0, 8);
  return {
    tool: "fundsOverview",
    domain: "fiscal",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? "Европейски средства — топ бенефициенти (ИСУН)"
        : "EU funds — top beneficiaries (ISUN)",
    columns: [
      { key: "name", label: ctx.lang === "bg" ? "Бенефициент" : "Beneficiary" },
      {
        key: "amount",
        label: ctx.lang === "bg" ? "Договорено" : "Contracted",
        numeric: true,
      },
    ],
    rows: top.map((r) => ({
      name: r.name,
      amount: fmtEurCompact(r.contractedEur, ctx.lang),
    })),
    viz: "none",
    facts: {
      beneficiaries: fmtInt(f.totals.beneficiaries, ctx.lang),
      contracted: fmtEurCompact(f.totals.contractedEur, ctx.lang),
      paid: fmtEurCompact(f.totals.paidEur, ctx.lang),
      top: top[0]?.name ?? "—",
    },
    provenance: ["funds/index.json"],
  };
};
