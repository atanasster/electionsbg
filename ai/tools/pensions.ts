// НОИ pension statistics + КФН private-pension-funds tools (the /pensions view).
// Read the committed static JSON under /budget/noi/pensions.json and
// /budget/kfn/funds.json — the same figures the pensions view serves. Mirrors
// the fiscal tools' Envelope shape; every fact goes through ctx.lang.

import { fetchData } from "./dataClient";
import { fmtEur, fmtEurCompact, fmtInt } from "./format";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

// ---- shared shapes -----------------------------------------------------------
// CANONICAL definitions live in src/data/budget/types.ts (NoiPensionsFile /
// KfnFundsFile). `ai/` cannot import from `src/`, so these are hand-mirrored —
// keep them in sync on any field change. The `oblasts` index is typed
// `Record<string, …>` here (JSON object keys are strings; read with
// String(latestYear)); types.ts uses a numeric key that coerces to the same
// runtime access.

type NoiNationalYear = {
  year: number;
  avgWageBgn: number | null;
  avgWageEur: number | null;
  avgInsurableIncomeBgn: number | null;
  avgInsurableIncomeEur: number | null;
  avgPensionBgn: number | null;
  avgPensionEur: number | null;
  pensionerCount: number | null;
};
type NoiPensionBracket = {
  index: number;
  lo: number | null;
  hi: number | null;
  labelBg: string;
  count: number;
  share: number;
};
type NoiPensionDistributionYear = {
  year: number;
  total: number;
  minPensionBgn: number | null;
  atCapCount: number | null;
  capBgn: number | null;
  aboveCapCount: number | null;
  povertyLineBgn: number | null;
  brackets: NoiPensionBracket[];
};
type NoiPensionOblastRow = {
  code: string;
  nameBg: string;
  avgPensionBgn: number;
  avgPensionEur: number;
  yoyPct: number | null;
  pensions: number | null;
  bankPaid: number | null;
  cashPaid: number | null;
  cashShare: number | null;
};
type NoiPensionsFile = {
  latestYear: number;
  years: number[];
  national: NoiNationalYear[];
  distribution: NoiPensionDistributionYear[];
  oblasts: Record<string, NoiPensionOblastRow[]>;
};

// A лев-denominated statutory value ("580.57 лв."). The pension distribution's
// minimum / cap / poverty thresholds are set in лева by law, so they stay лв even
// after euro adoption (the euro averages ride the €-formatted helpers instead).
const lev = (n: number): string =>
  `${n.toLocaleString("bg-BG", { maximumFractionDigits: 2 })} лв.`;

// ---- 1. pension-size distribution -------------------------------------------

