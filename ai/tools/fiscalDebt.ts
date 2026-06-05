// D1 — government debt emissions + NOI social-security fund execution.

import { fetchData } from "./dataClient";
import { fmtEurCompact } from "./format";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

// ---- government debt emissions -----------------------------------------------

type Emission = {
  id: string;
  market: string;
  type: string;
  issueDate: string;
  maturityDate?: string;
  termYears?: number;
  currency: string;
  principalMillion: number;
  couponPct?: number;
};

export const govDebt = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const d = await fetchData<{ emissions: Emission[] }>("/debt-emissions.json");
  const recent = [...d.emissions]
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
    .slice(0, 10);
  const columns: Column[] = [
    { key: "date", label: ctx.lang === "bg" ? "Дата" : "Date" },
    { key: "type", label: ctx.lang === "bg" ? "Вид" : "Type" },
    {
      key: "principal",
      label: ctx.lang === "bg" ? "Размер" : "Principal",
      numeric: true,
    },
    {
      key: "coupon",
      label: ctx.lang === "bg" ? "Купон" : "Coupon",
      numeric: true,
    },
    { key: "maturity", label: ctx.lang === "bg" ? "Падеж" : "Maturity" },
  ];
  const rows: Row[] = recent.map((e) => ({
    date: e.issueDate,
    type: e.type,
    principal: fmtEurCompact(e.principalMillion * 1e6, ctx.lang),
    coupon: e.couponPct != null ? `${e.couponPct}%` : "—",
    maturity: e.maturityDate ?? (e.termYears ? `${e.termYears}y` : "—"),
  }));
  const totalRecentEur = recent.reduce(
    (s, e) => s + e.principalMillion * 1e6,
    0,
  );
  return {
    tool: "govDebt",
    domain: "fiscal",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? "Държавен дълг — последни емисии"
        : "Government debt — recent issuances",
    columns,
    rows,
    viz: "none",
    facts: {
      shown: recent.length,
      total_recent: fmtEurCompact(totalRecentEur, ctx.lang),
      latest: recent[0]?.issueDate ?? "—",
    },
    provenance: ["debt-emissions.json"],
  };
};

// ---- NOI social-security fund execution -------------------------------------

type Money = { amountEur: number };
type NoiYear = {
  fiscalYear: number;
  totals: { revenue?: Money; expenditure?: Money; balance?: Money };
};

export const noiFunds = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const d = await fetchData<{ years: NoiYear[] }>("/budget/noi/funds.json");
  const latest = [...d.years].sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
  if (!latest) {
    return {
      tool: "noiFunds",
      domain: "fiscal",
      kind: "scalar",
      title: ctx.lang === "bg" ? "Няма данни за НОИ" : "No NSSI data",
      viz: "none",
      facts: {},
      provenance: ["budget/noi/funds.json"],
    };
  }
  const t = latest.totals;
  const eur = (m?: Money) => (m ? m.amountEur : 0);
  const rows: Row[] = [
    {
      metric: ctx.lang === "bg" ? "Приходи" : "Revenue",
      value: fmtEurCompact(eur(t.revenue), ctx.lang),
    },
    {
      metric: ctx.lang === "bg" ? "Разходи" : "Expenditure",
      value: fmtEurCompact(eur(t.expenditure), ctx.lang),
    },
    {
      metric: ctx.lang === "bg" ? "Салдо" : "Balance",
      value: fmtEurCompact(eur(t.balance), ctx.lang),
    },
  ];
  return {
    tool: "noiFunds",
    domain: "fiscal",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Социалноосигурителни фондове (НОИ) — ${latest.fiscalYear}`
        : `Social-security funds (NSSI) — ${latest.fiscalYear}`,
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
      year: latest.fiscalYear,
      expenditure: fmtEurCompact(eur(t.expenditure), ctx.lang),
    },
    provenance: ["budget/noi/funds.json"],
  };
};
