// Governance — fiscal tools (budget, COFOG, procurement, EU funds). All read
// headline index/rollup files; amounts are in EUR.

import { fetchData, fetchDb } from "./dataClient";
import { fmtEurCompact, fmtInt, fmtPct } from "./format";
import { round2 } from "./dataset";
import { fuzzyBestMatch } from "./resolve";
import { translitKey } from "./translit";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";
import { topicBySlug, detectTopic } from "@/lib/tenderTopics";
import type {
  ExciseRegisterFile,
  ExciseCategory,
  ExciseWarehouseMap,
} from "@/lib/customsReferenceData";
import {
  buildRoadsModel,
  API_EIK,
  COMPONENT_LABEL,
  type WorkComponent,
} from "@/lib/roadAttributes";
import {
  normalcyDeviationSummary,
  normalcyVerdict,
  procedureEvaluable,
  procedureIsDeviation,
  NORMALCY_MIN_N,
} from "@/lib/normalcy";
import { procedureLabel, type ProcedureBucket } from "@/lib/cpvSectors";

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

// Resolve a requested fiscal year against the years actually present. Flags when
// the request fell outside the data so callers can say so ("no 2050 data;
// showing 2024") instead of silently labelling the latest figure with the asked
// year. `available` is oldest-first; the fallback is its last (latest) entry.
const resolveYear = (
  requested: unknown,
  available: number[],
): { year: number; requested?: number; missing: boolean } => {
  const want = requested != null && requested !== "" ? Number(requested) : NaN;
  const latest = available[available.length - 1];
  if (!Number.isFinite(want)) return { year: latest, missing: false };
  if (available.includes(want)) return { year: want, missing: false };
  return { year: latest, requested: want, missing: true };
};

const yearMissingNote = (
  r: { requested?: number; year: number; missing: boolean },
  lang: ToolContext["lang"],
): string | undefined =>
  r.missing
    ? lang === "bg"
      ? `Няма данни за ${r.requested}; показана е ${r.year}.`
      : `No data for ${r.requested}; showing ${r.year}.`
    : undefined;

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
  // the user named a year we don't have actuals for -> show latest, but say so
  const requestedMissing = !!args.year && !requested;
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
    subtitle: requestedMissing
      ? ctx.lang === "bg"
        ? `Няма данни за ${args.year}; показана е ${year.fiscalYear}.`
        : `No data for ${args.year}; showing ${year.fiscalYear}.`
      : undefined,
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

// ---- budget over time (revenue / spending / balance per year) --------------
// The trend companion to `budgetOverview`. "Как се променя бюджетът през годините"
// / "how has the budget changed over time" → revenue + expenditure lines across
// complete fiscal years (the in-progress current year is excluded so its partial
// actuals don't read as a collapse), with the per-year balance carried in facts.
export const budgetTrend = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const idx = await fetchData<BudgetIndex>("/budget/index.json");
  // complete years only, chronological; fall back to all-with-actuals if no year
  // is flagged complete (keeps the tool working if the flag is ever absent).
  const withActual = idx.fiscalYears.filter((y) => y.actual?.balance);
  const complete = withActual.filter((y) => y.complete);
  const years = (complete.length ? complete : withActual).sort(
    (a, b) => a.fiscalYear - b.fiscalYear,
  );

  if (years.length === 0) {
    return {
      tool: "budgetTrend",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Няма бюджетни данни" : "No budget data",
      viz: "none",
      facts: {},
      provenance: ["budget/index.json"],
    };
  }

  const eur = (m?: Money) => (m ? m.amountEur : 0);
  const categories = years.map((y) => String(y.fiscalYear));
  const series = [
    {
      key: "revenue",
      label: bg ? "Приходи" : "Revenue",
      points: years.map((y) => ({
        x: String(y.fiscalYear),
        y: eur(y.actual!.revenue),
      })),
    },
    {
      key: "expenditure",
      label: bg ? "Разходи" : "Expenditure",
      points: years.map((y) => ({
        x: String(y.fiscalYear),
        y: eur(y.actual!.expenditure),
      })),
    },
  ];

  const first = years[0];
  const latest = years[years.length - 1];
  const span = `${first.fiscalYear}–${latest.fiscalYear}`;
  const facts: Record<string, string | number> = {
    years: years.length,
    span,
    latest_year: latest.fiscalYear,
    latest_revenue: fmtEurCompact(eur(latest.actual!.revenue), ctx.lang),
    latest_expenditure: fmtEurCompact(
      eur(latest.actual!.expenditure),
      ctx.lang,
    ),
    latest_balance: fmtEurCompact(eur(latest.actual!.balance), ctx.lang),
  };
  years.forEach((y) => {
    facts[String(y.fiscalYear)] =
      `${fmtEurCompact(eur(y.actual!.revenue), ctx.lang)} / ${fmtEurCompact(eur(y.actual!.expenditure), ctx.lang)}`;
  });

  return {
    tool: "budgetTrend",
    domain: "fiscal",
    kind: "series",
    title: bg
      ? `Държавен бюджет — приходи и разходи (${span})`
      : `State budget — revenue and spending (${span})`,
    subtitle: bg
      ? "Изпълнение по години (завършени фискални години)"
      : "Annual execution (completed fiscal years)",
    categories,
    series,
    viz: "line",
    facts,
    provenance: ["budget/index.json"],
  };
};

// ---- institution operating cost (издръжка) ---------------------------------
// The per-first-level-spending-unit operating-cost series behind the
// /indicators/budgets heatmap — the residual Asen Vasilev charts in "Бюджет
// 2026: Перо по перо" (издръжка = current spending minus personnel, subsidies,
// interest and household transfers), reconstructed from the State Budget Laws
// 2018→2026. With an institution → its multi-year line; without → the table of
// the biggest year-over-year increases in the draft budget.
type IzdInstitution = {
  bg: string;
  values: Record<string, number>; // year → EUR thousands
  yoy: Record<string, number>;
};
type IzdPayload = {
  years: number[];
  draftYear: number;
  source: string;
  institutions: IzdInstitution[];
};

// A few full-name / colloquial aliases so "издръжка на отбраната" or "на
// регионалното министерство" resolve to the short heatmap labels.
const IZD_ALIASES: Record<string, string[]> = {
  МРРБ: ["регионално развитие", "регионалното развитие", "благоустройство"],
  Отбрана: ["министерство на отбраната", "армия", "военни"],
  "Външни работи": ["външно министерство", "външни работи"],
  "Министерския съвет": ["министерски съвет"],
  "Държавен резерв": ["държавен резерв", "военновременни запаси"],
  "ДФ Земеделие": ["държавен фонд земеделие"],
  Земеделие: ["министерство на земеделието", "земеделие и храни"],
  Финанси: ["министерство на финансите"],
  МВР: ["вътрешни работи", "полиция"],
  Здравеопазване: ["министерство на здравеопазването", "здраве"],
  Образование: ["министерство на образованието", "образование и наука"],
  Култура: ["министерство на културата"],
};