// How the ~2M pensions actually spread out: the share at or below the statutory
// minimum, the handful pinned at the ceiling, and where the poverty line falls —
// the "the average describes almost no one" story. Cues: минимална пенсия /
// разпределение / размер / таван / бедност / колко пенсионери.
export const noiPensionDistribution = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<NoiPensionsFile>("/budget/noi/pensions.json");
  const dist =
    f.distribution.find((d) => d.year === f.latestYear) ?? f.distribution[0];
  if (!dist || !dist.brackets.length) {
    return {
      tool: "noiPensionDistribution",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Няма данни за размера на пенсиите" : "No pension-size data",
      viz: "none",
      facts: {},
      provenance: ["budget/noi/pensions.json"],
    };
  }
  const min = dist.minPensionBgn;
  // Share at or below the statutory minimum = brackets whose upper bound is ≤ min.
  // This counts only whole brackets; a bracket that STRADDLED the minimum
  // (lo < min < hi) would be dropped entirely. That is exact for the current
  // data because НОИ's size-bracket boundaries are pinned to the statutory
  // minimum, so no bracket straddles it — revisit if that alignment ever breaks.
  const atOrBelow =
    min != null
      ? dist.brackets
          .filter((b) => b.hi != null && b.hi <= min)
          .reduce((s, b) => s + b.count, 0)
      : 0;
  const atOrBelowShare =
    min != null && dist.total > 0
      ? round2((100 * atOrBelow) / dist.total)
      : null;
  const nat = f.national.find((n) => n.year === f.latestYear);

  const rows: Row[] = dist.brackets.map((b) => ({
    band: b.labelBg,
    count: fmtInt(b.count, ctx.lang),
    share: round2(b.share * 100),
  }));
  const columns: Column[] = [
    { key: "band", label: bg ? "Размер (лв.)" : "Band (BGN)" },
    { key: "count", label: bg ? "Пенсионери" : "Pensioners", numeric: true },
    { key: "share", label: "%", numeric: true, format: "pct" },
  ];

  const facts: Record<string, string | number> = {
    year: dist.year,
    total_pensioners: fmtInt(dist.total, ctx.lang),
    min_pension: min != null ? lev(min) : "—",
    at_or_below_min:
      atOrBelowShare != null
        ? `${atOrBelowShare}% (${fmtInt(atOrBelow, ctx.lang)})`
        : "—",
    cap: dist.capBgn != null ? lev(dist.capBgn) : "—",
    at_cap_count:
      dist.atCapCount != null ? fmtInt(dist.atCapCount, ctx.lang) : "—",
    above_cap_count:
      dist.aboveCapCount != null ? fmtInt(dist.aboveCapCount, ctx.lang) : "—",
    poverty_line: dist.povertyLineBgn != null ? lev(dist.povertyLineBgn) : "—",
    ...(nat?.avgPensionEur != null
      ? { avg_pension: fmtEur(nat.avgPensionEur, ctx.lang) }
      : {}),
  };

  return {
    tool: "noiPensionDistribution",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Как се разпределят пенсиите по размер (${dist.year})`
      : `How pensions spread out by size (${dist.year})`,
    subtitle: bg
      ? `${atOrBelowShare ?? "—"}% от пенсионерите взимат минималната пенсия или по-малко — средната пенсия описва почти никого`
      : `${atOrBelowShare ?? "—"}% of pensioners get the minimum pension or less — the average describes almost no one`,
    columns,
    rows,
    categories: dist.brackets.map((b) => b.labelBg),
    series: [
      {
        key: "count",
        label: bg ? "Пенсионери" : "Pensioners",
        points: dist.brackets.map((b) => ({ x: b.labelBg, y: b.count })),
      },
    ],
    viz: "bar",
    facts,
    provenance: ["budget/noi/pensions.json"],
  };
};

// ---- 2. average pension by oblast -------------------------------------------

// The regional spread of the average pension, plus the cash-collection share
// (pensions still drawn in cash at the post office rather than paid to a bank) —
// a rough proxy for financial inclusion of the elderly. Cues: пенсия по област /
// региони / средна пенсия по региони.
export const noiPensionByOblast = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<NoiPensionsFile>("/budget/noi/pensions.json");
  const list = f.oblasts[String(f.latestYear)] ?? [];
  if (!list.length) {
    return {
      tool: "noiPensionByOblast",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Няма данни за пенсии по област"
        : "No pension-by-oblast data",
      viz: "none",
      facts: {},
      provenance: ["budget/noi/pensions.json"],
    };
  }
  const sorted = [...list].sort((a, b) => b.avgPensionBgn - a.avgPensionBgn);
  const top = sorted.slice(0, 5);
  // Guard against overlap on a short/partial list (<8 oblasts): start the
  // bottom slice after the top-5 so no oblast is listed twice.
  const bottom = sorted.slice(Math.max(5, sorted.length - 3));
  const shown = [...top, ...bottom];

  // national cash-collection share = Σcash / Σpensions, summed only over the
  // oblasti where cash is actually known. (Deriving it as 1 − Σbank/Σpensions
  // treats a null bankPaid as zero, which would wrongly count all of that
  // oblast's pensions as cash.)
  const cashOblasts = list.filter(
    (o) => o.cashPaid != null && o.pensions != null,
  );
  const sumCash = cashOblasts.reduce((s, o) => s + (o.cashPaid ?? 0), 0);
  const sumPensions = cashOblasts.reduce((s, o) => s + (o.pensions ?? 0), 0);
  const nationalCashShare =
    sumPensions > 0 ? round2((100 * sumCash) / sumPensions) : null;
  const mostCash = [...list]
    .filter((o) => o.cashShare != null)
    .sort((a, b) => (b.cashShare ?? 0) - (a.cashShare ?? 0))[0];

  const rows: Row[] = shown.map((o) => ({
    oblast: o.nameBg,
    avg: fmtEur(o.avgPensionEur, ctx.lang),
    yoy: o.yoyPct != null ? round2(o.yoyPct) : null,
    cash: o.cashShare != null ? round2(o.cashShare * 100) : null,
  }));
  const columns: Column[] = [
    { key: "oblast", label: bg ? "Област" : "Oblast" },
    { key: "avg", label: bg ? "Средна пенсия" : "Avg pension", numeric: true },
    { key: "yoy", label: bg ? "Ръст" : "YoY", numeric: true, format: "pct" },
    {
      key: "cash",
      label: bg ? "В брой" : "Cash",
      numeric: true,
      format: "pct",
    },
  ];
  const hi = sorted[0];
  const lo = sorted[sorted.length - 1];

  return {
    tool: "noiPensionByOblast",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Средна пенсия по област (${f.latestYear})`
      : `Average pension by oblast (${f.latestYear})`,
    subtitle: bg
      ? "Топ и дъно по размер на средната пенсия, с дела на пенсиите, изплащани в брой"
      : "Top and bottom oblasts by average pension, with the share still paid in cash",
    columns,
    rows,
    categories: shown.map((o) => o.nameBg),
    series: [
      {
        key: "avg",
        label: bg ? "Средна пенсия (€)" : "Avg pension (€)",
        points: shown.map((o) => ({
          x: o.nameBg,
          y: Math.round(o.avgPensionEur),
        })),
      },
    ],
    viz: "bar",
    facts: {
      year: f.latestYear,
      top_oblast: hi?.nameBg ?? "—",
      top_avg: hi ? fmtEur(hi.avgPensionEur, ctx.lang) : "—",
      bottom_oblast: lo?.nameBg ?? "—",
      bottom_avg: lo ? fmtEur(lo.avgPensionEur, ctx.lang) : "—",
      spread:
        hi && lo ? fmtEur(hi.avgPensionEur - lo.avgPensionEur, ctx.lang) : "—",
      national_cash_share:
        nationalCashShare != null ? `${nationalCashShare}%` : "—",
      most_cash_oblast: mostCash?.nameBg ?? "—",
      most_cash_share:
        mostCash?.cashShare != null
          ? `${round2(mostCash.cashShare * 100)}%`
          : "—",
    },
    provenance: ["budget/noi/pensions.json"],
  };
};

