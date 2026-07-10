// НЗОК (National Health Insurance Fund) health-pack tools. Read the committed
// static JSON under /budget/nzok/* — the same figures the health sector pack on
// /awarder/121858220 serves. Amounts are in EUR. Mirrors the fiscal tools'
// Envelope shape; every fact goes through ctx.lang.

import { fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt } from "./format";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

type Money = { amountEur: number; amount: number; currency: string };

// ---- budget-law breakdown ("Къде отиват парите на НЗОК?") -------------------

type NzokBudgetLine = {
  id: string;
  group: "care" | "admin" | "reserve";
  bg: string;
  en: string;
  amount: Money;
};
type NzokBudgetYear = {
  fiscalYear: number;
  basis: "law" | "draft";
  totalExpenditure: Money;
  lines: NzokBudgetLine[];
};
type NzokBudgetFile = {
  latestYear: number;
  years: NzokBudgetYear[]; // descending by fiscalYear
};

export const nzokBudget = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<NzokBudgetFile>("/budget/nzok/budget.json");
  // pick the requested year if present, else the latest (years are desc).
  const want = Number(args.year);
  const year =
    (Number.isFinite(want) && f.years.find((y) => y.fiscalYear === want)) ||
    f.years[0];
  if (!year) {
    return {
      tool: "nzokBudget",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Няма данни за бюджета на НЗОК" : "No NHIF budget data",
      viz: "none",
      facts: {},
      provenance: ["budget/nzok/budget.json"],
    };
  }
  const total = year.totalExpenditure.amountEur;
  const lines = [...year.lines]
    .map((l) => ({ label: bg ? l.bg : l.en, eur: l.amount.amountEur }))
    .filter((l) => l.eur > 0)
    .sort((a, b) => b.eur - a.eur);
  const biggest = lines[0];
  const basisNote = bg
    ? year.basis === "draft"
      ? "по проектобюджет"
      : "по приет бюджет"
    : year.basis === "draft"
      ? "draft budget"
      : "adopted budget";

  const rows: Row[] = lines.map((l) => ({
    line: l.label,
    amount: fmtEurCompact(l.eur, ctx.lang),
    share: total > 0 ? round2((100 * l.eur) / total) : 0,
  }));
  const columns: Column[] = [
    { key: "line", label: bg ? "Разход" : "Line" },
    { key: "amount", label: bg ? "Сума" : "Amount", numeric: true },
    { key: "share", label: "%", numeric: true, format: "pct" },
  ];

  const facts: Record<string, string | number> = {
    year: year.fiscalYear,
    total: fmtEurCompact(total, ctx.lang),
    biggest_line: biggest?.label ?? "—",
    biggest_amount: biggest ? fmtEurCompact(biggest.eur, ctx.lang) : "—",
    biggest_share:
      biggest && total > 0 ? `${round2((100 * biggest.eur) / total)}%` : "—",
    lines: lines.length,
  };

  return {
    tool: "nzokBudget",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Къде отиват парите на НЗОК (${year.fiscalYear})`
      : `Where the NHIF money goes (${year.fiscalYear})`,
    subtitle: bg
      ? `Разходи по бюджета на НЗОК — ${basisNote}`
      : `NHIF budget-law expenditure — ${basisNote}`,
    columns,
    rows,
    categories: lines.map((l) => l.label),
    series: [
      {
        key: "amount",
        label: bg ? "Разход (€)" : "Spend (€)",
        points: lines.map((l) => ({ x: l.label, y: Math.round(l.eur) })),
      },
    ],
    viz: "bar",
    facts,
    provenance: ["budget/nzok/budget.json"],
  };
};

// ---- top reimbursed medicines (INN) + a growth cue --------------------------

type NzokDrugInn = {
  inn: string;
  atc: string;
  atcGroup: string;
  eur: number;
  productCount: number;
  topProduct: string | null;
};
type NzokDrugMover = {
  inn: string;
  atc: string;
  atcGroup: string;
  eur: number;
  priorEur: number;
  deltaPct: number | null;
};
type NzokDrugGrowth = {
  year: number;
  priorYear: number;
  floorEur: number;
  risers: NzokDrugMover[];
  fallers: NzokDrugMover[];
  newlyReimbursed: NzokDrugMover[];
};
type NzokDrugReimbursementFile = {
  year: number;
  basis: "annual" | "ytd";
  totalEur: number;
  distinctInn: number;
  byAtcGroup: { code: string; bg: string; en: string; eur: number }[];
  top: NzokDrugInn[];
  growth?: NzokDrugGrowth | null;
};

const basisNoteDrugs = (basis: string, lang: ToolContext["lang"]): string =>
  lang === "bg"
    ? basis === "ytd"
      ? "от началото на годината"
      : "за годината"
    : basis === "ytd"
      ? "year-to-date"
      : "full year";

// The snapshot: which active substances (INN) НЗОК reimburses the most, plus the
// oncology (ATC group L) share — the dominant slice.
export const nzokDrugs = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<NzokDrugReimbursementFile>(
    "/budget/nzok/drug_reimbursement.json",
  );
  if (!f.top?.length) {
    return {
      tool: "nzokDrugs",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Няма данни за реимбурсирани лекарства"
        : "No drug-reimbursement data",
      viz: "none",
      facts: {},
      provenance: ["budget/nzok/drug_reimbursement.json"],
    };
  }
  const n = Math.min(Math.max(Number(args.count) || 12, 1), 25);
  const top = f.top.slice(0, n);
  const onco = f.byAtcGroup.find((g) => g.code === "L");
  const oncoShare =
    onco && f.totalEur > 0 ? round2((100 * onco.eur) / f.totalEur) : null;

  const rows: Row[] = top.map((t) => ({
    inn: t.inn,
    product: t.topProduct ?? "—",
    amount: fmtEurCompact(t.eur, ctx.lang),
  }));
  const columns: Column[] = [
    { key: "inn", label: bg ? "Активно вещество (INN)" : "Active substance" },
    { key: "product", label: bg ? "Водещ продукт" : "Top product" },
    {
      key: "amount",
      label: bg ? "Реимбурсирано" : "Reimbursed",
      numeric: true,
    },
  ];

  return {
    tool: "nzokDrugs",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `За кои лекарства плаща най-много НЗОК (${f.year})`
      : `Which medicines the NHIF reimburses most (${f.year})`,
    subtitle: bg
      ? `Брутни разходи по активно вещество · ${basisNoteDrugs(f.basis, ctx.lang)}`
      : `Gross reimbursement by active substance · ${basisNoteDrugs(f.basis, ctx.lang)}`,
    columns,
    rows,
    categories: top.map((t) => t.inn),
    series: [
      {
        key: "amount",
        label: bg ? "Реимбурсирано (€)" : "Reimbursed (€)",
        points: top.map((t) => ({ x: t.inn, y: Math.round(t.eur) })),
      },
    ],
    viz: "bar",
    facts: {
      year: f.year,
      total: fmtEurCompact(f.totalEur, ctx.lang),
      distinct_inn: fmtInt(f.distinctInn, ctx.lang),
      top_inn: top[0]?.inn ?? "—",
      top_amount: top[0] ? fmtEurCompact(top[0].eur, ctx.lang) : "—",
      top_product: top[0]?.topProduct ?? "—",
      oncology_share: oncoShare != null ? `${oncoShare}%` : "—",
    },
    provenance: ["budget/nzok/drug_reimbursement.json"],
  };
};

// The trend companion: the fastest-rising and newly-reimbursed molecules from
// the full-year YoY `growth` block (two closed years, so a partial current year
// can't distort it). Falls back to the snapshot when growth isn't available.
export const nzokDrugGrowth = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<NzokDrugReimbursementFile>(
    "/budget/nzok/drug_reimbursement.json",
  );
  const g = f.growth;
  if (!g || (!g.risers.length && !g.newlyReimbursed.length)) {
    // no full-year comparison → give the snapshot instead of dead-ending, but
    // keep this route's tool identity so narrate/links key off the right tool.
    return { ...(await nzokDrugs(args, ctx)), tool: "nzokDrugGrowth" };
  }
  const pct = (m: NzokDrugMover): string =>
    m.deltaPct == null
      ? bg
        ? "нов"
        : "new"
      : `${m.deltaPct >= 0 ? "+" : ""}${Math.round(m.deltaPct * 100)}%`;

  // risers first, then newly-reimbursed molecules (which have no prior year).
  const movers = [...g.risers, ...g.newlyReimbursed].slice(0, 12);
  const rows: Row[] = movers.map((m) => ({
    inn: m.inn,
    group: m.atcGroup,
    amount: fmtEurCompact(m.eur, ctx.lang),
    change: pct(m),
  }));
  const columns: Column[] = [
    { key: "inn", label: bg ? "Активно вещество (INN)" : "Active substance" },
    { key: "group", label: bg ? "АТХ група" : "ATC group" },
    {
      key: "amount",
      label: bg ? "Реимбурсирано" : "Reimbursed",
      numeric: true,
    },
    { key: "change", label: bg ? "Промяна" : "Change", numeric: true },
  ];
  const topRiser = g.risers[0];
  const topNew = g.newlyReimbursed[0];

  return {
    tool: "nzokDrugGrowth",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Най-бързо растящи лекарства на НЗОК (${g.priorYear}→${g.year})`
      : `Fastest-rising NHIF medicines (${g.priorYear}→${g.year})`,
    subtitle: bg
      ? "Годишна промяна по активно вещество (двете завършени години)"
      : "Year-over-year change by active substance (two closed years)",
    columns,
    rows,
    viz: "none",
    facts: {
      year: g.year,
      prior_year: g.priorYear,
      top_riser: topRiser?.inn ?? "—",
      top_riser_change: topRiser
        ? `${topRiser.deltaPct != null ? (topRiser.deltaPct >= 0 ? "+" : "") + Math.round(topRiser.deltaPct * 100) : "0"}%`
        : "—",
      top_riser_amount: topRiser ? fmtEurCompact(topRiser.eur, ctx.lang) : "—",
      newly_reimbursed: g.newlyReimbursed.length,
      top_new: topNew?.inn ?? "—",
    },
    provenance: ["budget/nzok/drug_reimbursement.json"],
  };
};