export const institutionMaintenance = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const data = await fetchData<IzdPayload>(
    "/budget/izdrazhka_by_institution.json",
  );
  const dy = data.draftYear;
  const eurK = (k: number) => fmtEurCompact(k * 1000, ctx.lang);
  const q = String(args.institution ?? "").trim();
  // Containment-first resolution: the query is a whole sentence ("издръжка на
  // министерството на отбраната по години"), so a fuse pattern-match (pattern ≫
  // key) is unreliable — instead find the institution whose label/alias appears
  // in the query (longest wins), with a token-equality pass for short
  // abbreviations (МВР, МРРБ) and fuse only as a typo fallback.
  const nq = q.toLowerCase();
  const toks = nq.split(/[^a-zа-я0-9]+/i).filter(Boolean);
  let inst: IzdInstitution | undefined;
  let bestLen = 0;
  for (const i of data.institutions) {
    for (const k of [i.bg, ...(IZD_ALIASES[i.bg] ?? [])]) {
      const nk = k.toLowerCase();
      const hit =
        (nk.length >= 5 && nq.includes(nk)) ||
        (nk.length >= 3 && nk.length <= 6 && toks.includes(nk));
      if (hit && nk.length > bestLen) {
        bestLen = nk.length;
        inst = i;
      }
    }
  }
  if (!inst && q.length >= 3) {
    const m = fuzzyBestMatch(
      q,
      data.institutions.map((i) => ({
        item: i,
        keys: [i.bg, ...(IZD_ALIASES[i.bg] ?? [])],
      })),
      { threshold: 0.45, minLen: 3, tokenSort: true },
    );
    if (m) inst = m.item;
  }

  if (inst) {
    const pts = data.years
      .filter((y) => inst.values[String(y)] !== undefined)
      .map((y) => ({ x: String(y), y: inst.values[String(y)] }));
    const cur = inst.values[String(dy)];
    const yoy = inst.yoy[String(dy)];
    const peak = Math.max(...pts.map((p) => p.y));
    return {
      tool: "institutionMaintenance",
      domain: "fiscal",
      kind: "series",
      title: bg
        ? `Издръжка — ${inst.bg} (${data.years[0]}–${dy})`
        : `Operating cost — ${inst.bg} (${data.years[0]}–${dy})`,
      subtitle: bg
        ? "по приет бюджет; 2026 = проект"
        : "as adopted; 2026 = draft",
      categories: pts.map((p) => p.x),
      series: [
        {
          key: "izdrazhka",
          label: bg ? "Издръжка" : "Operating cost",
          points: pts,
        },
      ],
      viz: "line",
      facts: {
        institution: inst.bg,
        latest_year: dy,
        izdrazhka: cur !== undefined ? eurK(cur) : "—",
        yoy: yoy !== undefined ? `${yoy >= 0 ? "+" : ""}${round2(yoy)}%` : "—",
        vs_peak:
          peak > 0 && cur !== undefined
            ? `${Math.round((cur / peak - 1) * 100)}%`
            : "—",
      },
      provenance: ["budget/izdrazhka_by_institution.json"],
    };
  }

  // No institution resolved → the biggest draft-year increases.
  const ranked = data.institutions
    .map((i) => ({
      i,
      prev: i.values[String(dy - 1)],
      cur: i.values[String(dy)],
    }))
    .filter((r) => r.prev !== undefined && r.cur !== undefined)
    .map((r) => ({
      ...r,
      delta: r.cur - r.prev,
      pct: r.prev ? (r.cur / r.prev - 1) * 100 : 0,
    }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 12);
  const rows: Row[] = ranked.map((r) => ({
    institution: r.i.bg,
    [String(dy - 1)]: eurK(r.prev),
    [String(dy)]: eurK(r.cur),
    change: `${r.pct >= 0 ? "+" : ""}${Math.round(r.pct)}%`,
  }));
  const columns: Column[] = [
    { key: "institution", label: bg ? "Ведомство" : "Institution" },
    { key: String(dy - 1), label: String(dy - 1), numeric: true },
    { key: String(dy), label: String(dy), numeric: true },
    { key: "change", label: bg ? "Промяна" : "Change", numeric: true },
  ];
  return {
    tool: "institutionMaintenance",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Издръжка по ведомства — най-голям ръст ${dy}`
      : `Operating cost by institution — biggest ${dy} increase`,
    subtitle: bg
      ? "издръжка = текущи разходи без персонал, субсидии, лихви и трансфери; 2026 = проект"
      : "operating cost = current spending less personnel, subsidies, interest, transfers; 2026 = draft",
    columns,
    rows,
    viz: "none",
    facts: {
      institutions: data.institutions.length,
      top: ranked[0]?.i.bg ?? "—",
      top_change: ranked[0]
        ? `${ranked[0].pct >= 0 ? "+" : ""}${Math.round(ranked[0].pct)}%`
        : "—",
    },
    provenance: ["budget/izdrazhka_by_institution.json"],
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
  const allYears = (c.series.TOTAL ?? Object.values(c.series)[0] ?? []).map(
    (p) => p.year,
  );
  const yr = resolveYear(
    args.year,
    allYears.length ? allYears : [c.latestYear],
  );
  const year = yr.year;
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
    subtitle: yearMissingNote(yr, ctx.lang),
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

// ---- a single budget function (COFOG) slice + trend ------------------------
// Pensions are intentionally NOT here — they route to noiFunds (the pension
// fund). These are the spendable COFOG functions a user asks "how much for X".
// Keywords are chosen to avoid collisions: "здравей"≠"здравеопазв",
// "транспорт" contains "спорт" (so no "спорт"), "социалист"≠"социалн".
const FN_KEYWORDS: [string, string[]][] = [
  ["GF02", ["отбран", "defence", "defense", "военн", "армия"]],
  ["GF03", ["обществен ред", "сигурност", "полиц", "public order", "police"]],
  ["GF05", ["околна среда", "екологи", "environment"]],
  ["GF06", ["жилищ", "благоустр", "housing"]],
  ["GF07", ["здравеопазв", "здравн", "болниц", "медицин", "health"]],
  ["GF08", ["култур", "религи", "culture", "recreation"]],
  ["GF09", ["образов", "училищ", "education", "school"]],
  ["GF10", ["социалн", "social protection", "социална защита"]],
  ["GF01", ["държавни служби", "администрац", "general public"]],
  ["GF04", ["икономически дейности", "economic affairs"]],
];

// keyword/code -> COFOG gf code (undefined if nothing matches)
export const resolveBudgetFunction = (text: string): string | undefined => {
  const q = text.toLowerCase();
  const codeMatch = q.match(/\bgf(\d{1,2})\b/); // GF1..GF10 (1 or 2 digits)
  if (codeMatch) {
    const code = `GF${codeMatch[1].padStart(2, "0")}`;
    if (COFOG[code]) return code;
  }
  for (const [gf, kws] of FN_KEYWORDS)
    if (kws.some((k) => q.includes(k))) return gf;
  return undefined;
};

export const budgetFunction = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const c = await fetchData<CofogData>("/cofog.json");
  const gf = resolveBudgetFunction(String(args.category ?? ""));
  // unrecognized function -> fall back to the full functional breakdown
  if (!gf || !c.series[gf]) return budgetByFunction(args, ctx);

  const pts = c.series[gf];
  const yr = resolveYear(
    args.year,
    pts.length ? pts.map((p) => p.year) : [c.latestYear],
  );
  const year = yr.year;
  const at = (arr: CofogPoint[]) =>
    arr.find((p) => p.year === year) ?? arr[arr.length - 1];
  const value = at(pts)?.valueEur ?? 0;
  const total = at(c.series.TOTAL ?? [])?.valueEur ?? 0;
  const pct = total > 0 ? round2((100 * value) / total) : 0;
  const ranking = Object.entries(c.series)
    .filter(([k]) => k !== "TOTAL")
    .map(([k, a]) => ({ k, v: at(a)?.valueEur ?? 0 }))
    .sort((a, b) => b.v - a.v);
  const rank = ranking.findIndex((r) => r.k === gf) + 1;
  const label = (COFOG[gf] ?? { bg: gf, en: gf })[ctx.lang];

  return {
    tool: "budgetFunction",
    domain: "fiscal",
    kind: "series",
    title:
      ctx.lang === "bg"
        ? `Разходи за „${label}“ (COFOG)`
        : `Spending on "${label}" (COFOG)`,
    subtitle: yearMissingNote(yr, ctx.lang),
    categories: pts.map((p) => String(p.year)),
    series: [
      {
        key: "amount",
        label: ctx.lang === "bg" ? "Разход (€)" : "Spend (€)",
        points: pts.map((p) => ({
          x: String(p.year),
          y: Math.round(p.valueEur),
        })),
      },
    ],
    viz: "line",
    facts: {
      function: label,
      year,
      amount: fmtEurCompact(value, ctx.lang),
      share_of_budget: `${pct}%`,
      rank,
      total: fmtEurCompact(total, ctx.lang),
    },
    provenance: ["cofog.json"],
  } as Envelope;
};

// ---- procurement totals -----------------------------------------------------

// The flattened totals from procurement_overview (025). The MP/official
// connected sums are DISTINCT-contractor (each linked firm counted once) — the
// legacy index.json summed per MP↔firm pair, double-counting firms tied to
// several politicians.
type OverviewTotals = {
  contracts: number;
  totalEur: number;
  contractorCount: number;
  awarderCount: number;
  mpCount: number;
  mpConnectedTotalEur: number;
  officialCount?: number;
  officialConnectedTotalEur?: number;
};

export const procurementTotals = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const { totals: t } = await fetchDb<{ totals: OverviewTotals }>(
    "procurement-overview",
  );
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
      contracts: fmtInt(t.contracts, ctx.lang),
      total_value: fmtEurCompact(t.totalEur, ctx.lang),
      contractors: fmtInt(t.contractorCount, ctx.lang),
      buyers: fmtInt(t.awarderCount, ctx.lang),
      // Distinct-contractor sum (each linked firm once) — the /procurement
      // dashboard figure. The legacy index.json summed per MP↔firm pair, so a
      // firm tied to several MPs was double-counted (~1.16bn → ~981M).
      mp_connected_value: fmtEurCompact(t.mpConnectedTotalEur, ctx.lang),
      mp_connected_count: t.mpCount,
      // Officials (non-MP political class) tied to contract winners.
      ...(t.officialConnectedTotalEur != null
        ? {
            official_connected_value: fmtEurCompact(
              t.officialConnectedTotalEur,
              ctx.lang,
            ),
            official_connected_count: t.officialCount,
          }
        : {}),
    },
    provenance: ["db:procurement-overview"],
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
  const f = await fetchDb<FundsIndex>("fund-payload", { kind: "index" });
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
    provenance: ["db:fund-payload (ИСУН index)"],
  };
};

// ---- top procurement contractors --------------------------------------------
// The per-contractor drill-down behind procurementTotals' headline: who wins the
// most public money, with the MP-tied flag carried through from the cross-ref.

type ContractorEntry = {
  eik: string;
  name: string;
  totalEur: number;
  contractCount: number;
  mpTied?: boolean;
};

export const topContractors = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  // procurement_rankings.topContractors — the same ranked set (eik, name,
  // totalEur, contractCount, mpTied) the /procurement leaderboard serves; names
  // are the canonical TR spelling.
  const d = await fetchDb<{ topContractors: ContractorEntry[] }>(
    "procurement-rankings",
  );
  const n = Math.min(Math.max(Number(args.count) || 12, 1), 25);
  const top = [...d.topContractors]
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, n);
  const mpTied = top.filter((e) => e.mpTied).length;
  const rows: Row[] = top.map((e) => ({
    contractor: e.name,
    amount: fmtEurCompact(e.totalEur, ctx.lang),
    contracts: e.contractCount,
    mp: e.mpTied ? (bg ? "да" : "yes") : "—",
  }));
  return {
    tool: "topContractors",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Най-големи изпълнители по обществени поръчки (АОП)"
      : "Largest public-procurement contractors (AOP)",
    subtitle: bg
      ? "По обща стойност на договорите; „Депутат“ = свързан със заседаващ депутат"
      : "By total contract value; “MP-tied” = linked to a sitting MP",
    columns: [
      { key: "contractor", label: bg ? "Изпълнител" : "Contractor" },
      { key: "amount", label: bg ? "Стойност" : "Value", numeric: true },
      {
        key: "contracts",
        label: bg ? "Договори" : "Contracts",
        numeric: true,
        format: "int",
      },
      { key: "mp", label: bg ? "Депутат" : "MP-tied" },
    ],
    rows,
    viz: "none",
    facts: {
      top_contractor: top[0]?.name ?? "—",
      top_value: top[0] ? fmtEurCompact(top[0].totalEur, ctx.lang) : "—",
      mp_tied_in_top: mpTied,
    },
    provenance: ["db:procurement-rankings"],
  };
};

// ---- contract search (one contractor's own contracts) -----------------------
// The AI analog of the /procurement/contracts browser, scoped to one winning
// firm: resolve a company by name (against the top-contractors index) or EIK,
// then list its contracts — each row's contract deep-links to its own page, now
// that the prefix-sharded by-id store resolves every /procurement/contract/:key
// (not just the top-N). Distinct from topContractors (a ranking) and
// awarderProcurement (a BUYER's procurement).

// One row of the /api/db/table contracts engine (camelCased projection).
type ContractTableRow = {
  key: string;
  date: string;
  dateSigned?: string;
  awarderName: string;
  contractorName?: string;
  title: string;
  amountEur?: number;
  numberOfTenderers?: number;
  // Migration 087: a consortium MEMBER row's amountEur is €0; consortiumFullEur is
  // the full joint-contract value (its real share isn't public).
  consortiumRole?: "carrier" | "member";
  consortiumFullEur?: number;
};
type ContractsTablePage = {
  rows: ContractTableRow[];
  total: number;
  aggregates?: { sumAmountEur?: number; count?: number };
};

// Strip the procurement/question filler so the residue is just the firm name to
// resolve. Token-set filtering, NOT a `\b…\b` regex — word boundaries are
// unreliable around Cyrillic, so the BG filler ("Покажи договорите на …") would
// otherwise survive and drown the name.
const COMPANY_STOP_SET = new Set([
  "договорите",
  "договори",
  "договор",
  "поръчките",
  "поръчки",
  "поръчка",
  "на",
  "спечелени",
  "спечелил",
  "спечелила",
  "спечели",
  "печели",
  "какви",
  "каква",
  "какъв",
  "има",
  "получи",
  "получила",
  "колко",
  "фирма",
  "фирмата",
  "фирмите",
  "компания",
  "компанията",
  "дружество",
  "дружеството",
  "покажи",
  "кои",
  "са",
  "е",
  "за",
  "от",
  "еик",
  "eik",
  "contracts",
  "contract",
  "won",
  "win",
  "wins",
  "by",
  "of",
  "for",
  "the",
  "show",
  "me",
  "what",
  "has",
  "have",
  "did",
  "does",
  "list",
  "all",
  "company",
  "firm",
  "procurement",
]);
export const cleanCompany = (raw: string): string =>
  raw
    .replace(/[„“"']/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[?.,!:;]+$/g, ""))
    .filter((w) => w && !COMPANY_STOP_SET.has(w.toLowerCase()))
    .join(" ")
    .trim();

export const contractSearch = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const raw = String(args.company ?? args.eik ?? "").trim();
  const cleaned = cleanCompany(raw);

  // Resolve to (eik, name): a bare 9–13-digit token is already an EIK; otherwise
  // trgm-search the full contractor corpus. procurement_search covers ALL ~26k
  // contractors, replacing the old top_contractors + contractors_search lookups.
  let eik: string | undefined;
  let name: string | undefined;
  if (/^\d{9,13}$/.test(raw)) eik = raw;
  else if (/^\d{9,13}$/.test(cleaned)) eik = cleaned; // "ЕИК 1234…" → the digits
  if (!eik && cleaned) {
    const sr = await fetchDb<{ companies: { eik: string; name: string }[] }>(
      "procurement-search",
      { q: cleaned, limit: 1 },
    );
    const hit = sr.companies?.[0];
    if (hit) {
      eik = hit.eik;
      name = hit.name;
    }
  }

  const notFound = (): Envelope => ({
    tool: "contractSearch",
    domain: "fiscal",
    kind: "scalar",
    title: bg
      ? `Не намерих фирма „${raw}“ сред изпълнителите по поръчки`
      : `No procurement contractor matching “${raw}”`,
    subtitle: bg
      ? "Пробвайте с ЕИК или точното име на фирмата."
      : "Try the EIK or the exact company name.",
    facts: {},
    viz: "none",
    provenance: ["db:procurement-search"],
  });

  if (!eik) return notFound();

  // Contractor's contracts via the /api/db/table contracts engine: top-N by value
  // (+ optional year window) for the table, plus the corpus-wide count + Σ from
  // its aggregates so the totals stay accurate over ALL the firm's contracts.
  // NB: `page` is 0-indexed (page 0 = first page).
  const yr = Number(args.year);
  const hasYear = Number.isFinite(yr);
  const scopeCols: Array<Record<string, unknown>> = [
    { id: "contractor_eik", value: eik },
  ];
  if (hasYear)
    scopeCols.push({ id: "date", min: `${yr}-01-01`, max: `${yr}-12-31` });
  const n = Math.min(Math.max(Number(args.count) || 12, 1), 25);

  const page = await fetchDb<ContractsTablePage>("table", {
    q: JSON.stringify({
      resource: "contracts",
      page: 0,
      pageSize: n,
      sort: [{ id: "amount_eur", desc: true }],
      filters: { columns: scopeCols },
    }),
  });
  const top = page.rows;
  if (!top.length) return notFound();

  const contractCount = page.total;
  const totalEur = page.aggregates?.sumAmountEur ?? 0;
  name = name ?? top[0].contractorName ?? raw;

  // Single-bid count: the same scope filtered to exactly one tenderer.
  const singleBidPage = await fetchDb<ContractsTablePage>("table", {
    q: JSON.stringify({
      resource: "contracts",
      page: 0,
      pageSize: 1,
      sort: [{ id: "amount_eur", desc: true }],
      filters: {
        columns: [...scopeCols, { id: "number_of_tenderers", min: 1, max: 1 }],
      },
    }),
  });
  const singleBid = singleBidPage.total;
  const eurOf = (c: ContractTableRow): number => c.amountEur ?? 0;
  const biggest = top[0];

  const rows: Row[] = top.map((c) => ({
    date: (c.dateSigned || c.date || "").slice(0, 10),
    awarder: c.awarderName,
    subject: c.title.length > 80 ? c.title.slice(0, 79) + "…" : c.title,
    bids: typeof c.numberOfTenderers === "number" ? c.numberOfTenderers : "—",
    // A consortium member's own amount is €0 (migration 087); show the full
    // joint-contract value with a note so it doesn't read as a €0 contract.
    amount:
      c.consortiumRole === "member"
        ? `${fmtEurCompact(c.consortiumFullEur ?? 0, ctx.lang)} (${bg ? "обединение" : "consortium"})`
        : fmtEurCompact(eurOf(c), ctx.lang),
  }));

  const columns: Column[] = [
    { key: "date", label: bg ? "Дата" : "Date" },
    { key: "awarder", label: bg ? "Възложител" : "Awarder" },
    { key: "subject", label: bg ? "Предмет" : "Subject" },
    { key: "bids", label: bg ? "Оферти" : "Bids", numeric: true },
    { key: "amount", label: bg ? "Стойност" : "Value", numeric: true },
  ];

  return {
    tool: "contractSearch",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Договори на ${name}${hasYear ? ` (${yr})` : ""}`
      : `Contracts won by ${name}${hasYear ? ` (${yr})` : ""}`,
    subtitle: bg
      ? `${fmtInt(contractCount, ctx.lang)} договора · ${fmtEurCompact(totalEur, ctx.lang)} общо — показани най-едрите ${top.length}`
      : `${fmtInt(contractCount, ctx.lang)} contracts · ${fmtEurCompact(totalEur, ctx.lang)} total — showing the largest ${top.length}`,
    columns,
    rows,
    viz: "none",
    facts: {
      company: name,
      eik_id: eik, // hidden → /company/:eik (see links.ts)
      contracts: fmtInt(contractCount, ctx.lang),
      total_value: fmtEurCompact(totalEur, ctx.lang),
      single_bidder: singleBid,
      biggest_awarder: biggest?.awarderName ?? "—",
      biggest_value: biggest ? fmtEurCompact(eurOf(biggest), ctx.lang) : "—",
      ...(biggest?.key ? { contract_id: biggest.key } : {}), // hidden → /procurement/contract/:key
    },
    provenance: ["db:procurement-search", "db:table/contracts"],
  };
};

