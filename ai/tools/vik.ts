// Води (water) tools. One for now, over the committed flood-maintenance artifact:
//
//   riverbedCleaning  /water/flood_maintenance.json  — public procurement for
//                     cleaning / regulating riverbeds and gullies, by awarder,
//                     year and largest contract.
//
// Amounts are in EUR. Mirrors the fiscal/judiciary tools' Envelope shape; every
// fact goes through ctx.lang, and the tool never computes prose numbers —
// narrate() reads env.facts. The КЕВР loss/tariff and reservoir tools arrive with
// their ingests (docs/plans/water-view-v1.md §6).

import { fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt } from "./format";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

type FloodFile = {
  totalEur: number;
  contractCount: number;
  awarderCount: number;
  napoitelniEur: number;
  napoitelniCount: number;
  byYear: { year: number; eur: number; count: number }[];
  topAwarders: { eik: string; name: string; eur: number; count: number }[];
  topContracts: {
    key: string;
    title: string;
    awarderName: string;
    eur: number;
    date: string;
  }[];
};

// "Кой харчи за почистване на речните корита?" — the riverbed-cleaning spend by
// awarder (municipalities, regional governors and „Напоителни системи" share the
// duty), with the Напоителни-системи share. Shows spend only; the flood-risk map
// (РЗПРН) is a later phase, so this never asserts who is at risk.
export const riverbedCleaning = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<FloodFile>("/water/flood_maintenance.json");
  if (!f || f.totalEur <= 0) {
    return {
      tool: "riverbedCleaning",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Няма данни за почистване на речни корита"
        : "No riverbed-cleaning data",
      viz: "none",
      facts: {},
      provenance: ["water/flood_maintenance.json"],
    };
  }

  const napShare =
    f.totalEur > 0 ? round2((100 * f.napoitelniEur) / f.totalEur) : 0;
  const top = f.topAwarders.slice(0, 10);

  const rows: Row[] = top.map((a) => ({
    awarder: a.name,
    amount: fmtEurCompact(a.eur, ctx.lang),
    contracts: fmtInt(a.count, ctx.lang),
  }));
  const columns: Column[] = [
    { key: "awarder", label: bg ? "Възложител" : "Awarder" },
    { key: "amount", label: bg ? "Сума" : "Amount", numeric: true },
    { key: "contracts", label: bg ? "Договори" : "Contracts", numeric: true },
  ];

  return {
    tool: "riverbedCleaning",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Почистване на речни корита — обществени поръчки"
      : "Riverbed cleaning — public procurement",
    subtitle: bg
      ? "Договори за почистване, корекция и укрепване на речни корита и дерета (АОП/ЦАИС ЕОП, всички години)"
      : "Contracts for cleaning, regulating and reinforcing riverbeds and gullies (АОП/ЦАИС ЕОП, all years)",
    columns,
    rows,
    categories: f.byYear.map((y) => String(y.year)),
    series: [
      {
        key: "eur",
        label: bg ? "Стойност (€)" : "Value (€)",
        points: f.byYear.map((y) => ({
          x: String(y.year),
          y: Math.round(y.eur),
        })),
      },
    ],
    viz: "bar",
    facts: {
      total: fmtEurCompact(f.totalEur, ctx.lang),
      contracts: fmtInt(f.contractCount, ctx.lang),
      awarders: fmtInt(f.awarderCount, ctx.lang),
      napoitelni_share: `${napShare}%`,
      top_awarder: top[0]?.name ?? "—",
      top_awarder_amount: top[0] ? fmtEurCompact(top[0].eur, ctx.lang) : "—",
    },
    provenance: ["water/flood_maintenance.json"],
  };
};