// ---- 3. wage / insurable-income / pension national series -------------------

// The three headline series over time: gross wage, insurable income (the base
// contributions are actually levied on) and the average pension — plus the
// pension-to-wage replacement ratio. Cues: заплата спрямо пенсия / средна пенсия
// през годините / коефициент на заместване.
export const noiPensionSeries = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<NoiPensionsFile>("/budget/noi/pensions.json");
  const nat = [...f.national].sort((a, b) => a.year - b.year);
  if (!nat.length) {
    return {
      tool: "noiPensionSeries",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Няма данни за пенсиите" : "No pension series",
      viz: "none",
      facts: {},
      provenance: ["budget/noi/pensions.json"],
    };
  }
  const latest = nat[nat.length - 1];
  const ratio =
    latest.avgPensionBgn != null &&
    latest.avgWageBgn != null &&
    latest.avgWageBgn > 0
      ? round2((100 * latest.avgPensionBgn) / latest.avgWageBgn)
      : null;
  const years = nat.map((n) => n.year);

  return {
    tool: "noiPensionSeries",
    domain: "fiscal",
    kind: "series",
    title: bg
      ? "Заплата, осигурителен доход и пенсия във времето"
      : "Wage, insurable income and pension over time",
    subtitle: bg
      ? `Средни месечни стойности (€). Коефициент на заместване ${latest.year}: ${ratio ?? "—"}%`
      : `Average monthly values (EUR). Replacement ratio ${latest.year}: ${ratio ?? "—"}%`,
    categories: years,
    series: [
      {
        key: "wage",
        label: bg ? "Средна заплата" : "Avg wage",
        points: nat.map((n) => ({ x: n.year, y: n.avgWageEur })),
      },
      {
        key: "insurable",
        label: bg ? "Осигурителен доход" : "Insurable income",
        points: nat.map((n) => ({ x: n.year, y: n.avgInsurableIncomeEur })),
      },
      {
        key: "pension",
        label: bg ? "Средна пенсия" : "Avg pension",
        points: nat.map((n) => ({ x: n.year, y: n.avgPensionEur })),
      },
    ],
    viz: "line",
    markers: [{ x: latest.year, label: String(latest.year), kind: "peak" }],
    facts: {
      latest_year: latest.year,
      avg_wage:
        latest.avgWageEur != null ? fmtEur(latest.avgWageEur, ctx.lang) : "—",
      avg_insurable_income:
        latest.avgInsurableIncomeEur != null
          ? fmtEur(latest.avgInsurableIncomeEur, ctx.lang)
          : "—",
      avg_pension:
        latest.avgPensionEur != null
          ? fmtEur(latest.avgPensionEur, ctx.lang)
          : "—",
      pension_to_wage_ratio: ratio != null ? `${ratio}%` : "—",
      pensioners:
        latest.pensionerCount != null
          ? fmtInt(latest.pensionerCount, ctx.lang)
          : "—",
    },
    provenance: ["budget/noi/pensions.json"],
  };
};