// ---- procurement red-flag feed ----------------------------------------------
// The accountability digest: buyers whose spend is concentrated on a single
// supplier, plus how many suppliers are on the active debarment register.
// Mirrors the /procurement/flags page; all from committed derived files.

type ConcentrationEntry = {
  awarderName: string;
  contractorName: string;
  sharePct: number;
  pairTotalEur: number;
};

export const procurementRedFlags = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  // Concentration feed from Postgres (procurement_risk_feed) — same pairs +
  // shares the /procurement risk dashboard serves; supplier names are the
  // canonical TR spelling. debarred.json stays JSON (it is the PG load source).
  const feed = await fetchDb<{ topConcentration: ConcentrationEntry[] }>(
    "procurement-risk-feed",
  );
  const deb = await fetchDb<{ active: number }>("debarred");
  const activeDebarred = deb.active;
  const top = feed.topConcentration.slice(0, 10);
  const rows: Row[] = top.map((e) => ({
    awarder: e.awarderName,
    contractor: e.contractorName,
    share: `${Math.round(e.sharePct * 100)}%`,
    amount: fmtEurCompact(e.pairTotalEur, ctx.lang),
  }));
  return {
    tool: "procurementRedFlags",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Сигнали за риск в обществените поръчки"
      : "Public-procurement red flags",
    subtitle: bg
      ? "Възложители с концентрация на разхода върху един изпълнител"
      : "Buyers whose spending is concentrated on a single supplier",
    columns: [
      { key: "awarder", label: bg ? "Възложител" : "Buyer" },
      { key: "contractor", label: bg ? "Изпълнител" : "Supplier" },
      { key: "share", label: bg ? "Дял" : "Share", numeric: true },
      { key: "amount", label: bg ? "Стойност" : "Value", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      active_debarred: activeDebarred,
      top_share: top[0] ? `${Math.round(top[0].sharePct * 100)}%` : "—",
    },
    provenance: ["db:procurement-risk-feed", "db:debarred"],
  };
};

// ---- structurally single-bid CPV sectors ------------------------------------
// Makes the single-bidder suppression methodology queryable: which 2-digit CPV
// divisions sit at/above the structural single-bid threshold, so a lone bid is
// the market norm there and the "single bidder" red flag is suppressed (not an
// anomaly). Reads the per-CPV competition baseline derived in the ingest
// (scripts/procurement/cpv_competition.ts).

type CpvDivisionRow = {
  division: string;
  contractCount: number;
  withBidData: number;
  singleBid: number;
  singleBidShare: number;
};
type CpvCompetitionFile = {
  generatedAt: string;
  structuralSingleBidShare: number;
  divisions: CpvDivisionRow[];
};

// CPV 2008 two-digit division titles (abbreviated for table readability). Covers
// every division the baseline file currently carries; unknown codes fall back to
// a "CPV <code>" label so a future division never renders blank.
const CPV_DIVISION_LABELS: Record<string, { bg: string; en: string }> = {
  "03": {
    bg: "Селско и горско стопанство, риболов",
    en: "Agriculture, forestry, fishing",
  },
  "09": {
    bg: "Горива, енергия, нефтопродукти",
    en: "Fuel, energy, petroleum products",
  },
  "14": {
    bg: "Добив, метали и свързани продукти",
    en: "Mining, metals & related products",
  },
  "15": { bg: "Храни, напитки, тютюн", en: "Food, beverages & tobacco" },
  "16": { bg: "Селскостопански машини", en: "Agricultural machinery" },
  "18": {
    bg: "Облекло, обувки, аксесоари",
    en: "Clothing, footwear & accessories",
  },
  "19": {
    bg: "Кожи, текстил, пластмаси, каучук",
    en: "Leather, textiles, plastics & rubber",
  },
  "22": { bg: "Печатни материали", en: "Printed matter & related products" },
  "24": { bg: "Химически продукти", en: "Chemical products" },
  "30": { bg: "Офис и компютърна техника", en: "Office & computing machinery" },
  "31": {
    bg: "Електрически машини и осветление",
    en: "Electrical machinery & lighting",
  },
  "32": {
    bg: "Радио-, ТВ и далекосъобщителна техника",
    en: "Radio, TV & telecom equipment",
  },
  "33": {
    bg: "Медицинско оборудване и лекарства",
    en: "Medical equipment & pharmaceuticals",
  },
  "34": { bg: "Транспортно оборудване", en: "Transport equipment" },
  "35": {
    bg: "Оборудване за сигурност, пожарна и отбрана",
    en: "Security, fire & defence equipment",
  },
  "37": {
    bg: "Музикални инструменти, спортни стоки, играчки",
    en: "Musical instruments, sports goods & toys",
  },
  "38": {
    bg: "Лабораторна, оптична и измервателна техника",
    en: "Laboratory, optical & precision equipment",
  },
  "39": {
    bg: "Мебели, обзавеждане, домакински уреди",
    en: "Furniture, furnishings & appliances",
  },
  "41": { bg: "Събрана и пречистена вода", en: "Collected & purified water" },
  "42": { bg: "Промишлени машини", en: "Industrial machinery" },
  "43": {
    bg: "Минна и строителна техника",
    en: "Mining & construction machinery",
  },
  "44": {
    bg: "Строителни конструкции и материали",
    en: "Construction structures & materials",
  },
  "45": { bg: "Строителни работи", en: "Construction work" },
  "48": {
    bg: "Софтуер и информационни системи",
    en: "Software & information systems",
  },
  "50": {
    bg: "Услуги по ремонт и поддръжка",
    en: "Repair & maintenance services",
  },
  "51": { bg: "Услуги по монтаж", en: "Installation services" },
  "55": {
    bg: "Хотелиерство, ресторантьорство, търговия",
    en: "Hotel, restaurant & retail services",
  },
  "60": { bg: "Транспортни услуги", en: "Transport services" },
  "63": {
    bg: "Спомагателни транспортни и туристически услуги",
    en: "Supporting transport & travel services",
  },
  "64": {
    bg: "Пощенски и далекосъобщителни услуги",
    en: "Postal & telecommunications services",
  },
  "65": {
    bg: "Комунални услуги (ток, газ, вода, парно)",
    en: "Public utilities (electricity, gas, water, heating)",
  },
  "66": {
    bg: "Финансови и застрахователни услуги",
    en: "Financial & insurance services",
  },
  "70": { bg: "Услуги с недвижими имоти", en: "Real estate services" },
  "71": {
    bg: "Архитектурни, инженерни и инспекционни услуги",
    en: "Architectural, engineering & inspection services",
  },
  "72": {
    bg: "ИТ услуги: консултации, разработка на софтуер",
    en: "IT services: consulting & software development",
  },
  "73": {
    bg: "Научноизследователски и развойни услуги",
    en: "Research & development services",
  },
  "75": {
    bg: "Държавно управление, отбрана, соц. осигуряване",
    en: "Public administration, defence & social security",
  },
  "76": {
    bg: "Услуги за нефтената и газовата промишленост",
    en: "Services for the oil & gas industry",
  },
  "77": {
    bg: "Селскостопански, горски и градинарски услуги",
    en: "Agricultural, forestry & horticultural services",
  },
  "79": {
    bg: "Бизнес услуги: право, маркетинг, консултации",
    en: "Business services: law, marketing & consulting",
  },
  "80": {
    bg: "Образователни и обучителни услуги",
    en: "Education & training services",
  },
  "85": {
    bg: "Здравни и социални услуги",
    en: "Health & social work services",
  },
  "90": {
    bg: "Канализация, отпадъци, почистване, околна среда",
    en: "Sewage, refuse, cleaning & environmental services",
  },
  "92": {
    bg: "Услуги в областта на отдиха, културата и спорта",
    en: "Recreational, cultural & sporting services",
  },
  "98": {
    bg: "Други обществени, социални и лични услуги",
    en: "Other community, social & personal services",
  },
};

const cpvLabel = (division: string, lang: ToolContext["lang"]): string => {
  const l = CPV_DIVISION_LABELS[division];
  if (l) return lang === "bg" ? l.bg : l.en;
  return lang === "bg" ? `CPV раздел ${division}` : `CPV division ${division}`;
};

export const procurementSingleBidSectors = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  // cpvCompetition from procurement_risk_indexes — the same per-CPV single-bid
  // baseline the /procurement risk scorer uses (suppressed-set identical; the
  // displayed counts track the live risk-indexes snapshot).
  const ri = await fetchDb<{ cpvCompetition: CpvCompetitionFile }>(
    "procurement-risk-indexes",
  );
  const f = ri.cpvCompetition;
  const threshold = f.structuralSingleBidShare;
  const thresholdPct = Math.round(threshold * 100);
  const suppressed = f.divisions
    .filter((d) => d.withBidData > 0 && d.singleBidShare >= threshold)
    .sort((a, b) => b.singleBidShare - a.singleBidShare);
  const rows: Row[] = suppressed.map((d) => ({
    sector: `${cpvLabel(d.division, ctx.lang)} (CPV ${d.division})`,
    share: `${Math.round(d.singleBidShare * 100)}%`,
    contracts: fmtInt(d.contractCount, ctx.lang),
  }));
  return {
    tool: "procurementSingleBidSectors",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Сектори, в които един участник е нормално"
      : "Sectors where a single bidder is the norm",
    subtitle: bg
      ? `Раздели по CPV с дял на едноучастниковите поръчки ≥ ${thresholdPct}% — там сигналът „един участник“ се потиска, за да няма фалшив сигнал`
      : `CPV divisions with a single-bid share ≥ ${thresholdPct}% — the single-bidder red flag is suppressed there so it doesn't cry wolf`,
    columns: [
      { key: "sector", label: bg ? "Сектор (CPV)" : "Sector (CPV)" },
      {
        key: "share",
        label: bg ? "Дял с един участник" : "Single-bid share",
        numeric: true,
      },
      { key: "contracts", label: bg ? "Договори" : "Contracts", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      threshold: `${thresholdPct}%`,
      suppressed_divisions: suppressed.length,
      total_divisions: f.divisions.length,
    },
    provenance: ["db:procurement-risk-indexes"],
  };
};