// ---- top hospitals paid by НЗОК (БМП) ---------------------------------------

type NzokHospitalRow = {
  regNo: string;
  name: string;
  rzokCode: string;
  rzokName: string;
  cumulativeEur: number;
  monthEur: number;
  eik?: string | null;
};
type NzokHospitalPaymentsFile = {
  asOf: string;
  year: number;
  month: number;
  totalCumulativeEur: number;
  monthTotalEur: number;
  facilityCount: number;
  byRzok: {
    code: string;
    name: string;
    cumulativeEur: number;
    facilityCount: number;
  }[];
  hospitals: NzokHospitalRow[]; // sorted by cumulativeEur desc
};

export const nzokHospitals = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<NzokHospitalPaymentsFile>(
    "/budget/nzok/hospital_payments.json",
  );
  if (!f.hospitals?.length) {
    return {
      tool: "nzokHospitals",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Няма данни за плащания към болници"
        : "No hospital-payment data",
      viz: "none",
      facts: {},
      provenance: ["budget/nzok/hospital_payments.json"],
    };
  }
  const n = Math.min(Math.max(Number(args.count) || 12, 1), 25);
  const top = f.hospitals.slice(0, n); // already sorted desc by cumulativeEur
  const rows: Row[] = top.map((h) => ({
    hospital: h.name,
    rzok: h.rzokName,
    amount: fmtEurCompact(h.cumulativeEur, ctx.lang),
  }));
  const columns: Column[] = [
    { key: "hospital", label: bg ? "Лечебно заведение" : "Hospital" },
    { key: "rzok", label: bg ? "РЗОК" : "RZOK" },
    { key: "amount", label: bg ? "Изплатено" : "Paid", numeric: true },
  ];
  const biggest = top[0];

  return {
    tool: "nzokHospitals",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Кои болници получават най-много от НЗОК (${f.asOf})`
      : `Which hospitals the NHIF pays most (${f.asOf})`,
    subtitle: bg
      ? "Плащания за болнична медицинска помощ (БМП), кумулативно от началото на годината"
      : "Inpatient-care (БМП) payments, cumulative year-to-date",
    columns,
    rows,
    categories: top.map((h) => h.name),
    series: [
      {
        key: "amount",
        label: bg ? "Изплатено (€)" : "Paid (€)",
        points: top.map((h) => ({ x: h.name, y: Math.round(h.cumulativeEur) })),
      },
    ],
    viz: "bar",
    facts: {
      as_of: f.asOf,
      national_total: fmtEurCompact(f.totalCumulativeEur, ctx.lang),
      facilities: fmtInt(f.facilityCount, ctx.lang),
      top_hospital: biggest?.name ?? "—",
      top_amount: biggest
        ? fmtEurCompact(biggest.cumulativeEur, ctx.lang)
        : "—",
      // hidden → /company/:eik deep link (see links.ts), when the biggest
      // hospital is confidently matched to a Commerce-Register EIK.
      ...(biggest?.eik ? { eik_id: biggest.eik } : {}),
    },
    provenance: ["budget/nzok/hospital_payments.json"],
  };
};

// ---- clinical-activity corpus ("Какви дейности плаща НЗОК?") ----------------

type NzokActivitiesOverview = {
  year: number;
  totals: {
    totalCases: number;
    distinctProcedures: number;
    distinctFacilities: number;
  };
  topProcedures: {
    procedure: string;
    procType: string;
    cases: number;
    zol: number;
    facilityCount: number;
  }[];
};

// National clinical-activity volumes: the most frequent НЗОК-funded procedures by
// number of cases. This is the case-mix layer — VOLUME, not money (the source
// carries no price). Cues: клинична пътека / дейности / случаи / activity.
export const nzokActivities = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<NzokActivitiesOverview>(
    "/budget/nzok/activities_overview.json",
  );
  if (!f.topProcedures?.length) {
    return {
      tool: "nzokActivities",
      domain: "fiscal",
      kind: "scalar",
      title: bg ? "Няма данни за дейности по НЗОК" : "No NHIF activity data",
      viz: "none",
      facts: {},
      provenance: ["budget/nzok/activities_overview.json"],
    };
  }
  const n = Math.min(Math.max(Number(args.count) || 12, 1), 25);
  const top = f.topProcedures.slice(0, n);
  const rows: Row[] = top.map((p) => ({
    procedure: p.procedure,
    type: p.procType,
    cases: fmtInt(p.cases, ctx.lang),
    facilities: fmtInt(p.facilityCount, ctx.lang),
  }));
  const columns: Column[] = [
    { key: "procedure", label: bg ? "Код" : "Code" },
    { key: "type", label: bg ? "Вид" : "Type" },
    { key: "cases", label: bg ? "Случаи" : "Cases", numeric: true },
    { key: "facilities", label: bg ? "Болници" : "Facilities", numeric: true },
  ];
  const biggest = top[0];
  return {
    tool: "nzokActivities",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Най-чести дейности, платени от НЗОК (${f.year})`
      : `Most frequent NHIF-funded procedures (${f.year})`,
    subtitle: bg
      ? "По брой случаи. КП — клинична пътека, АПр — амбулаторна процедура, КПр — клинична процедура. Броят е обем, не стойност."
      : "By number of cases. КП — clinical pathway, АПр — ambulatory procedure, КПр — clinical procedure. Cases are volume, not value.",
    columns,
    rows,
    categories: top.map((p) => p.procedure),
    series: [
      {
        key: "cases",
        label: bg ? "Случаи" : "Cases",
        points: top.map((p) => ({ x: p.procedure, y: round2(p.cases) })),
      },
    ],
    viz: "bar",
    facts: {
      year: String(f.year),
      total_cases: fmtInt(f.totals.totalCases, ctx.lang),
      procedures: fmtInt(f.totals.distinctProcedures, ctx.lang),
      facilities: fmtInt(f.totals.distinctFacilities, ctx.lang),
      top_procedure: biggest?.procedure ?? "—",
      top_cases: biggest ? fmtInt(biggest.cases, ctx.lang) : "—",
    },
    provenance: ["budget/nzok/activities_overview.json"],
  };
};
