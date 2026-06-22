// Indicators — БНБ monthly foreign-direct-investment tool.
//
// Reads /macro_fdi.json (the БНБ balance-of-payments monthly FDI export). This
// is richer than the annual `fdiInward` series in macro.json: monthly net flow
// split into equity / reinvested earnings / debt instruments, plus the
// year-to-date cumulative vs. the same period a year earlier — the figures the
// euro-adoption FDI coverage cites ("7× more investment", "+50% reinvested").

import { fetchData } from "./dataClient";
import type { Envelope, ToolArgs, ToolContext } from "./types";

type ComponentKey = "total" | "equity" | "reinvested" | "debt";
type FdiPoint = { period: string; value: number };
type FdiSide = {
  year: number;
  total: number;
  equity: number;
  reinvested: number;
  debt: number;
};
type FdiData = {
  source: string;
  sourceUrl: string;
  unit: string;
  latestPeriod: string;
  labels: Record<ComponentKey, { bg: string; en: string }>;
  series: Record<ComponentKey, FdiPoint[]>;
  latest: {
    period: string;
    total: number;
    equity: number;
    reinvested: number;
    debt: number;
    priorYearTotal: number | null;
  };
  ytd: {
    month: number;
    rangeBg: string;
    rangeEn: string;
    current: FdiSide;
    prior: FdiSide;
    totalRatio: number | null;
    reinvestedGrowthPct: number | null;
  };
};

// EUR-million → friendly billions/millions string (sign before the € symbol).
const eur = (vM: number): string => {
  const sign = vM < 0 ? "-" : "";
  const abs = Math.abs(vM);
  if (abs >= 1000) return `${sign}€${(abs / 1000).toFixed(2)}B`;
  return `${sign}€${abs.toFixed(1)}M`;
};

const signedPct = (n: number): string => `${n > 0 ? "+" : ""}${n}%`;

export const fdiFlows = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const d = await fetchData<FdiData>("/macro_fdi.json");
  const { ytd, latest } = d;
  const range = bg ? ytd.rangeBg : ytd.rangeEn;
  const ratio = ytd.totalRatio;
  const growth = ytd.reinvestedGrowthPct;
  const lbl = (k: ComponentKey) => (bg ? d.labels[k].bg : d.labels[k].en);

  // Monthly net total for the viz (last 36 points).
  const pts = d.series.total.slice(-36);

  const title = bg
    ? `Преки чуждестранни инвестиции в България: ${eur(ytd.current.total)} за ${range} ${ytd.current.year}`
    : `Foreign direct investment in Bulgaria: ${eur(ytd.current.total)} in ${range} ${ytd.current.year}`;

  const subtitle = bg
    ? `спрямо ${eur(ytd.prior.total)} за ${range} ${ytd.prior.year}${
        ratio != null ? ` (${ratio}×)` : ""
      }; реинвестирана печалба ${eur(ytd.current.reinvested)}${
        growth != null ? ` (${signedPct(growth)})` : ""
      }`
    : `vs ${eur(ytd.prior.total)} in ${range} ${ytd.prior.year}${
        ratio != null ? ` (${ratio}×)` : ""
      }; reinvested earnings ${eur(ytd.current.reinvested)}${
        growth != null ? ` (${signedPct(growth)})` : ""
      }`;

  // Surface every number: the four components' YTD this year vs last + the
  // change, the YoY ratio, and the latest reported month.
  const facts: Record<string, string | number> = {};
  for (const k of ["total", "equity", "reinvested", "debt"] as ComponentKey[]) {
    const cur = ytd.current[k];
    const prev = ytd.prior[k];
    const delta = Math.round((cur - prev) * 10) / 10;
    facts[`${lbl(k)} · ${range} ${ytd.current.year}`] = eur(cur);
    facts[`${lbl(k)} · ${range} ${ytd.prior.year}`] = eur(prev);
    facts[`${lbl(k)} · ${bg ? "промяна" : "change"}`] =
      `${delta > 0 ? "+" : ""}${eur(delta)}`;
  }
  if (ratio != null) facts[bg ? "съотношение г/г" : "ratio YoY"] = `${ratio}×`;
  if (growth != null)
    facts[bg ? "ръст реинв. печалба" : "reinvested growth"] = signedPct(growth);
  facts[bg ? "последен месец" : "latest month"] =
    `${latest.period}: ${eur(latest.total)}`;
  if (latest.priorYearTotal != null)
    facts[bg ? "същия месец, г-1" : "same month, prior year"] = eur(
      latest.priorYearTotal,
    );

  return {
    tool: "fdiFlows",
    domain: "indicators",
    kind: "series",
    title,
    subtitle,
    categories: pts.map((p) => p.period),
    series: [
      {
        key: "total",
        label: lbl("total"),
        points: pts.map((p) => ({ x: p.period, y: p.value })),
      },
    ],
    viz: "line",
    facts,
    provenance: ["macro_fdi.json"],
  };
};
