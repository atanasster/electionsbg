// Governance — fiscal tools (budget, COFOG, procurement, EU funds). All read
// headline index/rollup files; amounts are in EUR.

import { fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt } from "./format";
import { round2 } from "./dataset";
import { fuzzyBestMatch } from "./resolve";
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

type ProcIndex = {
  totals: {
    contracts: number;
    totalEur: number;
    contractorCount: number;
    awarderCount: number;
  };
  crossReference: { mpCount: number; totalEur: number };
  // Non-MP political class (cabinet, governors, mayors, councillors, …) tied to
  // contract winners. Absent on data generated before the officials join.
  officialsCrossReference?: { officialCount: number; totalEur: number };
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
      // Officials (non-MP political class) tied to contract winners — only when
      // the index carries the officials cross-reference.
      ...(p.officialsCrossReference
        ? {
            official_connected_value: fmtEurCompact(
              p.officialsCrossReference.totalEur,
              ctx.lang,
            ),
            official_connected_count: p.officialsCrossReference.officialCount,
          }
        : {}),
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
  const d = await fetchData<{ entries: ContractorEntry[] }>(
    "/procurement/derived/top_contractors.json",
  );
  const n = Math.min(Math.max(Number(args.count) || 12, 1), 25);
  const top = [...d.entries]
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
    provenance: ["procurement/derived/top_contractors.json"],
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
type DebarredRow = { debarredUntil: string };

export const procurementRedFlags = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  // Slim pre-selected feed (~28 KB) — not the full awarder_concentration.json.
  const feed = await fetchData<{ topConcentration: ConcentrationEntry[] }>(
    "/procurement/derived/risk_feed.json",
  );
  const deb = await fetchData<{ entries: DebarredRow[] }>(
    "/procurement/debarred.json",
  );
  const today = new Date().toISOString().slice(0, 10);
  const activeDebarred = deb.entries.filter(
    (d) => !d.debarredUntil || d.debarredUntil >= today,
  ).length;
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
    provenance: [
      "procurement/derived/risk_feed.json",
      "procurement/debarred.json",
    ],
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
  const f = await fetchData<CpvCompetitionFile>(
    "/procurement/derived/cpv_competition.json",
  );
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
    provenance: ["procurement/derived/cpv_competition.json"],
  };
};

// ---- debarred suppliers (черен списък) --------------------------------------
// The list behind procurementRedFlags' active_debarred count: the companies on
// the АОП "Стопански субекти с нарушения" register. Reads the merged snapshot
// (data/procurement/debarred.json), which retains historical entries the live
// page has dropped, so we filter to the still-active debarments.

type DebarredFull = {
  name: string;
  publishedAt: string;
  debarredUntil: string;
  detailsUrl: string | null;
};
type DebarredFileFull = {
  generatedAt: string;
  source: string;
  total: number;
  entries: DebarredFull[];
};

export const procurementDebarred = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<DebarredFileFull>("/procurement/debarred.json");
  const today = new Date().toISOString().slice(0, 10);
  const active = f.entries
    .filter((e) => !e.debarredUntil || e.debarredUntil >= today)
    .sort((a, b) =>
      (b.debarredUntil || "").localeCompare(a.debarredUntil || ""),
    );
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
      active_debarred: active.length,
      total_incl_historical: f.total,
    },
    provenance: ["procurement/debarred.json"],
  };
};

// ---- procurement to MP-connected companies (+ per-MP trend) -----------------
// The journalism payload: contracts going to firms a sitting MP owns or manages.
// A named MP returns a per-year value trend; otherwise the biggest MP↔contractor
// relationships across the chamber.

type MpProcYear = { year: string; totalEur: number };
type MpProcEntry = {
  mpId: number;
  mpName: string;
  contractorName: string;
  totalEur: number;
  contractCount: number;
  byYear?: MpProcYear[];
};