// ---- debarred suppliers (черен списък) --------------------------------------
// The list behind procurementRedFlags' active_debarred count: the companies on
// the АОП "Стопански субекти с нарушения" register. The `debarred` route serves
// the still-active debarments (the register retains historical entries the live
// page has dropped; the route filters them out and returns the total).

type DebarredFull = {
  name: string;
  publishedAt: string;
  debarredUntil: string;
  detailsUrl: string | null;
};
type DebarredPayload = {
  entries: DebarredFull[];
  total: number;
  active: number;
};

export const procurementDebarred = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchDb<DebarredPayload>("debarred");
  // Route returns active entries already sorted newest-expiry first.
  const active = f.entries;
  const rows: Row[] = active.map((e) => ({
    company: e.name,
    until: e.debarredUntil || (bg ? "безсрочно" : "open-ended"),
    since: e.publishedAt,
  }));
  return {
    tool: "procurementDebarred",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Изпълнители в черния списък (АОП)"
      : "Debarred suppliers (AOP)",
    subtitle: bg
      ? "Стопански субекти с влязла в сила забрана да участват в обществени поръчки"
      : "Economic operators currently barred from public procurement",
    columns: [
      { key: "company", label: bg ? "Фирма" : "Company" },
      { key: "until", label: bg ? "Забрана до" : "Debarred until" },
      { key: "since", label: bg ? "В сила от" : "Since" },
    ],
    rows,
    viz: "none",
    facts: {
      active_debarred: f.active,
      total_incl_historical: f.total,
    },
    provenance: ["db:debarred"],
  };
};

// ---- procurement to MP-connected companies (+ per-MP trend) -----------------
// The journalism payload: contracts going to firms a sitting MP owns or manages.
// A named MP returns a per-year value trend; otherwise the biggest MP↔contractor
// relationships across the chamber.

// person route payload (subset the tool needs): the connected-company edges
// (person_politicians) + aggregated by-year procurement (person_procurement),
// covering MPs AND non-MP officials in one curated-set call.
type PersonProcPayload = {
  politicians?: Array<{
    politician: string;
    kind: string; // 'mp' | official tier
    role: string;
    via_company?: string;
    total_eur?: number;
  }>;
  procurement?: {
    totalEur: number;
    byYear?: { year: string; totalEur: number; contractCount: number }[];
  } | null;
};
// procurement_rankings.topMps rows (chamber ranking).
type TopMpRow = {
  mpName: string;
  totalEur: number;
  contractCount: number;
  topContractorNames?: string[];
};

export const mpProcurement = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const who = String(args.person ?? "").trim();

  if (who) {
    // Person mode — one named politician (MP or official), unified via the
    // person route (person_procurement + person_politicians = the curated set).
    const p = await fetchDb<PersonProcPayload>("person", { name: who });
    const pol = p?.politicians ?? [];
    const proc = p?.procurement;
    if (pol.length && proc && proc.totalEur > 0) {
      const personName = pol[0].politician;
      const roleKey = pol[0].kind === "mp" ? "mp" : "official";
      const byYear = (proc.byYear ?? [])
        .filter((y) => y.totalEur > 0)
        .sort((a, b) => a.year.localeCompare(b.year));
      if (byYear.length > 1) {
        return {
          tool: "mpProcurement",
          domain: "fiscal",
          kind: "series",
          title: bg
            ? `Поръчки към фирми, свързани с ${personName}`
            : `Procurement to firms tied to ${personName}`,
          subtitle: bg
            ? "По година (стойност на договорите)"
            : "By year (contract value)",
          categories: byYear.map((y) => y.year),
          series: [
            {
              key: "value",
              label: bg ? "Стойност (€)" : "Value (€)",
              points: byYear.map((y) => ({
                x: y.year,
                y: Math.round(y.totalEur),
              })),
            },
          ],
          viz: "line",
          facts: {
            [roleKey]: personName,
            role: pol[0].role,
            companies: pol.length,
            total_value: fmtEurCompact(proc.totalEur, ctx.lang),
            years: byYear.length,
          },
          provenance: ["db:person"],
        };
      }
      // single-year / single-firm -> a compact table of the connected firms.
      const firms = pol
        .filter((r) => r.via_company)
        .sort((a, b) => (b.total_eur ?? 0) - (a.total_eur ?? 0));
      return {
        tool: "mpProcurement",
        domain: "fiscal",
        kind: "table",
        title: bg
          ? `Поръчки към фирми, свързани с ${personName}`
          : `Procurement to firms tied to ${personName}`,
        columns: [
          { key: "contractor", label: bg ? "Изпълнител" : "Contractor" },
          { key: "amount", label: bg ? "Стойност" : "Value", numeric: true },
        ],
        rows: firms.map((r) => ({
          contractor: r.via_company ?? "—",
          amount: fmtEurCompact(r.total_eur ?? 0, ctx.lang),
        })),
        viz: "none",
        facts: {
          [roleKey]: personName,
          role: pol[0].role,
          companies: pol.length,
          total_value: fmtEurCompact(proc.totalEur, ctx.lang),
        },
        provenance: ["db:person"],
      };
    }
    // named person not connected -> fall through to the chamber ranking.
  }

  // Chamber ranking — top MPs by connected procurement value (curated set).
  const rk = await fetchDb<{ topMps?: TopMpRow[] }>("procurement-rankings");
  const top = (rk.topMps ?? []).slice(0, 12);
  const rows: Row[] = top.map((e) => ({
    mp: e.mpName,
    contractor: e.topContractorNames?.[0] ?? "—",
    amount: fmtEurCompact(e.totalEur, ctx.lang),
    contracts: e.contractCount,
  }));
  return {
    tool: "mpProcurement",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Поръчки към фирми, свързани с депутати (АОП)"
      : "Procurement to MP-connected companies (AOP)",
    subtitle: bg
      ? "Депутати с най-голяма стойност на договорите към свързани фирми"
      : "MPs with the largest contract value to connected firms",
    columns: [
      { key: "mp", label: bg ? "Депутат" : "MP" },
      { key: "contractor", label: bg ? "Основна фирма" : "Main firm" },
      { key: "amount", label: bg ? "Стойност" : "Value", numeric: true },
      {
        key: "contracts",
        label: bg ? "Договори" : "Contracts",
        numeric: true,
        format: "int",
      },
    ],
    rows,
    viz: "none",
    facts: {
      top_mp: top[0]?.mpName ?? "—",
      top_contractor: top[0]?.topContractorNames?.[0] ?? "—",
      top_value: top[0] ? fmtEurCompact(top[0].totalEur, ctx.lang) : "—",
    },
    provenance: ["db:procurement-rankings"],
  };
};

// ---- procurement for one buyer (awarder / contracting authority) ------------
// The buyer-side drill-down: how much a single institution spent on public
// procurement, its biggest suppliers and its by-year trend. Resolves the named
// institution against the full awarders index (derived/awarders_index.json) —
// the only place a buyer can be found BY NAME, and the surface for the ~900
// small schools the ЦАИС ЕОП gap-fill adds. Accepts an EIK directly too.

type AwarderRollup = {
  eik: string;
  name: string;
  totalEur: number;
  totalOther?: Record<string, number>;
  contractCount: number;
  byContractor?: { eik: string; name: string; totalEur: number }[];
  byYear?: { year: string; totalEur: number; contractCount: number }[];
};

// Question/procurement filler stripped before fuzzy-matching the institution
// name, so "колко похарчи СУ Добри Чинтулов за обществени поръчки" reduces to
// the distinctive "су добри чинтулов".
const AWARDER_QUERY_STOP = new Set([
  "поръчки",
  "поръчка",
  "поръчките",
  "обществени",
  "обществената",
  "договори",
  "договор",
  "колко",
  "похарчи",
  "похарчиха",
  "харчи",
  "изхарчи",
  "плати",
  "за",
  "на",
  "в",
  "във",
  "от",
  "е",
  "са",
  "колко",
  "какви",
  "кои",
  "show",
  "procurement",
  "contracts",
  "contract",
  "spent",
  "spend",
  "how",
  "much",
  "did",
  "the",
  "of",
  "for",
  "by",
  "on",
  "in",
  "what",
  "аоп",
  "aop",
]);