// ---- 4. private pension funds (КФН, pillars 2 & 3) --------------------------

type KfnFundRow = {
  pillar: "UPF" | "PPF" | "VPF" | "VPFOS";
  pillarLabelBg: string;
  pillarLabelEn: string;
  pillarNumber: 2 | 3;
  fundName: string;
  companyBg: string;
  companyEn: string;
  insured: number | null;
  netAssetsBgn: number | null;
  netAssetsEur: number | null;
};
type KfnFundsFile = {
  period: string;
  periodLabel: string;
  funds: KfnFundRow[];
};

// The private (funded) pillars alongside the state NOI pension: total net assets
// and insured across all funds, the per-pillar totals (УПФ / ППФ / ДПФ), and the
// biggest funds by net assets. Cues: частни пенсионни фондове / УПФ / втори стълб.
export const kfnFunds = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<KfnFundsFile>("/budget/kfn/funds.json");
  if (!f.funds?.length) {
    return {
      tool: "kfnFunds",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Няма данни за частните пенсионни фондове"
        : "No private-pension-fund data",
      viz: "none",
      facts: {},
      provenance: ["budget/kfn/funds.json"],
    };
  }
  const totalAssets = f.funds.reduce((s, x) => s + (x.netAssetsEur ?? 0), 0);
  const totalInsured = f.funds.reduce((s, x) => s + (x.insured ?? 0), 0);

  // per-pillar totals, biggest pillar first
  const byPillarMap = new Map<
    string,
    { label: string; assets: number; insured: number }
  >();
  for (const x of f.funds) {
    const label = bg ? x.pillarLabelBg : x.pillarLabelEn;
    const cur = byPillarMap.get(x.pillar) ?? { label, assets: 0, insured: 0 };
    cur.assets += x.netAssetsEur ?? 0;
    cur.insured += x.insured ?? 0;
    byPillarMap.set(x.pillar, cur);
  }
  const byPillar = [...byPillarMap.values()].sort(
    (a, b) => b.assets - a.assets,
  );

  const n = Math.min(Math.max(Number(args.count) || 10, 1), 25);
  const top = [...f.funds]
    .sort((a, b) => (b.netAssetsEur ?? 0) - (a.netAssetsEur ?? 0))
    .slice(0, n);

  const rows: Row[] = top.map((x) => ({
    fund: bg ? x.companyBg : x.companyEn,
    pillar: bg ? x.pillarLabelBg : x.pillarLabelEn,
    insured: x.insured != null ? fmtInt(x.insured, ctx.lang) : "—",
    assets:
      x.netAssetsEur != null ? fmtEurCompact(x.netAssetsEur, ctx.lang) : "—",
  }));
  const columns: Column[] = [
    { key: "fund", label: bg ? "Дружество" : "Company" },
    { key: "pillar", label: bg ? "Стълб" : "Pillar" },
    { key: "insured", label: bg ? "Осигурени" : "Insured", numeric: true },
    { key: "assets", label: bg ? "Нетни активи" : "Net assets", numeric: true },
  ];
  const biggest = top[0];

  const facts: Record<string, string | number> = {
    period: f.periodLabel,
    funds: fmtInt(f.funds.length, ctx.lang),
    total_net_assets: fmtEurCompact(totalAssets, ctx.lang),
    total_insured: fmtInt(totalInsured, ctx.lang),
    biggest_fund: biggest ? (bg ? biggest.companyBg : biggest.companyEn) : "—",
    biggest_assets:
      biggest?.netAssetsEur != null
        ? fmtEurCompact(biggest.netAssetsEur, ctx.lang)
        : "—",
  };
  for (const p of byPillar) {
    facts[`pillar_${p.label}`] = fmtEurCompact(p.assets, ctx.lang);
  }

  return {
    tool: "kfnFunds",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Частни пенсионни фондове (${f.periodLabel})`
      : `Private pension funds (${f.periodLabel})`,
    subtitle: bg
      ? "Втори и трети стълб (КФН) — нетни активи и осигурени лица по дружество"
      : "Pillars 2 & 3 (KFN) — net assets and insured persons by company",
    columns,
    rows,
    categories: top.map((x) => (bg ? x.companyBg : x.companyEn)),
    series: [
      {
        key: "assets",
        label: bg ? "Нетни активи (€)" : "Net assets (€)",
        points: top.map((x) => ({
          x: bg ? x.companyBg : x.companyEn,
          y: Math.round(x.netAssetsEur ?? 0),
        })),
      },
    ],
    viz: "bar",
    facts,
    provenance: ["budget/kfn/funds.json"],
  };
};