// Non-MP officials (mayors / councillors / ministers / governors / agency
// heads) → procurement, from pep_connected.json. Same person→firm shape as the
// MP join; used as the fallback when a named person isn't a sitting MP so the
// tool covers the whole political class the /procurement/people scanner does.
type PepProcEntry = {
  name: string;
  role: string;
  tier: string;
  contractorName: string;
  totalEur: number;
  contractCount: number;
  byYear?: { year: string; totalEur: number }[];
};

export const mpProcurement = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const d = await fetchData<{ entries: MpProcEntry[] }>(
    "/procurement/derived/mp_connected.json",
  );
  const who = String(args.person ?? "")
    .trim()
    .toLowerCase();
  if (who) {
    const mine = d.entries.filter((e) => e.mpName.toLowerCase().includes(who));
    const byYear = new Map<string, number>();
    for (const e of mine)
      for (const y of e.byYear ?? [])
        byYear.set(y.year, (byYear.get(y.year) ?? 0) + y.totalEur);
    const years = [...byYear.keys()].sort();
    if (mine.length && years.length > 1) {
      const total = mine.reduce((s, e) => s + e.totalEur, 0);
      return {
        tool: "mpProcurement",
        domain: "fiscal",
        kind: "series",
        title: bg
          ? `Поръчки към фирми, свързани с ${mine[0].mpName}`
          : `Procurement to firms tied to ${mine[0].mpName}`,
        subtitle: bg
          ? "По година (стойност на договорите)"
          : "By year (contract value)",
        categories: years,
        series: [
          {
            key: "value",
            label: bg ? "Стойност (€)" : "Value (€)",
            points: years.map((y) => ({
              x: y,
              y: Math.round(byYear.get(y) ?? 0),
            })),
          },
        ],
        viz: "line",
        facts: {
          mp: mine[0].mpName,
          companies: mine.length,
          total_value: fmtEurCompact(total, ctx.lang),
          years: years.length,
        },
        provenance: ["procurement/derived/mp_connected.json"],
      };
    }
    // Not a sitting MP — try the broader political class (mayors, councillors,
    // ministers, governors, agency heads) via pep_connected. Fetched only on an
    // MP miss to keep the common path lean.
    if (!mine.length) {
      const pep = await fetchData<{ entries: PepProcEntry[] }>(
        "/procurement/derived/pep_connected.json",
      );
      const off = pep.entries.filter((e) => e.name.toLowerCase().includes(who));
      if (off.length) {
        const oByYear = new Map<string, number>();
        for (const e of off)
          for (const y of e.byYear ?? [])
            oByYear.set(y.year, (oByYear.get(y.year) ?? 0) + y.totalEur);
        const oYears = [...oByYear.keys()].sort();
        const total = off.reduce((s, e) => s + e.totalEur, 0);
        const name = off[0].name;
        if (oYears.length > 1) {
          return {
            tool: "mpProcurement",
            domain: "fiscal",
            kind: "series",
            title: bg
              ? `Поръчки към фирми, свързани с ${name}`
              : `Procurement to firms tied to ${name}`,
            subtitle: bg
              ? "По година (стойност на договорите)"
              : "By year (contract value)",
            categories: oYears,
            series: [
              {
                key: "value",
                label: bg ? "Стойност (€)" : "Value (€)",
                points: oYears.map((y) => ({
                  x: y,
                  y: Math.round(oByYear.get(y) ?? 0),
                })),
              },
            ],
            viz: "line",
            facts: {
              official: name,
              role: off[0].role,
              companies: off.length,
              total_value: fmtEurCompact(total, ctx.lang),
              years: oYears.length,
            },
            provenance: ["procurement/derived/pep_connected.json"],
          };
        }
        // single-year official -> a small table of their connected firms
        return {
          tool: "mpProcurement",
          domain: "fiscal",
          kind: "table",
          title: bg
            ? `Поръчки към фирми, свързани с ${name}`
            : `Procurement to firms tied to ${name}`,
          columns: [
            { key: "contractor", label: bg ? "Изпълнител" : "Contractor" },
            {
              key: "amount",
              label: bg ? "Стойност" : "Value",
              numeric: true,
            },
            {
              key: "contracts",
              label: bg ? "Договори" : "Contracts",
              numeric: true,
              format: "int",
            },
          ],
          rows: off
            .sort((a, b) => b.totalEur - a.totalEur)
            .map((e) => ({
              contractor: e.contractorName,
              amount: fmtEurCompact(e.totalEur, ctx.lang),
              contracts: e.contractCount,
            })),
          viz: "none",
          facts: {
            official: name,
            role: off[0].role,
            companies: off.length,
            total_value: fmtEurCompact(total, ctx.lang),
          },
          provenance: ["procurement/derived/pep_connected.json"],
        };
      }
    }
    // named person not found / single year -> fall through to the chamber ranking
  }
  const top = [...d.entries]
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, 12);
  const rows: Row[] = top.map((e) => ({
    mp: e.mpName,
    contractor: e.contractorName,
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
      ? "Договори към фирми, в които заседаващ депутат има дял или ръководна роля"
      : "Contracts to firms where a sitting MP holds a stake or management role",
    columns: [
      { key: "mp", label: bg ? "Депутат" : "MP" },
      { key: "contractor", label: bg ? "Изпълнител" : "Contractor" },
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
      top_contractor: top[0]?.contractorName ?? "—",
      top_value: top[0] ? fmtEurCompact(top[0].totalEur, ctx.lang) : "—",
    },
    provenance: ["procurement/derived/mp_connected.json"],
  };
};

// ---- procurement for one buyer (awarder / contracting authority) ------------
// The buyer-side drill-down: how much a single institution spent on public
// procurement, its biggest suppliers and its by-year trend. Resolves the named
// institution against the full awarders index (derived/awarders_index.json) —
// the only place a buyer can be found BY NAME, and the surface for the ~900
// small schools the ЦАИС ЕОП gap-fill adds. Accepts an EIK directly too.

type AwarderIndexRow = {
  eik: string;
  name: string;
  totalEur: number;
  contractCount: number;
  tier?: string;
};
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
  const idx = await fetchData<{ awarders: AwarderIndexRow[] }>(
    "/procurement/derived/awarders_index.json",
  );

  // Direct EIK (9–13 digits) wins over name resolution.
  const eikInRaw = raw.match(/\b\d{9,13}\b/)?.[0];
  let hit: AwarderIndexRow | undefined = eikInRaw
    ? idx.awarders.find((a) => a.eik === eikInRaw)
    : undefined;
  if (!hit) {
    const q = cleanAwarderQuery(raw);
    const m = fuzzyBestMatch<AwarderIndexRow>(
      q,
      () => idx.awarders.map((a) => ({ item: a, keys: [a.name] })),
      { cacheKey: "procAwarders", threshold: 0.45, minLen: 3 },
    );
    hit = m?.item;
  }

  if (!hit) {
    return {
      tool: "awarderProcurement",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Не открих такъв възложител в данните за поръчки"
        : "No such procurement buyer found",
      viz: "none",
      facts: { query: raw },
      provenance: ["procurement/derived/awarders_index.json"],
    };
  }

  const a = await fetchData<AwarderRollup>(
    `/procurement/awarders/${hit.eik}.json`,
  );
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
    title: bg
      ? `Обществени поръчки — ${a.name}`
      : `Public procurement — ${a.name}`,
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
      buyer: a.name,
      eik: a.eik,
      total_value: fmtEurCompact(a.totalEur, ctx.lang),
      contracts: fmtInt(a.contractCount, ctx.lang),
      suppliers: (a.byContractor ?? []).length,
      years: span,
      top_supplier: suppliers[0]?.name ?? "—",
    },
    provenance: [
      "procurement/derived/awarders_index.json",
      `procurement/awarders/${hit.eik}.json`,
    ],
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
  const d = await fetchData<FundsProjIndex>("/funds/projects/index.json");
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
    provenance: ["funds/projects/index.json"],
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
