// Отбрана (defense) tools. Five of them, over the committed data/defense/ files:
//
//   defenseSpending   /defense/gdp_share.json + category_split.json — %GDP path
//                     to the NATO targets + the equipment/personnel split
//   armsExports       /defense/exports.json    — the post-2022 arms-export boom
//   defenseProgram    /defense/programs.json    — the flagship FMS programs
//   defensePeerCompare /defense/peers.json      — %GDP vs neighbours + NATO Europe
//   defenseReadiness  /defense/readiness.json   — personnel vacancy + budget split
//
// Amounts are in EUR (programs carry their own currency). Mirrors the judiciary/
// НЗОК tools' Envelope shape; every fact goes through ctx.lang and the tool never
// computes prose numbers — narrate() reads env.facts. See docs/plans/
// defense-pack-v1.md §Part-7.

import { fetchData } from "./dataClient";
import { fmtEurCompact } from "./format";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";
// Canonical file shapes from the dependency-free data/defense types module —
// imported by relative path (the ai/ ↔ @/data alias boundary is lint-enforced;
// this module has no React deps, so it's safe to share) instead of re-declaring
// trimmed copies that drift.
import type {
  GdpShareFile,
  CategorySplitFile,
  ExportsFile,
  ProgramsFile,
  ReadinessFile,
  PeersFile,
} from "../../src/data/defense/types";

// "Колко харчи България за отбрана?" — the %GDP path to the 5% target, plus the
// equipment share, as a line the reader is arguing about right now.
export const defenseSpending = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const [gdp, split] = await Promise.all([
    fetchData<GdpShareFile>("/defense/gdp_share.json"),
    fetchData<CategorySplitFile>("/defense/category_split.json"),
  ]);
  const latest = gdp.series[gdp.series.length - 1];
  const eqLatest = split.series[split.series.length - 1];

  return {
    tool: "defenseSpending",
    domain: "fiscal",
    kind: "series",
    title: bg
      ? "Разходи за отбрана като дял от БВП"
      : "Defence spending as a share of GDP",
    subtitle: bg
      ? `Цели на НАТО: ${gdp.targets.wales2}% (Уелс) → ${gdp.targets.hagueTotal}% до ${gdp.targets.hagueYear} (Хага)`
      : `NATO targets: ${gdp.targets.wales2}% (Wales) → ${gdp.targets.hagueTotal}% by ${gdp.targets.hagueYear} (Hague)`,
    categories: gdp.series.map((p) => p.year),
    series: [
      {
        key: "pct",
        label: bg ? "Дял от БВП (%)" : "Share of GDP (%)",
        points: gdp.series.map((p) => ({ x: p.year, y: p.pct })),
      },
    ],
    viz: "line",
    markers: [{ x: 2019, label: bg ? "F-16 (еднократно)" : "F-16 (one-off)" }],
    facts: {
      latest_year: latest.year,
      latest_pct: `${latest.pct}%`,
      above_2pct:
        latest.pct >= gdp.targets.wales2
          ? bg
            ? "да"
            : "yes"
          : bg
            ? "не"
            : "no",
      target_5pct_year: gdp.targets.hagueYear,
      equipment_share: `${Math.round(eqLatest.equipment)}%`,
      equipment_year: eqLatest.year,
    },
    provenance: ["defense/gdp_share.json", "defense/category_split.json"],
  };
};

// "Колко оръжие изнася България?" — the export boom, total by year, with the
// direct-to-Ukraine sliver and the SIPRI-undercount caveat surfaced in facts.
export const armsExports = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<ExportsFile>("/defense/exports.json");
  const latest = f.series[f.series.length - 1];
  const first = f.series[0];

  return {
    tool: "armsExports",
    domain: "fiscal",
    kind: "series",
    title: bg
      ? "Износ на отбранителна продукция от България"
      : "Bulgaria's defence-product exports",
    subtitle: bg
      ? "По данни на Министерството на икономиката (в евро)"
      : "Ministry of Economy figures (EUR)",
    categories: f.series.map((p) => p.year),
    series: [
      {
        key: "total",
        label: bg ? "Общ износ" : "Total exports",
        points: f.series.map((p) => ({ x: p.year, y: p.totalEur })),
      },
    ],
    viz: "bar",
    facts: {
      latest_year: latest.year,
      latest_total: fmtEurCompact(latest.totalEur, ctx.lang),
      first_year: first.year,
      first_total: fmtEurCompact(first.totalEur, ctx.lang),
      cumulative_since_2022: fmtEurCompact(
        f.cumulativeSinceInvasionEur,
        ctx.lang,
      ),
      to_ukraine_latest: fmtEurCompact(latest.toUkraineEur, ctx.lang),
      caveat: bg
        ? "SIPRI подценява (не отчита боеприпаси)"
        : "SIPRI undercounts (excludes ammunition)",
    },
    provenance: ["defense/exports.json"],
  };
};