const cleanAwarderQuery = (raw: string): string =>
  raw
    .replace(/[?.,!„“”"'`]/g, " ")
    .split(/\s+/)
    .filter(
      (w) => w && !AWARDER_QUERY_STOP.has(w.toLowerCase()) && !/^\d+$/.test(w),
    )
    .join(" ")
    .trim();

export const awarderProcurement = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const raw = String(args.org ?? args.place ?? "").trim();
  // Resolve (eik, name): a bare EIK wins; otherwise trgm-search the awarder
  // corpus — procurement_search returns awarders alongside contractors.
  const eikInRaw = raw.match(/\b\d{9,13}\b/)?.[0];
  let eik: string | undefined = eikInRaw;
  let name: string | undefined;
  if (!eik) {
    const sr = await fetchDb<{ awarders: { eik: string; name: string }[] }>(
      "procurement-search",
      { q: cleanAwarderQuery(raw), limit: 1 },
    );
    const hit = sr.awarders?.[0];
    if (hit) {
      eik = hit.eik;
      name = hit.name;
    }
  }

  const notFound = (): Envelope => ({
    tool: "awarderProcurement",
    domain: "fiscal",
    kind: "scalar",
    title: bg
      ? "Не открих такъв възложител в данните за поръчки"
      : "No such procurement buyer found",
    viz: "none",
    facts: { query: raw },
    provenance: ["db:procurement-search"],
  });

  if (!eik) return notFound();

  const a = await fetchDb<AwarderRollup>("awarder-procurement", { eik });
  if (!a) return notFound();
  name = name ?? a.name;
  const suppliers = [...(a.byContractor ?? [])]
    .sort((x, y) => y.totalEur - x.totalEur)
    .slice(0, 8);
  const years = [...(a.byYear ?? [])].sort((x, y) =>
    x.year.localeCompare(y.year),
  );
  const span =
    years.length > 0 ? `${years[0].year}–${years[years.length - 1].year}` : "—";
  const rows: Row[] = suppliers.map((s) => ({
    supplier: s.name,
    amount: fmtEurCompact(s.totalEur, ctx.lang),
  }));
  return {
    tool: "awarderProcurement",
    domain: "fiscal",
    kind: "table",
    title: bg ? `Обществени поръчки — ${name}` : `Public procurement — ${name}`,
    subtitle: bg
      ? "Като възложител: най-големи изпълнители (АОП / ЦАИС ЕОП)"
      : "As a buyer: largest suppliers (AOP / CAIS EOP)",
    columns: [
      { key: "supplier", label: bg ? "Изпълнител" : "Supplier" },
      { key: "amount", label: bg ? "Стойност" : "Value", numeric: true },
    ],
    rows,
    viz: "none",
    facts: {
      buyer: name,
      eik,
      total_value: fmtEurCompact(a.totalEur, ctx.lang),
      contracts: fmtInt(a.contractCount, ctx.lang),
      suppliers: (a.byContractor ?? []).length,
      years: span,
      top_supplier: suppliers[0]?.name ?? "—",
    },
    provenance: ["db:procurement-search", "db:awarder-procurement"],
  };
};

// ---- "how normal is this procurement?" --------------------------------------
// The chat analog of the ContractNormalcyPanel: positions one signed contract in
// the distribution of similar procurements (value, bidders, procedure,
// concentration). Descriptive, not a verdict — same verdict logic as the panel
// (@/lib/normalcy), so the number the chat says matches the strip the page draws.
//
// Local payload type (the tools layer never imports @/data React-Query hooks —
// they bundle i18next); structurally identical to ContractNormalcy in
// src/data/procurement/useContractNormalcy.ts, which is what @/lib/normalcy reads.
type NmMetric = {
  dir: "low" | "high" | "neutral";
  value: number;
  n: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  percentile: number;
};
type NormalcyPayload = {
  key: string;
  cohort: {
    division: string;
    cpvPrefix: string;
    cpvLen: number;
    n: number;
    yearFrom: string;
    yearTo: string;
    sufficient: boolean;
  } | null;
  value: NmMetric | null;
  bidders: (NmMetric & { singleShare: number; singleBidder: boolean }) | null;
  procedure: {
    bucket: string;
    isOpen: boolean;
    openShare: number;
    n: number;
  } | null;
  concentration: {
    dir: "high";
    value: number;
    peerN: number;
    median: number;
    p75: number;
    p90: number;
    percentile: number;
  } | null;
};

export const procurementNormalcy = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const key = String(args.key ?? args.contract ?? args.id ?? "").match(
    /[0-9a-f]{12}/,
  )?.[0];
  if (!key)
    return {
      tool: "procurementNormalcy",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Нужен е валиден идентификатор на договор (12 знака)"
        : "A valid 12-character contract id is required",
      viz: "none",
      facts: { key: String(args.key ?? args.contract ?? "") },
      provenance: ["db:procurement-normalcy"],
    };

  const n = await fetchDb<NormalcyPayload | null>("procurement-normalcy", {
    key,
  });
  if (!n || (!n.cohort && !n.concentration))
    return {
      tool: "procurementNormalcy",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Няма достатъчно сходни поръчки за сравнение"
        : "Not enough similar procurements to compare",
      viz: "none",
      facts: { key },
      provenance: ["db:procurement-normalcy"],
    };

  // A directional metric (bidders / concentration) is binary: a risk-tail
  // deviation reads "необичайно", otherwise "типично" — same as the panel chip.
  const dirLabel = (v: { level: string; isRiskDeviation: boolean }): string =>
    v.level === "insufficient"
      ? bg
        ? "малка извадка"
        : "small sample"
      : v.isRiskDeviation
        ? bg
          ? "необичайно"
          : "unusual"
        : bg
          ? "типично"
          : "typical";
  // The neutral value is positioned, not judged: usual / higher / lower, with a
  // "много" tier so a strong outlier doesn't read as a mild one.
  const neutralLabel = (p: number, cnt: number): string =>
    cnt < NORMALCY_MIN_N
      ? bg
        ? "малка извадка"
        : "small sample"
      : p >= 0.9
        ? bg
          ? "много по-висока"
          : "much higher"
        : p > 0.75
          ? bg
            ? "по-висока"
            : "higher"
          : p <= 0.1
            ? bg
              ? "много по-ниска"
              : "much lower"
            : p < 0.25
              ? bg
                ? "по-ниска"
                : "lower"
              : bg
                ? "в нормите"
                : "in range";
  const posText = (p: number) => fmtPct(Math.round(p * 100), ctx.lang);
  // Shares are often well under 1% — widen precision so a big buyer's tiny
  // median share doesn't read as a broken "0%".
  const shareText = (p: number): string =>
    p <= 0
      ? fmtPct(0, ctx.lang)
      : p < 0.0001
        ? bg
          ? "<0,01%"
          : "<0.01%"
        : fmtPct(Number((p * 100).toFixed(p < 0.01 ? 2 : 1)), ctx.lang);

  const rows: Row[] = [];
  if (n.value) {
    rows.push({
      metric: bg ? "Стойност" : "Value",
      value: fmtEurCompact(n.value.value, ctx.lang),
      median: fmtEurCompact(n.value.median, ctx.lang),
      position: posText(n.value.percentile),
      verdict: neutralLabel(n.value.percentile, n.value.n),
    });
  }
  if (n.bidders) {
    const v = normalcyVerdict(n.bidders.percentile, "low", n.bidders.n);
    rows.push({
      metric: bg ? "Брой оферти" : "Bids",
      value: fmtInt(n.bidders.value, ctx.lang),
      median: fmtInt(Math.round(n.bidders.median), ctx.lang),
      position: posText(n.bidders.percentile),
      verdict: dirLabel(v),
    });
  }
  // Same n>=NORMALCY_MIN_N gate + deviation rule as the panel and the summary,
  // via the shared helpers — otherwise the row could contradict the summary line.
  if (n.procedure && procedureEvaluable(n.procedure)) {
    rows.push({
      metric: bg ? "Вид процедура" : "Procedure",
      value: procedureLabel(n.procedure.bucket as ProcedureBucket, ctx.lang),
      median: `${Math.round(n.procedure.openShare * 100)}% ${bg ? "открити" : "open"}`,
      position: "—",
      verdict: procedureIsDeviation(n.procedure)
        ? bg
          ? "необичайно"
          : "unusual"
        : bg
          ? "типично"
          : "typical",
    });
  }
  if (n.concentration) {
    const v = normalcyVerdict(
      n.concentration.percentile,
      "high",
      n.concentration.peerN,
    );
    rows.push({
      metric: bg ? "Дял при възложителя" : "Share of this buyer",
      value: shareText(n.concentration.value),
      median: shareText(n.concentration.median),
      position: posText(n.concentration.percentile),
      verdict: dirLabel(v),
    });
  }

  const { deviations, evaluated } = normalcyDeviationSummary(n);
  const cohort = n.cohort;
  return {
    tool: "procurementNormalcy",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Колко типична е тази поръчка?"
      : "How typical is this procurement?",
    subtitle: cohort
      ? bg
        ? `Сравнено с ${fmtInt(cohort.n, ctx.lang)} сходни · CPV ${cohort.cpvPrefix} · ${cohort.yearFrom}–${cohort.yearTo}`
        : `Compared with ${fmtInt(cohort.n, ctx.lang)} similar · CPV ${cohort.cpvPrefix} · ${cohort.yearFrom}–${cohort.yearTo}`
      : undefined,
    columns: [
      { key: "metric", label: bg ? "Показател" : "Metric" },
      { key: "value", label: bg ? "Тази поръчка" : "This contract" },
      { key: "median", label: bg ? "Медиана" : "Median" },
      { key: "position", label: bg ? "Позиция" : "Position" },
      { key: "verdict", label: bg ? "Оценка" : "Verdict" },
    ],
    rows,
    viz: "none",
    facts: {
      key,
      deviations: `${deviations}/${evaluated}`,
      ...(cohort ? { cohort_cpv: cohort.cpvPrefix, cohort_n: cohort.n } : {}),
      ...(n.bidders
        ? {
            bidders: n.bidders.value,
            single_bidder: n.bidders.singleBidder
              ? bg
                ? "да"
                : "yes"
              : bg
                ? "не"
                : "no",
          }
        : {}),
      summary:
        deviations > 0
          ? bg
            ? `${deviations} от ${evaluated} показателя за конкуренция се отклоняват`
            : `${deviations} of ${evaluated} competition indicators deviate`
          : bg
            ? "без сигнали за по-слаба конкуренция"
            : "no weaker-competition signals",
    },
    provenance: ["db:procurement-normalcy"],
  };
};

// ---- АПИ road spending ------------------------------------------------------
// The chat analog of the /procurement/roads dashboard: reuses the same
// roadAttributes engine over АПИ's per-contract rows to answer roads-specific
// questions (kind-of-work mix + per-market competition, top corridors, headline
// integrity) that the generic awarderProcurement can't.

// Lowercased for in-sentence narration; the canonical Title-Case map is shared
// with the dashboard tiles in @/lib/roadAttributes (one source of truth).
const compLabel = (c: WorkComponent, bg: boolean): string =>
  (bg ? COMPONENT_LABEL[c].bg : COMPONENT_LABEL[c].en).toLowerCase();
const pctStr = (v: number | undefined): string =>
  v == null ? "—" : Math.round(v * 100) + "%";

export const roadsSpending = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  // Every АПИ contract row (the road model input) + the canonical awarder rollup,
  // both from Postgres — the same routes the /awarder/:eik page uses. Headline
  // total + count come from the rollup so the chat answer matches the dashboard
  // KPI exactly (the rollup is the canonical multi-currency headline); the model
  // drives the per-component breakdown + competition signals below.
  const [file, rollup] = await Promise.all([
    fetchDb<{
      contracts: Parameters<typeof buildRoadsModel>[0];
    }>("awarder-contracts", { eik: API_EIK }),
    fetchDb<AwarderRollup>("awarder-procurement", { eik: API_EIK }),
  ]);
  const m = buildRoadsModel(file.contracts);

  const comps = m.components.filter((c) => c.totalEur > 0).slice(0, 7);
  const rows: Row[] = comps.map((c) => ({
    work: compLabel(c.component, bg),
    amount: fmtEurCompact(c.totalEur, ctx.lang),
    single_bid: pctStr(c.singleBidShare),
  }));

  const topCorr = m.corridors[0];
  const peak = [...m.years].sort((a, b) => b.totalEur - a.totalEur)[0];
  const topCon = m.topContractors[0];
  // The strongest capture signal: a recurring-commodity component near 100%
  // single-bid (markings / barriers).
  const captured = [...m.components]
    .filter((c) => c.contractCount >= 3 && (c.singleBidShare ?? 0) >= 0.8)
    .sort((a, b) => (b.singleBidShare ?? 0) - (a.singleBidShare ?? 0))[0];

  return {
    tool: "roadsSpending",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? 'Пътна инфраструктура — Агенция "Пътна инфраструктура" (АПИ)'
      : "Road infrastructure — Road Infrastructure Agency (АПИ)",
    subtitle: bg
      ? "Обществени поръчки по вид работа + конкуренция (АОП)"
      : "Procurement by kind of work + competition (AOP)",
    columns: [
      { key: "work", label: bg ? "Вид работа" : "Kind of work" },
      { key: "amount", label: bg ? "Стойност" : "Value", numeric: true },
      {
        key: "single_bid",
        label: bg ? "Една оферта" : "Single bid",
        numeric: true,
      },
    ],
    rows,
    viz: "none",
    facts: {
      total_value: fmtEurCompact(rollup.totalEur, ctx.lang),
      contracts: fmtInt(rollup.contractCount, ctx.lang),
      single_bid_share: pctStr(m.singleBidShare),
      direct_award_share: pctStr(m.directShare),
      top_corridor: topCorr
        ? `${topCorr.corridor} (${fmtEurCompact(topCorr.totalEur, ctx.lang)})`
        : "—",
      peak_year: peak
        ? `${peak.year} (${fmtEurCompact(peak.totalEur, ctx.lang)})`
        : "—",
      top_contractor: topCon
        ? `${topCon.name} (${fmtEurCompact(topCon.totalEur, ctx.lang)})`
        : "—",
      most_captured_work: captured
        ? `${compLabel(captured.component, bg)} (${pctStr(captured.singleBidShare)} ${bg ? "една оферта" : "single bid"})`
        : "—",
    },
    provenance: ["db:awarder-procurement", "db:awarder-contracts"],
  };
};

// ---- revenue breakdown (where the tax money comes from) ---------------------
// Itemises the revenue side from the non-KFP sources: customs-collected (excise
// by product + import VAT + duties; Митническа хроника), domestic VAT by sector
// (НАП), or PIT by income type (НАП). category arg picks the slice.

type RevLine = {
  id: string;
  labelBg: string;
  labelEn: string;
  amountEur: number;
  parent: string | null;
  share?: number;
};
type VatSector = { labelBg: string; labelEn: string; declaredNetEur: number };

const fetchFirstYear = async <T>(paths: string[]): Promise<T | null> => {
  for (const p of paths) {
    try {
      return await fetchData<T>(p);
    } catch {
      /* try the next year */
    }
  }
  return null;
};

export const revenueBreakdown = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const lbl = (l: { labelBg: string; labelEn: string }) =>
    bg ? l.labelBg : l.labelEn;
  const q = `${args.category ?? ""} ${args.metric ?? ""}`.toLowerCase();
  const yr = args.year ? String(args.year) : "";
  const cand = (base: string): string[] =>
    (yr ? [yr] : [])
      .concat(["2026", "2025", "2024", "2023", "2022"])
      .map((y) => `/budget/revenue_breakdown/${base}/${y}.json`);

  // domestic VAT by economic sector (НАП)
  if (/ддс|vat/.test(q) && !/внос|import/.test(q)) {
    const d = await fetchFirstYear<{
      fiscalYear: number;
      sectors: VatSector[];
      declaredNetEur: number;
    }>(cand("vat"));
    if (d) {
      const top = [...d.sectors]
        .sort((a, b) => b.declaredNetEur - a.declaredNetEur)
        .slice(0, 10);
      return {
        tool: "revenueBreakdown",
        domain: "fiscal",
        kind: "table",
        title: bg
          ? `Деклариран нетен ДДС по сектор (${d.fiscalYear})`
          : `Declared net VAT by sector (${d.fiscalYear})`,
        subtitle: bg ? "Източник: НАП" : "Source: NRA",
        columns: [
          { key: "sector", label: bg ? "Сектор" : "Sector" },
          { key: "net", label: bg ? "Нетен ДДС" : "Net VAT", numeric: true },
        ],
        rows: top.map((s) => ({
          sector: lbl(s),
          net: fmtEurCompact(s.declaredNetEur, ctx.lang),
        })),
        viz: "none",
        facts: {
          year: d.fiscalYear,
          total_net: fmtEurCompact(d.declaredNetEur, ctx.lang),
          top_sector: top[0] ? lbl(top[0]) : "—",
        },
        provenance: [`budget/revenue_breakdown/vat/${d.fiscalYear}.json`],
      };
    }
  }

  // personal income tax by income type (НАП)
  if (/ддфл|подоходен|данък.*доход|income tax|\bpit\b/.test(q)) {
    const d = await fetchFirstYear<{
      fiscalYear: number;
      lines: RevLine[];
      totalEur: number;
    }>(cand("pit"));
    if (d) {
      const top = d.lines
        .filter((l) => l.parent === null)
        .sort((a, b) => b.amountEur - a.amountEur);
      return {
        tool: "revenueBreakdown",
        domain: "fiscal",
        kind: "table",
        title: bg
          ? `ДДФЛ по вид доход (${d.fiscalYear})`
          : `Personal income tax by income type (${d.fiscalYear})`,
        subtitle: bg ? "Източник: НАП" : "Source: NRA",
        columns: [
          { key: "type", label: bg ? "Вид доход" : "Income type" },
          { key: "amount", label: bg ? "Сума" : "Amount", numeric: true },
        ],
        rows: top.map((l) => ({
          type: lbl(l),
          amount: fmtEurCompact(l.amountEur, ctx.lang),
        })),
        viz: "none",
        facts: {
          year: d.fiscalYear,
          total: fmtEurCompact(d.totalEur, ctx.lang),
          top_type: top[0] ? lbl(top[0]) : "—",
        },
        provenance: [`budget/revenue_breakdown/pit/${d.fiscalYear}.json`],
      };
    }
  }

  // default: customs-collected revenue (excise + import VAT + duties)
  const d = await fetchFirstYear<{ fiscalYear: number; lines: RevLine[] }>(
    cand("customs"),
  );
  if (!d) {
    return {
      tool: "revenueBreakdown",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Няма данни за приходите" : "No revenue-breakdown data",
      viz: "none",
      facts: {},
      provenance: ["budget/revenue_breakdown/"],
    };
  }
  const want = new Set([
    "excise_total",
    "excise_fuels",
    "excise_tobacco",
    "excise_alcohol",
    "import_vat_total",
    "customs_duties_total",
  ]);
  const lines = d.lines.filter((l) => want.has(l.id));
  const excise = d.lines.find((l) => l.id === "excise_total");
  return {
    tool: "revenueBreakdown",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Митнически приходи — структура (${d.fiscalYear})`
      : `Customs-collected revenue — breakdown (${d.fiscalYear})`,
    subtitle: bg
      ? "Акциз, ДДС при внос и мита (Митническа хроника)"
      : "Excise, import VAT and customs duties (Customs Chronicle)",
    columns: [
      { key: "line", label: bg ? "Перо" : "Item" },
      { key: "amount", label: bg ? "Сума" : "Amount", numeric: true },
      { key: "share", label: "%", numeric: true, format: "pct" },
    ],
    rows: lines.map((l) => ({
      line: lbl(l),
      amount: fmtEurCompact(l.amountEur, ctx.lang),
      share: l.share != null ? round2(l.share * 100) : 0,
    })),
    viz: "none",
    facts: {
      year: d.fiscalYear,
      excise: excise ? fmtEurCompact(excise.amountEur, ctx.lang) : "—",
      import_vat: (() => {
        const v = d.lines.find((l) => l.id === "import_vat_total");
        return v ? fmtEurCompact(v.amountEur, ctx.lang) : "—";
      })(),
    },
    provenance: [`budget/revenue_breakdown/customs/${d.fiscalYear}.json`],
  };
};

// ---- EU-funds project register (contract grain) -----------------------------
// fundsOverview reads the beneficiary rollup; this reads funds/projects/ — the
// ~81k-contract register with absorption (paid/contracted) + top programmes.

type FundsProgram = {
  programName: string;
  rollup: { totalEur: number; paidEur: number; contractCount: number };
};
type FundsProjIndex = {
  totals: {
    contractCount: number;
    beneficiaryCount: number;
    totalEur: number;
    paidEur: number;
  };
  byProgram: FundsProgram[];
};

export const fundsProjects = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const d = await fetchDb<FundsProjIndex>("fund-payload", {
    kind: "projects-index",
  });
  const top = [...d.byProgram]
    .sort((a, b) => b.rollup.totalEur - a.rollup.totalEur)
    .slice(0, 8);
  const pct = (paid: number, tot: number) =>
    tot > 0 ? Math.round((100 * paid) / tot) : 0;
  return {
    tool: "fundsProjects",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Европейски средства — проекти по програма (ИСУН)"
      : "EU funds — projects by programme (ISUN)",
    subtitle: bg
      ? "Договорено и реално изплатено (усвояване)"
      : "Contracted vs actually paid (absorption)",
    columns: [
      { key: "program", label: bg ? "Програма" : "Programme" },
      {
        key: "contracted",
        label: bg ? "Договорено" : "Contracted",
        numeric: true,
      },
      { key: "absorbed", label: bg ? "Усвоено" : "Absorbed", numeric: true },
    ],
    rows: top.map((p) => ({
      program: p.programName,
      contracted: fmtEurCompact(p.rollup.totalEur, ctx.lang),
      absorbed: `${pct(p.rollup.paidEur, p.rollup.totalEur)}%`,
    })),
    viz: "none",
    facts: {
      contracts: fmtInt(d.totals.contractCount, ctx.lang),
      beneficiaries: fmtInt(d.totals.beneficiaryCount, ctx.lang),
      contracted: fmtEurCompact(d.totals.totalEur, ctx.lang),
      paid: fmtEurCompact(d.totals.paidEur, ctx.lang),
      absorbed: `${pct(d.totals.paidEur, d.totals.totalEur)}%`,
      top_programme: top[0]?.programName ?? "—",
    },
    provenance: ["db:fund-payload (ИСУН projects-index)"],
  };
};

// ---- state -> municipality transfers (Art. 53 of the State Budget Law) ------

type TransferCat = { amountEur: number };
type TransferTotals = {
  fiscalYear: number;
  totals: Record<string, TransferCat>;
};
type TransfersIndex = {
  years: {
    fiscalYear: number;
    grandTotalEur: number;
    municipalityCount: number;
  }[];
};
const TRANSFER_LABEL: Record<string, { bg: string; en: string }> = {
  delegated: {
    bg: "Делегирани държавни дейности",
    en: "Delegated state activities",
  },
  equalization: { bg: "Изравнителна субсидия", en: "Equalization subsidy" },
  capital: { bg: "Целева капиталова субсидия", en: "Capital subsidy" },
  winter: { bg: "Зимно поддържане на пътища", en: "Winter road maintenance" },
  otherTargeted: {
    bg: "Други целеви трансфери",
    en: "Other targeted transfers",
  },
};

export const municipalTransfers = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const idx = await fetchData<TransfersIndex>(
    "/budget/municipal_transfers/index.json",
  );
  const years = idx.years.map((y) => y.fiscalYear).sort((a, b) => a - b);
  const reqd = args.year ? Number(args.year) : NaN;
  const year = years.includes(reqd) ? reqd : years[years.length - 1];
  const meta = idx.years.find((y) => y.fiscalYear === year);
  const t = await fetchData<TransferTotals>(
    `/budget/municipal_transfers/${year}/totals.json`,
  );
  const rows0 = Object.entries(t.totals)
    .map(([k, v]) => ({
      label: (TRANSFER_LABEL[k] ?? { bg: k, en: k })[ctx.lang],
      v: v.amountEur,
    }))
    .sort((a, b) => b.v - a.v);
  return {
    tool: "municipalTransfers",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Трансфери държава → общини (${year})`
      : `State → municipality transfers (${year})`,
    subtitle: bg
      ? "По вид трансфер (Чл. 53 ЗДБРБ)"
      : "By transfer type (Art. 53 of the State Budget Law)",
    columns: [
      { key: "category", label: bg ? "Вид" : "Type" },
      { key: "amount", label: bg ? "Сума" : "Amount", numeric: true },
    ],
    rows: rows0.map((r) => ({
      category: r.label,
      amount: fmtEurCompact(r.v, ctx.lang),
    })),
    viz: "none",
    facts: {
      year,
      total: meta ? fmtEurCompact(meta.grandTotalEur, ctx.lang) : "—",
      municipalities: meta?.municipalityCount ?? 265,
      biggest: rows0[0]?.label ?? "—",
    },
    provenance: [`budget/municipal_transfers/${year}/totals.json`],
  };
};

// ---- tenders (procedures, not signed contracts) -----------------------------
// Postgres-backed (the tenders corpus lives in the `tenders` table). Values here
// are ESTIMATED (прогнозна стойност) — a forecast, NOT money spent — so every
// surface labels them as such. Answers "what is X's biggest open tender", "open
// поръчка за …", which the contracts-only corpus could not.
//
// Two DB seams: the corpus search (topic / keyword / year) → tender-corpus-search
// (regex + full-set aggregates the capped table route can't give); the buyer /
// keyword / largest browse → the generic `table` route (resource "tenders").

// One row of the tenders `table` engine / the corpus-search rows (camelCased).
type TenderTableRow = {
  unp: string;
  ocid?: string;
  buyerEik?: string;
  buyerName: string;
  subject: string;
  estimatedValueEur?: number;
  lotsCount?: number;
  isCancelled: boolean;
};
type TendersTablePage = {
  rows: TenderTableRow[];
  total: number;
  aggregates?: { sumEstimatedValueEur?: number; count?: number };
};
// tender-corpus-search payload — matched top-N + full-set aggregates.
type TenderCorpusResult = {
  year: number | null;
  yearRequested: number | null;
  yearMissing: boolean;
  matches: number;
  totalEur: number;
  cancelled: number;
  biggest: { subject: string; estimatedValueEur?: number } | null;
  rows: TenderTableRow[];
};

const forecastNote = (lang: ToolContext["lang"]): string =>
  lang === "bg"
    ? "Прогнозни (обявени) стойности — не са похарчени средства."
    : "Estimated (announced) values — a forecast, not money spent.";