// "Кои са големите оръжейни програми?" — the flagship FMS/inter-governmental
// acquisitions (F-16, Stryker, patrol ships, ammo JV) that never enter the
// procurement register.
export const defenseProgram = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<ProgramsFile>("/defense/programs.json");
  const fmtVal = (v: number, cur: string) =>
    cur === "USD"
      ? `≈${(v / 1e9).toLocaleString(ctx.lang, { maximumFractionDigits: 1 })} млрд $`
      : `≈${fmtEurCompact(v, ctx.lang)}`;
  const rows: Row[] = f.programs.map((p) => ({
    program: p.name,
    value: fmtVal(p.value, p.currency),
    units: p.units,
  }));
  const columns: Column[] = [
    { key: "program", label: bg ? "Програма" : "Program" },
    { key: "value", label: bg ? "Стойност" : "Value", numeric: true },
    { key: "units", label: bg ? "Обем" : "Scope" },
  ];
  const biggest = [...f.programs].sort((a, b) => b.value - a.value)[0];

  return {
    tool: "defenseProgram",
    domain: "fiscal",
    kind: "table",
    title: bg ? "Големите оръжейни програми" : "The flagship defence programs",
    subtitle: bg
      ? "По US FMS / междуправителствено — извън регистъра на поръчките"
      : "Via US FMS / inter-governmental — outside the procurement register",
    columns,
    rows,
    viz: "none",
    facts: {
      count: f.programs.length,
      biggest: biggest?.name ?? "—",
      biggest_value: biggest ? fmtVal(biggest.value, biggest.currency) : "—",
    },
    provenance: ["defense/programs.json"],
  };
};

// "Как се сравнява България със съседите?" — defence spending as a share of GDP,
// Bulgaria against its neighbours + the NATO Europe average. Answers "is 2% a lot"
// with a comparator instead of an absolute number.
export const defensePeerCompare = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<PeersFile>("/defense/peers.json");
  const li = f.years.length - 1;
  const latestYear = f.years[li];
  const name = (c: { bg: string; en: string }) => (bg ? c.bg : c.en);
  const at = (key: string) =>
    f.countries.find((c) => c.key === key)?.series[li] ?? null;
  const bgVal = at("BG");
  // Rank Bulgaria among the actual countries (exclude the NATO aggregate).
  const nations = f.countries.filter((c) => c.key !== "NATO_EU");
  const sorted = [...nations].sort(
    (a, b) => (b.series[li] ?? 0) - (a.series[li] ?? 0),
  );
  const rank = sorted.findIndex((c) => c.key === "BG") + 1;

  return {
    tool: "defensePeerCompare",
    domain: "indicators",
    kind: "series",
    title: bg
      ? "Разходи за отбрана (% от БВП) — България и съседите"
      : "Defence spending (% of GDP) — Bulgaria and peers",
    subtitle: bg
      ? `${latestYear} г. · праг на НАТО ${f.target}%`
      : `${latestYear} · NATO floor ${f.target}%`,
    categories: f.years,
    series: f.countries.map((c) => ({
      key: c.key,
      label: name(c),
      points: f.years.map((y, i) => ({ x: y, y: c.series[i] })),
    })),
    viz: "line",
    facts: {
      latest_year: latestYear,
      bulgaria: bgVal != null ? `${bgVal}%` : "—",
      rank_of: `${rank}/${nations.length}`,
      romania: at("RO") != null ? `${at("RO")}%` : "—",
      greece: at("GR") != null ? `${at("GR")}%` : "—",
      nato_europe: at("NATO_EU") != null ? `${at("NATO_EU")}%` : "—",
    },
    provenance: ["defense/peers.json"],
  };
};

// "Пълна ли е армията?" — personnel vacancy, reserve fill and the personnel-vs-
// capital budget split.
export const defenseReadiness = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<ReadinessFile>("/defense/readiness.json");

  return {
    tool: "defenseReadiness",
    domain: "indicators",
    kind: "scalar",
    title: bg ? "Личен състав и готовност" : "Personnel & readiness",
    viz: "none",
    value: f.personnelVacancyPct,
    valueFormat: "pct",
    facts: {
      vacancy: `${f.personnelVacancyPct}%`,
      reserve_fill: `${f.reserveFillPct}%`,
      budget_year: f.budgetYear,
      personnel_budget: fmtEurCompact(f.personnelEur, ctx.lang),
      capital_budget: fmtEurCompact(f.capitalEur, ctx.lang),
    },
    provenance: ["defense/readiness.json"],
  };
};