const shortTenderSubject = (s: string): string =>
  s.replace(/^[„"'\s]+/, "").slice(0, 60);

const tenderStatusLabel = (
  t: { isCancelled: boolean },
  lang: ToolContext["lang"],
): string =>
  t.isCancelled
    ? lang === "bg"
      ? "прекратена"
      : "cancelled"
    : lang === "bg"
      ? "обявена"
      : "announced";

// List the biggest tenders, optionally narrowed to one buyer (`org`) or a free
// keyword (`query`). Defaults to the largest non-cancelled procedures.
const TENDER_COLUMNS = (bg: boolean): Column[] => [
  { key: "buyer", label: bg ? "Възложител" : "Buyer" },
  { key: "subject", label: bg ? "Предмет" : "Subject" },
  { key: "estimate", label: bg ? "Прогнозна ст." : "Estimated", numeric: true },
  { key: "lots", label: bg ? "Обос. позиции" : "Lots", numeric: true },
  { key: "status", label: bg ? "Статус" : "Status" },
];
const tenderRow = (t: TenderTableRow, ctx: ToolContext): Row => ({
  buyer: t.buyerName,
  subject: shortTenderSubject(t.subject),
  estimate:
    t.estimatedValueEur != null
      ? fmtEurCompact(t.estimatedValueEur, ctx.lang)
      : "—",
  lots: t.lotsCount ?? 1,
  status: tenderStatusLabel(t, ctx.lang),
});
// One tenders `table` request (top-N by estimate + count + Σ estimate) over the
// given column filters.
const tendersTable = (
  columns: Array<Record<string, unknown>>,
  pageSize = 10,
): Promise<TendersTablePage> =>
  fetchDb<TendersTablePage>("table", {
    q: JSON.stringify({
      resource: "tenders",
      page: 0,
      pageSize,
      sort: [{ id: "estimated_value_eur", desc: true }],
      filters: { columns },
    }),
  });

export const openTenders = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const org = String(args.org ?? args.place ?? "").trim();
  const query = String(args.query ?? args.subject ?? args.metric ?? "").trim();

  // --- corpus search (topic / keyword / year, full corpus) -------------------
  // Triggered by a topic (alias or auto-detected), an explicit year, or a
  // substantive free keyword. Answers "всички търгове за X през 2025" — the
  // largest-N browse below can't (it only ranks by value). Served by
  // tender-corpus-search: the SAME topic-match semantics (subject/CPV regex OR
  // exact-CPV membership) the year-shard JSON drove, with full-set aggregates.
  const rawAll = `${org} ${query} ${String(args.unp ?? "")}`.trim();
  const topic =
    topicBySlug(typeof args.topic === "string" ? args.topic : undefined) ??
    detectTopic(rawAll);
  const yearAsked =
    String(args.year ?? "").match(/\b(20\d\d)\b/)?.[1] ??
    rawAll.match(/\b(20\d\d)\b/)?.[1];
  // keyword = the free query minus a year token (so "асфалт 2024" → "асфалт").
  const keyword = query
    .replace(/\b20\d\d\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const corpusIntent = !!topic || !!yearAsked || (!org && keyword.length >= 3);

  if (corpusIntent) {
    // Extra buyer filter: when `org` carries a real institution name AND it
    // wasn't just the topic trigger (matches the old orgTokens narrowing).
    const orgTokens =
      org && (topic || keyword)
        ? cleanAwarderQuery(org)
            .split(/\s+/)
            .filter((w) => w.length >= 4)
        : [];
    const res = await fetchDb<TenderCorpusResult>("tender-corpus-search", {
      year: yearAsked ?? "",
      cpv: topic ? topic.cpv.join(",") : "",
      pattern: topic ? topic.pattern.source : "",
      keyword: topic ? "" : keyword,
      buyerTokens: orgTokens.join(","),
    });
    const year = res.year;
    const scopeLabel = topic
      ? topic.label[ctx.lang]
      : keyword || (bg ? "всички" : "all");
    const top = res.biggest;
    return {
      tool: "openTenders",
      domain: "fiscal",
      kind: "table",
      title: bg
        ? `Обявени поръчки — ${scopeLabel} (${year})`
        : `Tenders — ${scopeLabel} (${year})`,
      subtitle: res.yearMissing
        ? bg
          ? `Няма данни за ${yearAsked}; показана е ${year}. ${forecastNote(ctx.lang)}`
          : `No data for ${yearAsked}; showing ${year}. ${forecastNote(ctx.lang)}`
        : forecastNote(ctx.lang),
      columns: TENDER_COLUMNS(bg),
      rows: res.rows.map((r) => tenderRow(r, ctx)),
      viz: "none",
      facts: {
        scope: scopeLabel,
        year: year ?? "—",
        matches: res.matches,
        total_estimated: fmtEurCompact(res.totalEur, ctx.lang),
        cancelled: res.cancelled,
        biggest: top ? shortTenderSubject(top.subject) : "—",
        biggest_estimate:
          top?.estimatedValueEur != null
            ? fmtEurCompact(top.estimatedValueEur, ctx.lang)
            : "—",
        value_type: bg ? "прогнозна (forecast)" : "estimated (forecast)",
        // Hidden link facts → /procurement/tenders deep link (see links.ts).
        ...(topic
          ? { link_topic: topic.slug }
          : keyword
            ? { link_q: keyword }
            : {}),
      },
      provenance: ["db:tender-corpus-search"],
    };
  }

  // --- largest / buyer / keyword browse (all years) → tenders `table` route ---
  const baseCols: Array<Record<string, unknown>> = [];
  let scopeTitle = bg
    ? "Най-големи обявени поръчки"
    : "Largest announced tenders";
  let scopeFact = bg ? "всички" : "all";
  let linkQ: string | undefined;
  let scoped = false;
  if (org) {
    const eikInRaw = org.match(/\b\d{9,13}\b/)?.[0];
    if (eikInRaw) baseCols.push({ id: "buyer_eik", value: eikInRaw });
    else baseCols.push({ id: "buyer_name", value: cleanAwarderQuery(org) });
    scoped = true;
  } else if (query) {
    baseCols.push({ id: "subject", value: query });
    scopeTitle = bg ? `Обявени поръчки — „${query}“` : `Tenders — "${query}"`;
    scopeFact = query;
    linkQ = query;
  }

  // The largest-overall default excludes cancelled procedures (as the old index
  // pool did); a scoped/keyword browse keeps them and reports the cancelled count.
  const mainCols =
    scoped || query ? baseCols : [{ id: "is_cancelled", value: false }];
  const [page, cancelledPage] = await Promise.all([
    tendersTable(mainCols, 10),
    scoped || query
      ? tendersTable([...baseCols, { id: "is_cancelled", value: true }], 1)
      : Promise.resolve<TendersTablePage>({ rows: [], total: 0 }),
  ]);

  const biggest = page.rows[0];
  if (org && scoped) {
    const label = biggest?.buyerName ?? org;
    scopeTitle = bg
      ? `Най-големи поръчки — ${label}`
      : `Largest tenders — ${label}`;
    scopeFact = label;
    linkQ = label;
  }

  return {
    tool: "openTenders",
    domain: "fiscal",
    kind: "table",
    title: scopeTitle,
    subtitle: forecastNote(ctx.lang),
    columns: TENDER_COLUMNS(bg),
    rows: page.rows.map((t) => tenderRow(t, ctx)),
    viz: "none",
    facts: {
      scope: scopeFact,
      matches: page.total,
      cancelled: cancelledPage.total,
      biggest: biggest ? shortTenderSubject(biggest.subject) : "—",
      biggest_estimate:
        biggest?.estimatedValueEur != null
          ? fmtEurCompact(biggest.estimatedValueEur, ctx.lang)
          : "—",
      ...(scoped
        ? { buyer_total_procedures: fmtInt(page.total, ctx.lang) }
        : {}),
      value_type: bg ? "прогнозна (forecast)" : "estimated (forecast)",
      // Hidden link fact → /procurement/tenders search pre-filtered to the same
      // keyword / buyer (the FE search matches subject AND buyer name).
      ...(linkQ ? { link_q: linkQ } : {}),
    },
    provenance: ["db:table/tenders"],
  };
};

// Look up one procedure by УНП (e.g. 00044-2025-0125) or by the best keyword
// match among the largest procedures. Returns the estimate, lot structure,
// status and the ocid lineage back to a signed contract.
// Subset of the tender_detail (FE Tender) shape this tool renders.
type TenderDetail = {
  unp: string;
  ocid?: string;
  buyerName: string;
  subject: string;
  estimatedValueEur?: number;
  lotsCount?: number;
  isCancelled: boolean;
  publicationDate: string;
};

export const tenderLookup = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const raw = String(
    args.unp ?? args.query ?? args.subject ?? args.metric ?? "",
  ).trim();
  const unp = raw.match(/\b(\d{5}-\d{4}-\d{4}|T\d{5,})\b/i)?.[0];

  let t: TenderDetail | undefined;
  if (unp) {
    // Exact procedure by УНП (tender_detail, 032) — the whole corpus, not a
    // top-N index. Also carries the ocid lineage back to any signed contract.
    const d = await fetchDb<{ tender: TenderDetail | null }>("tender", { unp });
    t = d.tender ?? undefined;
  } else if (raw.length >= 3) {
    // Keyword fallback — only reachable on the LLM tool-call path (the router
    // sends bare keywords to openTenders). Resolve the biggest matching subject
    // via the corpus search, then fetch its full detail.
    const res = await fetchDb<TenderCorpusResult>("tender-corpus-search", {
      keyword: raw,
    });
    const hitUnp = res.rows[0]?.unp;
    if (hitUnp) {
      const d = await fetchDb<{ tender: TenderDetail | null }>("tender", {
        unp: hitUnp,
      });
      t = d.tender ?? undefined;
    }
  }

  if (!t) {
    return {
      tool: "tenderLookup",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Не открих такава поръчка" : "No such tender",
      subtitle: bg
        ? "Проверете УНП-то на процедурата (напр. 00044-2025-0125)."
        : "Check the procedure's УНП (e.g. 00044-2025-0125).",
      viz: "none",
      facts: { query: raw || (unp ?? "") },
      provenance: ["db:tender"],
    };
  }

  return {
    tool: "tenderLookup",
    domain: "fiscal",
    kind: "scalar",
    title: shortTenderSubject(t.subject),
    subtitle: forecastNote(ctx.lang),
    viz: "none",
    facts: {
      unp: t.unp,
      buyer: t.buyerName,
      estimated_value:
        t.estimatedValueEur != null
          ? fmtEurCompact(t.estimatedValueEur, ctx.lang)
          : "—",
      lots: t.lotsCount ?? 1,
      status: tenderStatusLabel(t, ctx.lang),
      announced: t.publicationDate,
      procedure_id: t.ocid ?? t.unp,
      value_type: bg ? "прогнозна (forecast)" : "estimated (forecast)",
    },
    provenance: ["db:tender"],
  };
};

// КЗК procurement-appeals corpus summary — the AI surface for the appeal data
// joined onto the tender corpus (kzk-appeals-summary route = kzk_appeals_summary(),
// a Postgres port of build_kzk_summary.ts; the per-tender appeals live on
// /tenders/:unp). Answers "how many procurement appeals / how many upheld /
// which buyers get appealed most".
type KzkSummary = {
  totals: {
    complaints: number;
    resolvedToTender: number;
    withOutcome: number;
    upheld: number;
    rejected: number;
    suspended: number;
  };
  byYear: Record<string, number>;
  topBuyers: { eik: string; name: string; count: number; upheld: number }[];
};

// Generic org tokens that don't distinguish one buyer from another — dropped
// when matching a named awarder against the top-buyers list so a bare category
// word ("община") can't match every município, but a proper name ("Столична")
// still pins its buyer.
const KZK_GENERIC_TOKEN = new Set([
  "община",
  "общината",
  "общини",
  "район",
  "районна",
  "министерство",
  "министерството",
  "агенция",
  "дирекция",
  "държавно",
  "предприятие",
  "национална",
  "компания",
  "град",
  "гр",
  "на",
  "и",
  "за",
  "по",
  "еад",
  "ад",
  "оод",
  "еоод",
  "дп",
  "municipality",
  "ministry",
  "agency",
  "directorate",
  "national",
  "company",
  "the",
  "of",
]);

// Cyrillic→Latin transliteration so an English-typed proper noun ("Kozloduy")
// matches its Bulgarian buyer name ("КОЗЛОДУЙ") — the summary is Cyrillic-only.
// Shared `translitKey` (used per-token here, where its separator-collapse is a
// no-op) — avoids a second, drift-prone copy of the map in this directory.
const kzkTranslit = translitKey;

const kzkTokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-zа-яё0-9 ]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);

// Best top-buyer match for a named-awarder query, or null. Scores each buyer on
// how many of its DISTINCTIVE tokens (generic org words removed) the query names
// — both verbatim and transliterated. ONE matched distinctive token is enough
// (they're the proper-name part, so "Пловдив"/"Столична" pins the entity); the
// buyer with the most matches (fewest left over) wins the tie.
const matchTopBuyer = (
  query: string,
  buyers: KzkSummary["topBuyers"],
): KzkSummary["topBuyers"][number] | null => {
  const qtok = kzkTokens(query);
  // EN exonyms that transliteration can't bridge (sofia → софия ≠ столична). Map
  // them to the Cyrillic distinctive token the buyer name actually carries.
  const KZK_ALIAS: Record<string, string> = {
    sofia: "столична",
    sofiya: "столична",
    софия: "столична",
  };
  const qset = new Set([
    ...qtok,
    ...qtok.map(kzkTranslit),
    ...qtok.map((t) => KZK_ALIAS[t]).filter(Boolean),
  ]);
  let best: {
    b: KzkSummary["topBuyers"][number];
    matched: number;
    leftover: number;
  } | null = null;
  for (const b of buyers) {
    const distinctive = [
      ...new Set(
        kzkTokens(b.name).filter(
          (t) => t.length >= 2 && !KZK_GENERIC_TOKEN.has(t),
        ),
      ),
    ];
    if (!distinctive.length) continue;
    const matched = distinctive.filter(
      (t) => qset.has(t) || qset.has(kzkTranslit(t)),
    ).length;
    // Require at least HALF the buyer's distinctive tokens (matched*2 ≥ count),
    // not just one: "Столична" (1/1) and "Kozloduy"→АЕЦ Козлодуй (1/2) still pin,
    // but a bare stray token can't pin a longer name — e.g. "изток" alone (1/3)
    // no longer mis-pins «Мини Марица-изток», it falls through to the national
    // table. (The former "община Пловдив → район Източен" mislabel is resolved
    // upstream by the modal-name fix in build_kzk_summary.ts.) Best match = most
    // tokens matched, fewest left over.
    if (matched * 2 < distinctive.length) continue;
    const leftover = distinctive.length - matched;
    if (
      !best ||
      matched > best.matched ||
      (matched === best.matched && leftover < best.leftover)
    )
      best = { b, matched, leftover };
  }
  return best?.b ?? null;
};

// Shared caveat for every КЗК-appeals surface.
const kzkAppealsSubtitle = (bg: boolean): string =>
  bg
    ? "Обжалвания пред Комисията за защита на конкуренцията; „Уважени“ = отменено решение на възложителя (не доказателство за нарушение)"
    : "Appeals to the Competition Protection Commission; “Upheld” = the buyer's decision was annulled (not proof of wrongdoing)";

export const procurementAppeals = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const d = await fetchDb<KzkSummary>("kzk-appeals-summary");
  const t = d.totals;
  // Earliest year in the corpus — surfaced so the narration can date the totals
  // ("since 2020") instead of reading as all-time. Computed here (not in
  // narrate) to keep the exact-number invariant; also the one consumer of byYear.
  const sinceYearAll = Object.keys(d.byYear ?? {})
    .filter((y) => /^\d{4}$/.test(y))
    .sort()[0];

  // Buyer-scoped ask ("обжалваните поръчки на Столична община"): answer for that
  // one entity instead of the national table. The summary carries only the
  // top-25 most-appealed buyers, so a buyer outside it can't be quantified here —
  // say so honestly rather than falling back to the national list (FINDING-017).
  const awarder = String(args.awarder ?? "").trim();
  if (awarder) {
    const hit = matchTopBuyer(awarder, d.topBuyers);
    if (hit)
      return {
        tool: "procurementAppeals",
        domain: "fiscal",
        kind: "scalar",
        title: bg
          ? `Жалби пред КЗК — ${hit.name}`
          : `КЗК appeals — ${hit.name}`,
        subtitle: kzkAppealsSubtitle(bg),
        viz: "none",
        facts: {
          buyer: hit.name,
          appeals: fmtInt(hit.count, ctx.lang),
          upheld: fmtInt(hit.upheld, ctx.lang),
          total_complaints: fmtInt(t.complaints, ctx.lang),
          ...(sinceYearAll ? { since_year: sinceYearAll } : {}),
        },
        provenance: ["db:kzk-appeals-summary"],
      };
    // named, but not among the most-appealed buyers the summary tracks
    return {
      tool: "procurementAppeals",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Не е сред най-обжалваните възложители"
        : "Not among the most-appealed buyers",
      subtitle: kzkAppealsSubtitle(bg),
      viz: "none",
      facts: {
        buyer_query: awarder,
        most_appealed_buyer: d.topBuyers[0]?.name ?? "—",
        total_complaints: fmtInt(t.complaints, ctx.lang),
        // the cutoff lives in build_kzk_summary.ts (.slice(0, 25)); pass it so the
        // narration doesn't hard-code "top 25" and drift from the builder.
        tracked_buyers: fmtInt(d.topBuyers.length, ctx.lang),
        ...(sinceYearAll ? { since_year: sinceYearAll } : {}),
      },
      provenance: ["db:kzk-appeals-summary"],
    };
  }

  const n = Math.min(Math.max(Number(args.count) || 10, 1), 25);
  const rows: Row[] = d.topBuyers.slice(0, n).map((b) => ({
    buyer: b.name,
    appeals: b.count,
    upheld: b.upheld,
  }));
  return {
    tool: "procurementAppeals",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Жалби пред КЗК по обществени поръчки"
      : "КЗК procurement appeals",
    subtitle: kzkAppealsSubtitle(bg),
    columns: [
      { key: "buyer", label: bg ? "Възложител" : "Buyer" },
      {
        key: "appeals",
        label: bg ? "Жалби" : "Appeals",
        numeric: true,
        format: "int",
      },
      {
        key: "upheld",
        label: bg ? "Уважени" : "Upheld",
        numeric: true,
        format: "int",
      },
    ],
    rows,
    viz: "none",
    facts: {
      total_complaints: fmtInt(t.complaints, ctx.lang),
      resolved_to_tender: fmtInt(t.resolvedToTender, ctx.lang),
      with_outcome: fmtInt(t.withOutcome, ctx.lang),
      upheld: fmtInt(t.upheld, ctx.lang),
      rejected: fmtInt(t.rejected, ctx.lang),
      suspended: fmtInt(t.suspended, ctx.lang),
      most_appealed_buyer: d.topBuyers[0]?.name ?? "—",
      ...(sinceYearAll ? { since_year: sinceYearAll } : {}),
    },
    provenance: ["db:kzk-appeals-summary"],
  };
};

// Licensed excise-warehouse register (лицензирани складодържатели) — who holds a
// licence to store excise goods (fuels / tobacco / alcohol) under duty
// suspension, ranked by their public-procurement footprint. Reads the register
// snapshot ingested from the Агенция „Митници" BACIS endpoint. The file shape is
// the shared ExciseRegisterFile (single source of truth in customsReferenceData).
export const exciseRegister = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const d = await fetchData<ExciseRegisterFile>(
    "/customs/excise_register.json",
  );
  const CAT_LABEL: Record<string, { bg: string; en: string }> = {
    energy: { bg: "Горива и енергия", en: "Fuels & energy" },
    tobacco: { bg: "Тютюн", en: "Tobacco" },
    alcohol: { bg: "Алкохол", en: "Alcohol" },
    other: { bg: "Друго", en: "Other" },
  };
  const q = `${args.category ?? ""} ${args.metric ?? ""}`.toLowerCase();
  const wantCat: ExciseCategory | null =
    /горив|fuel|дизел|бензин|petrol|diesel|енерг|energy/.test(q)
      ? "energy"
      : /тютюн|tobacco|цигар|cigarette/.test(q)
        ? "tobacco"
        : /алкохол|alcohol|спирт|вино|wine|бира|beer/.test(q)
          ? "alcohol"
          : null;

  let ops = d.operators.filter((o) => o.active);
  if (wantCat) ops = ops.filter((o) => o.categories.includes(wantCat));
  const top = [...ops]
    .sort((a, b) => b.procurementEur - a.procurementEur)
    .slice(0, 10);

  return {
    tool: "exciseRegister",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? wantCat
        ? `Лицензирани складодържатели — ${CAT_LABEL[wantCat].bg}`
        : "Лицензирани акцизни складодържатели"
      : wantCat
        ? `Licensed warehouse keepers — ${CAT_LABEL[wantCat].en}`
        : "Licensed excise warehouse keepers",
    subtitle: bg
      ? `${ops.length} действащи · източник: Агенция „Митници“ (BACIS)`
      : `${ops.length} active · source: Customs Agency (BACIS)`,
    columns: [
      { key: "name", label: bg ? "Складодържател" : "Warehouse keeper" },
      { key: "cats", label: bg ? "Акцизни стоки" : "Excise goods" },
      {
        key: "proc",
        label: bg ? "Поръчки" : "Procurement",
        numeric: true,
      },
    ],
    rows: top.map((o) => ({
      name: o.name,
      cats: o.categories
        .map((c) => (bg ? CAT_LABEL[c].bg : CAT_LABEL[c].en))
        .join(", "),
      proc:
        o.procurementEur > 0 ? fmtEurCompact(o.procurementEur, ctx.lang) : "—",
    })),
    viz: "none",
    facts: {
      active_operators: d.activeOperators,
      shown: top.length,
      ...(wantCat ? { category: wantCat } : {}),
      top_operator: top[0]?.name ?? "—",
    },
    provenance: ["customs/excise_register.json"],
  };
};

// Where the bonded warehouses ARE — the geographic companion to exciseRegister.
// Answers "which cities have the most excise warehouses" / "how many данъчни
// складове in <city>" from the same geolocated corpus the /customs/warehouses map
// draws (Postgres excise_warehouses_map). One row per active warehouse, grouped by
// city; an optional `place` filter lists the operators warehousing in one town.
export const exciseWarehouses = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const d = await fetchDb<ExciseWarehouseMap>("excise-warehouses");
  const CAT_LABEL: Record<string, { bg: string; en: string }> = {
    energy: { bg: "Горива и енергия", en: "Fuels & energy" },
    tobacco: { bg: "Тютюн", en: "Tobacco" },
    alcohol: { bg: "Алкохол", en: "Alcohol" },
    other: { bg: "Друго", en: "Other" },
  };
  const q = `${args.category ?? ""} ${args.metric ?? ""}`.toLowerCase();
  const wantCat: ExciseCategory | null =
    /горив|fuel|дизел|бензин|petrol|diesel|енерг|energy/.test(q)
      ? "energy"
      : /тютюн|tobacco|цигар|cigarette/.test(q)
        ? "tobacco"
        : /алкохол|alcohol|спирт|вино|wine|бира|beer/.test(q)
          ? "alcohol"
          : null;

  let whs = d.warehouses;
  if (wantCat) whs = whs.filter((w) => w.category === wantCat);

  const catList = (cats: Map<string, number>): string =>
    [...cats.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${bg ? CAT_LABEL[c].bg : CAT_LABEL[c].en} ${n}`)
      .join(", ");

  // Optional city filter — "склад в Русе" / "warehouses in Ruse". Match the place
  // label loosely (it carries the "гр./с." prefix, so compare on the bare name).
  const placeQ = String(args.place ?? "")
    .toLowerCase()
    .replace(/^(гр\.|с\.|град|село)\s*/, "")
    .trim();
  const bareName = (place: string | null): string =>
    (place ?? "")
      .toLowerCase()
      .replace(/^(гр\.|с\.|град|село)\s*/, "")
      .trim();

  if (placeQ) {
    const inCity = whs.filter((w) => bareName(w.place).includes(placeQ));
    const cityLabel = inCity[0]?.place ?? String(args.place ?? "");
    const byCat = new Map<string, number>();
    for (const w of inCity)
      byCat.set(w.category, (byCat.get(w.category) ?? 0) + 1);
    return {
      tool: "exciseWarehouses",
      domain: "fiscal",
      kind: "table",
      title: bg
        ? `Данъчни складове — ${cityLabel}`
        : `Excise warehouses — ${cityLabel}`,
      subtitle: bg
        ? `${inCity.length} действащи склада · Агенция „Митници“ (BACIS)`
        : `${inCity.length} active warehouses · Customs Agency (BACIS)`,
      columns: [
        { key: "name", label: bg ? "Складодържател" : "Warehouse keeper" },
        { key: "cat", label: bg ? "Акцизни стоки" : "Excise goods" },
      ],
      rows: inCity
        .sort((a, b) => a.name.localeCompare(b.name, "bg"))
        .map((w) => ({
          name: w.name,
          cat: bg ? CAT_LABEL[w.category].bg : CAT_LABEL[w.category].en,
        })),
      viz: "none",
      facts: {
        place: cityLabel,
        warehouses: inCity.length,
        by_category: catList(byCat),
        ...(wantCat ? { category: wantCat } : {}),
      },
      provenance: ["db:excise-warehouses"],
    };
  }

  // Default: cities ranked by active-warehouse count (matches the map's markers).
  const byCity = new Map<
    string,
    { place: string; count: number; cats: Map<string, number> }
  >();
  for (const w of whs) {
    const key = w.loc.join(",");
    const g =
      byCity.get(key) ??
      byCity
        .set(key, { place: w.place ?? "—", count: 0, cats: new Map() })
        .get(key)!;
    g.count += 1;
    g.cats.set(w.category, (g.cats.get(w.category) ?? 0) + 1);
  }
  const cities = [...byCity.values()].sort((a, b) => b.count - a.count);
  const top = cities.slice(0, 12);

  return {
    tool: "exciseWarehouses",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? wantCat
        ? `Данъчни складове по градове — ${CAT_LABEL[wantCat].bg}`
        : "Данъчни складове по градове"
      : wantCat
        ? `Excise warehouses by city — ${CAT_LABEL[wantCat].en}`
        : "Excise warehouses by city",
    subtitle: bg
      ? `${whs.length} действащи склада в ${cities.length} града · Агенция „Митници“ (BACIS)`
      : `${whs.length} active warehouses across ${cities.length} cities · Customs Agency (BACIS)`,
    columns: [
      { key: "city", label: bg ? "Град" : "City" },
      { key: "count", label: bg ? "Складове" : "Warehouses", numeric: true },
      { key: "cats", label: bg ? "Категории" : "Categories" },
    ],
    rows: top.map((c) => ({
      city: c.place,
      count: c.count,
      cats: catList(c.cats),
    })),
    viz: "none",
    facts: {
      total_warehouses: whs.length,
      cities: cities.length,
      top_city: top[0]?.place ?? "—",
      top_city_count: top[0]?.count ?? 0,
      ...(wantCat ? { category: wantCat } : {}),
    },
    provenance: ["db:excise-warehouses"],
  };
};
