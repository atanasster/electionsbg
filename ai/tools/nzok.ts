// НЗОК (National Health Insurance Fund) health-pack tools. Read the committed
// static JSON under /budget/nzok/* — the same figures the health sector pack on
// /awarder/121858220 serves. Amounts are in EUR. Mirrors the fiscal tools'
// Envelope shape; every fact goes through ctx.lang.

import { fetchData, fetchDb } from "./dataClient";
import { fmtEurCompact, fmtInt } from "./format";
import { round2 } from "./dataset";
import {
  NZOK_MEASURES,
  formatMeasureValue,
  measureStanding,
  standingLabel,
} from "@/lib/nzokMeasures";
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

// ---- drug-savings leaderboard ("Колко може да спести НЗОК от лекарства?") -----
// DB-backed (migration 055): the national "€X of avoidable overpay if every
// hospital paid the peer-median unit price for the same pack" figure + the
// per-hospital ranking. A signpost, not a verdict — a price gap can reflect
// volume, delivery period or contract terms.

type NzokDrugSavingsHospitalLite = {
  eik: string | null;
  facility: string;
  overpayEur: number;
  innCount: number;
  packCount: number;
  maxRatio: number | null;
};
type NzokDrugSavingsLite = {
  year: number;
  totalOverpayEur: number;
  hospitalCount: number;
  innCount: number;
  hospitals: NzokDrugSavingsHospitalLite[];
} | null;

export const nzokDrugSavings = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchDb<NzokDrugSavingsLite>("nzok-drug-savings");
  if (!f || !f.hospitals?.length) {
    return {
      tool: "nzokDrugSavings",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Няма данни за спестявания от лекарства"
        : "No drug-savings data",
      viz: "none",
      facts: {},
      provenance: ["nzok_drug_overpay_by_hospital (PG)"],
    };
  }
  const n = Math.min(Math.max(Number(args.count) || 12, 1), 25);
  const top = f.hospitals.slice(0, n);
  const rows: Row[] = top.map((h) => ({
    hospital: h.facility,
    molecules: fmtInt(h.innCount, ctx.lang),
    packs: fmtInt(h.packCount, ctx.lang),
    overpay: fmtEurCompact(h.overpayEur, ctx.lang),
  }));
  const columns: Column[] = [
    { key: "hospital", label: bg ? "Болница" : "Hospital" },
    { key: "molecules", label: bg ? "Молекули" : "Molecules", numeric: true },
    { key: "packs", label: bg ? "Опаковки" : "Packs", numeric: true },
    {
      key: "overpay",
      label: bg ? "Над медианата" : "Above median",
      numeric: true,
    },
  ];
  const worst = top[0];
  return {
    tool: "nzokDrugSavings",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Потенциално спестяване от лекарства при цена = медианата (${f.year})`
      : `Potential drug savings at the median price (${f.year})`,
    subtitle: bg
      ? `Ако всяка болница беше платила медианната цена за същата опаковка: ~${fmtEurCompact(f.totalOverpayEur, ctx.lang)} за ${f.year} г. Сравнението е по опаковка (Национален №); разликата не е нередност.`
      : `If every hospital had paid the median price for the same pack: ~${fmtEurCompact(f.totalOverpayEur, ctx.lang)} in ${f.year}. Compared per pack (Национален №); a gap is not an irregularity.`,
    columns,
    rows,
    categories: top.map((h) => h.facility),
    series: [
      {
        key: "overpay",
        label: bg ? "Над медианата (€)" : "Above median (€)",
        points: top.map((h) => ({
          x: h.facility,
          y: Math.round(h.overpayEur),
        })),
      },
    ],
    viz: "bar",
    facts: {
      year: String(f.year),
      total_savings: fmtEurCompact(f.totalOverpayEur, ctx.lang),
      hospitals: fmtInt(f.hospitalCount, ctx.lang),
      molecules: fmtInt(f.innCount, ctx.lang),
      top_hospital: worst?.facility ?? "—",
      top_overpay: worst ? fmtEurCompact(worst.overpayEur, ctx.lang) : "—",
    },
    provenance: [
      "nzok_drug_overpay_by_hospital (PG)",
      "nzok_drug_overpay_by_inn (PG)",
    ],
  };
};

// ---- per-molecule drug-price overpay ("Кои болници надплащат за X?") ---------
// DB-backed (migrations 052/054): serves the same figures the /molecule/:inn page
// shows. Two behaviours in one tool: name a molecule (INN) → which hospitals paid
// ABOVE the national median for its packs, deep-linked to /molecule/:inn; omit it
// → the molecules where hospitals overpay the most. Comparison is at PACK identity
// (Национален №), never at INN — a gap is a signpost, not an irregularity.

type NzokDrugRiskInnLite = {
  inn: string;
  overpayEur: number;
  facilityCount: number;
  packCount: number;
  maxRatio: number | null;
};
type NzokDrugRiskLite = { year: number; drugs: NzokDrugRiskInnLite[] } | null;

type NzokDrugMoleculeRowLite = {
  tradeName: string;
  facility: string;
  eik: string | null;
  unitEur: number;
  medianUnitEur: number;
  ratio: number;
  overpayEur: number;
};
type NzokDrugMoleculeLite = {
  inn: string;
  year: number;
  overpayEur: number;
  facilityCount: number;
  packCount: number;
  maxRatio: number | null;
  rows: NzokDrugMoleculeRowLite[];
} | null;

// Resolve a molecule from free text against the known INN universe: an exact
// (case-insensitive) INN, then any INN that appears as a whole Latin token in the
// text, then a prefix. Returns null when nothing recognisable is named.
const resolveInn = (
  raw: string,
  drugs: NzokDrugRiskInnLite[],
): string | null => {
  const up = raw.toUpperCase().trim();
  if (!up) return null;
  const exact = drugs.find((d) => d.inn === up);
  if (exact) return exact.inn;
  const tokens = new Set(up.split(/[^A-Z0-9]+/).filter((t) => t.length >= 4));
  const tokenHit = drugs.find((d) => tokens.has(d.inn));
  if (tokenHit) return tokenHit.inn;
  if (up.length >= 4) {
    const prefix = drugs.find((d) => d.inn.startsWith(up));
    if (prefix) return prefix.inn;
  }
  return null;
};

export const nzokDrugMolecule = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const risk = await fetchDb<NzokDrugRiskLite>("nzok-drug-risk");
  const drugs = risk?.drugs ?? [];
  if (!drugs.length) {
    return {
      tool: "nzokDrugMolecule",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Няма данни за цените на лекарствата по болници"
        : "No hospital drug-price data",
      viz: "none",
      facts: {},
      provenance: ["nzok_drug_overpay_by_inn (PG)"],
    };
  }

  const inn = resolveInn(String(args.inn ?? ""), drugs);

  // A specific molecule → which hospitals paid above the pack median for it.
  if (inn) {
    const detail = await fetchDb<NzokDrugMoleculeLite>("nzok-drug-molecule", {
      inn,
    });
    if (detail && detail.rows.length) {
      const top = detail.rows.slice(0, 12);
      const rows: Row[] = top.map((r) => ({
        hospital: r.facility,
        pack: r.tradeName || "—",
        unit: fmtEurCompact(r.unitEur, ctx.lang),
        median: fmtEurCompact(r.medianUnitEur, ctx.lang),
        gap: `${round2(r.ratio)}×`,
      }));
      const columns: Column[] = [
        { key: "hospital", label: bg ? "Болница" : "Hospital" },
        { key: "pack", label: bg ? "Опаковка" : "Pack" },
        { key: "unit", label: bg ? "Цена/ед." : "Unit", numeric: true },
        { key: "median", label: bg ? "Медиана" : "Median", numeric: true },
        { key: "gap", label: bg ? "Разлика" : "Gap", numeric: true },
      ];
      const worst = top[0];
      return {
        tool: "nzokDrugMolecule",
        domain: "fiscal",
        kind: "table",
        title: bg
          ? `Кои болници плащат над медианата за ${inn} (${detail.year})`
          : `Which hospitals pay above median for ${inn} (${detail.year})`,
        subtitle: bg
          ? "Единична цена спрямо медианата за същата опаковка (Национален №). Разликата не е нередност — може да отразява обем, срок на доставка или условия по договора."
          : "Unit price vs the median for the same pack (Национален №). A gap is not an irregularity — it can reflect volume, delivery period or contract terms.",
        columns,
        rows,
        categories: top.map((r) => r.facility),
        series: [
          {
            key: "gap",
            label: bg ? "Над медианата (€)" : "Above median (€)",
            points: top.map((r) => ({
              x: r.facility,
              y: Math.round(r.overpayEur),
            })),
          },
        ],
        viz: "bar",
        facts: {
          inn,
          year: String(detail.year),
          hospitals: fmtInt(detail.facilityCount, ctx.lang),
          packs: fmtInt(detail.packCount, ctx.lang),
          total_overpay: fmtEurCompact(detail.overpayEur, ctx.lang),
          max_ratio:
            detail.maxRatio != null ? `${round2(detail.maxRatio)}×` : "—",
          top_hospital: worst?.facility ?? "—",
          top_overpay: worst ? fmtEurCompact(worst.overpayEur, ctx.lang) : "—",
          // hidden → /molecule/:inn deep link (see links.ts).
          inn_id: inn,
        },
        provenance: ["nzok_drug_overpay (PG)", "nzok_drug_overpay_by_inn (PG)"],
      };
    }
  }

  // No molecule named (or unmatched) → the molecules hospitals overpay most for.
  const n = Math.min(Math.max(Number(args.count) || 12, 1), 25);
  const top = drugs.slice(0, n);
  const rows: Row[] = top.map((d) => ({
    inn: d.inn,
    hospitals: fmtInt(d.facilityCount, ctx.lang),
    packs: fmtInt(d.packCount, ctx.lang),
    overpay: fmtEurCompact(d.overpayEur, ctx.lang),
  }));
  const columns: Column[] = [
    { key: "inn", label: bg ? "Лекарство (INN)" : "Medicine (INN)" },
    { key: "hospitals", label: bg ? "Болници" : "Hospitals", numeric: true },
    { key: "packs", label: bg ? "Опаковки" : "Packs", numeric: true },
    {
      key: "overpay",
      label: bg ? "Над медианата" : "Above median",
      numeric: true,
    },
  ];
  const biggest = top[0];
  return {
    tool: "nzokDrugMolecule",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `За кои лекарства болниците плащат над медианата (${risk!.year})`
      : `Medicines hospitals overpay the most for (${risk!.year})`,
    subtitle: bg
      ? "Обща сума, платена над медианната цена за същата опаковка от всички болници. Посочи молекула за разбивка по болници."
      : "Total paid above the median price for the same pack across all hospitals. Name a molecule for the per-hospital breakdown.",
    columns,
    rows,
    categories: top.map((d) => d.inn),
    series: [
      {
        key: "overpay",
        label: bg ? "Над медианата (€)" : "Above median (€)",
        points: top.map((d) => ({ x: d.inn, y: Math.round(d.overpayEur) })),
      },
    ],
    viz: "bar",
    facts: {
      year: String(risk!.year),
      molecules: fmtInt(drugs.length, ctx.lang),
      top_inn: biggest?.inn ?? "—",
      top_overpay: biggest ? fmtEurCompact(biggest.overpayEur, ctx.lang) : "—",
      top_hospitals: biggest ? fmtInt(biggest.facilityCount, ctx.lang) : "—",
    },
    provenance: ["nzok_drug_overpay_by_inn (PG)"],
  };
};

// ---- hospital report card ("Как се представя болница X?") --------------------
// DB-backed (migrations 056/058/059): each financial ratio measure vs the national
// median (над / около / под, via the p40–p60 tolerance band), plus the case-mix
// expected-vs-actual ratio when the НРД tariffs are loaded. Colour/verdict only for
// the two polar measures; the rest are positional (case-mix drives the variation).

type NzokMeasureCardLite = {
  measure: string;
  value: number;
  median: number;
  p40: number;
  p60: number;
  percentile: number;
  n: number;
};
type NzokScorecardLite = {
  eik: string;
  quarter: string;
  measures: NzokMeasureCardLite[];
} | null;
type NzokCasemixLite = {
  year: number;
  expectedEur: number;
  actualEur: number | null;
  ratio: number | null;
  coverage: number;
} | null;

// Resolve a hospital from free text against the payments roster (the only nzok
// source with name + EIK for ~every facility). Token-overlap: uppercase, drop
// legal-form + filler tokens, score shared tokens, require ≥1 and an EIK.
const HOSP_DROP = new Set([
  "ЕАД",
  "АД",
  "ЕООД",
  "ООД",
  "МБАЛ",
  "УМБАЛ",
  "СБАЛ",
  "БОЛНИЦА",
  "ГР",
  "ЗА",
  "ПО",
  "НА",
  "И",
]);
const hospTokens = (s: string): string[] =>
  s
    .toUpperCase()
    .replace(/[«»"'`„“”‘’.,-]/g, " ")
    .replace(/СВЕТИ|СВЕТА|СВ\b/g, "СВ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !HOSP_DROP.has(t));

const resolveHospital = (
  raw: string,
  hospitals: NzokHospitalRow[],
): { name: string; eik: string } | null => {
  const q = hospTokens(raw);
  if (!q.length) return null;
  const qs = new Set(q);
  let best: { name: string; eik: string; score: number } | null = null;
  for (const h of hospitals) {
    if (!h.eik) continue;
    const ht = hospTokens(h.name);
    const score = ht.filter((t) => qs.has(t)).length;
    if (score > 0 && (!best || score > best.score))
      best = { name: h.name, eik: h.eik, score };
  }
  return best ? { name: best.name, eik: best.eik } : null;
};

export const nzokHospitalScorecard = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const payments = await fetchData<NzokHospitalPaymentsFile>(
    "/budget/nzok/hospital_payments.json",
  );
  const named = String(args.hospital ?? args.name ?? "");
  const match = resolveHospital(named, payments.hospitals ?? []);
  if (!match) {
    return {
      tool: "nzokHospitalScorecard",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Посочете болница (напр. Пирогов, Свети Георги Пловдив)"
        : "Name a hospital (e.g. Pirogov, Sveti Georgi Plovdiv)",
      viz: "none",
      facts: {},
      provenance: ["budget/nzok/hospital_payments.json"],
    };
  }
  const card = await fetchDb<NzokScorecardLite>(
    "nzok-financials-measures-by-eik",
    { eik: match.eik },
  );
  if (!card || !card.measures?.length) {
    return {
      tool: "nzokHospitalScorecard",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? `Няма финансови показатели за ${match.name}`
        : `No financial indicators for ${match.name}`,
      viz: "none",
      facts: { hospital: match.name, eik_id: match.eik },
      provenance: ["nzok_hospital_financials (PG)"],
    };
  }
  const casemix = await fetchDb<NzokCasemixLite>("nzok-casemix-by-eik", {
    eik: match.eik,
  });

  const byKey = new Map(card.measures.map((m) => [m.measure, m]));
  const ordered = NZOK_MEASURES.map((def) => ({
    def,
    m: byKey.get(def.key),
  })).filter(
    (r): r is { def: (typeof NZOK_MEASURES)[number]; m: NzokMeasureCardLite } =>
      !!r.m,
  );

  const rows: Row[] = ordered.map(({ def, m }) => ({
    measure: bg ? def.titleBg : def.titleEn,
    value: formatMeasureValue(def.key, m.value, ctx.lang),
    median: formatMeasureValue(def.key, m.median, ctx.lang),
    standing: standingLabel(measureStanding(m.value, m.p40, m.p60), ctx.lang),
  }));
  const columns: Column[] = [
    { key: "measure", label: bg ? "Показател" : "Measure" },
    { key: "value", label: bg ? "Стойност" : "Value", numeric: true },
    { key: "median", label: bg ? "Медиана" : "Median", numeric: true },
    { key: "standing", label: bg ? "Спрямо медианата" : "vs median" },
  ];

  return {
    tool: "nzokHospitalScorecard",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Как се сравнява ${match.name} (${card.quarter})`
      : `How ${match.name} compares (${card.quarter})`,
    subtitle: bg
      ? "Финансови показатели спрямо националната медиана на всички болници с поне 20 легла (ЕЕОФ, МЗ). Повечето са позиционни — профилът на болницата обяснява голяма част от разликите."
      : "Financial indicators vs the national median of all hospitals with at least 20 beds (ЕЕОФ, МЗ). Most are positional — case-mix explains much of the variation.",
    columns,
    rows,
    viz: "none",
    facts: {
      hospital: match.name,
      quarter: card.quarter,
      measures: fmtInt(ordered.length, ctx.lang),
      ...(casemix && casemix.ratio != null
        ? {
            casemix_ratio: `${round2(casemix.ratio)}×`,
            casemix_note: bg
              ? `платени ${fmtEurCompact(casemix.actualEur ?? 0, ctx.lang)} спрямо очаквани ${fmtEurCompact(casemix.expectedEur, ctx.lang)} по НРД цена`
              : `paid ${fmtEurCompact(casemix.actualEur ?? 0, ctx.lang)} vs an expected ${fmtEurCompact(casemix.expectedEur, ctx.lang)} at НРД list price`,
          }
        : {}),
      // hidden → /company/:eik deep link (see links.ts).
      eik_id: match.eik,
    },
    provenance: [
      "nzok_hospital_financials (PG)",
      ...(casemix && casemix.ratio != null
        ? ["nzok_activities (PG)", "nzok_pathway_tariffs (PG)"]
        : []),
    ],
  };
};

// ---- pathway navigation ("Кои болници лекуват по пътека X?") -----------------
// DB-backed (migration 059): which hospitals bill one clinical pathway, ranked
// by cases (VOLUME), plus implied spend (cases × НРД list price) when the tariffs
// are loaded. Resolve a pathway by name (via procedures.json) or by code.

type NzokPathwayHospLite = {
  eik: string | null;
  facility: string;
  rzok: string;
  cases: number;
  spendEur: number | null;
  sharePct?: number;
};
type NzokPathwaySpendLite = {
  procedure: string;
  procType: string;
  year: number;
  totalCases: number;
  facilityCount: number;
  priceEur: number | null;
  totalSpendEur: number | null;
  hospitals: NzokPathwayHospLite[];
} | null;

type NzokProcedureNames = { names: Record<string, string> };

// Resolve free text → a procedure code. A code-like token wins; else the pathway
// whose НРД name best contains the query (prefer a high-volume one).
const resolveProcedure = (
  raw: string,
  names: Record<string, string>,
  topCodes: string[],
): string | null => {
  const up = raw.toUpperCase().trim();
  if (!up) return null;
  const codeM = up.match(/\b([PAK]?\d{1,3}(?:\.\d+)?)\b/);
  if (codeM) {
    const c = codeM[1];
    if (/^[PAK]/.test(c)) {
      // Already a lettered code — take it only if it maps; never re-prefix it.
      if (names[c]) return c;
    } else {
      // Bare number → try the padded КП/АПр/КПр forms present in the names map.
      for (const pref of ["P", "A", "K"]) {
        const padded = `${pref}${c.split(".")[0].padStart(pref === "P" ? 3 : 2, "0")}${c.includes(".") ? "." + c.split(".")[1] : ""}`;
        if (names[padded]) return padded;
      }
    }
  }
  // Name search: tokens of length ≥4 that appear in a pathway name.
  const toks = up.split(/[^A-ZА-Я0-9]+/).filter((t) => t.length >= 4);
  if (!toks.length) return null;
  const topSet = new Set(topCodes);
  let best: { code: string; score: number; top: boolean } | null = null;
  for (const [code, name] of Object.entries(names)) {
    const nm = name.toUpperCase();
    const score = toks.filter((t) => nm.includes(t)).length;
    if (score > 0) {
      const top = topSet.has(code);
      if (
        !best ||
        score > best.score ||
        (score === best.score && top && !best.top)
      )
        best = { code, score, top };
    }
  }
  return best ? best.code : null;
};

export const nzokPathwayHospitals = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const [overview, procNames] = await Promise.all([
    fetchData<NzokActivitiesOverview>("/budget/nzok/activities_overview.json"),
    fetchData<NzokProcedureNames>("/budget/nzok/procedures.json").catch(
      () => ({ names: {} }) as NzokProcedureNames,
    ),
  ]);
  const names = procNames?.names ?? {};
  const topCodes = (overview.topProcedures ?? []).map((p) => p.procedure);
  const code = resolveProcedure(
    String(args.procedure ?? args.pathway ?? args.name ?? ""),
    names,
    topCodes,
  );
  if (!code) {
    // No pathway named → the most frequent pathways, so the user can pick one.
    const top = (overview.topProcedures ?? []).slice(0, 12);
    return {
      tool: "nzokPathwayHospitals",
      domain: "fiscal",
      kind: "table",
      title: bg
        ? "Посочете клинична пътека (напр. хемодиализа)"
        : "Name a clinical pathway (e.g. haemodialysis)",
      subtitle: bg
        ? "Най-чести пътеки — посочете една, за да видите кои болници я отчитат."
        : "Most frequent pathways — name one to see which hospitals bill it.",
      columns: [
        { key: "code", label: bg ? "Код" : "Code" },
        { key: "name", label: bg ? "Пътека" : "Pathway" },
        { key: "cases", label: bg ? "Случаи" : "Cases", numeric: true },
      ],
      rows: top.map((p) => ({
        code: p.procedure,
        name: names[p.procedure] ?? "—",
        cases: fmtInt(p.cases, ctx.lang),
      })),
      viz: "none",
      facts: {},
      provenance: ["budget/nzok/activities_overview.json"],
    };
  }
  const f = await fetchDb<NzokPathwaySpendLite>(
    "nzok-activity-by-procedure-spend",
    { procedure: code },
  );
  if (!f || !f.hospitals?.length) {
    return {
      tool: "nzokPathwayHospitals",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? `Няма данни за пътека ${code}`
        : `No data for pathway ${code}`,
      viz: "none",
      facts: {},
      provenance: ["nzok_activities (PG)"],
    };
  }
  const hasSpend = f.totalSpendEur != null;
  const n = Math.min(Math.max(Number(args.count) || 12, 1), 25);
  const top = f.hospitals.slice(0, n);
  const rows: Row[] = top.map((h) => ({
    hospital: h.facility,
    rzok: h.rzok,
    cases: fmtInt(h.cases, ctx.lang),
    ...(hasSpend
      ? {
          spend: h.spendEur != null ? fmtEurCompact(h.spendEur, ctx.lang) : "—",
        }
      : {}),
    share: h.sharePct != null ? `${round2(h.sharePct)}%` : "—",
  }));
  const columns: Column[] = [
    { key: "hospital", label: bg ? "Болница" : "Hospital" },
    { key: "rzok", label: bg ? "РЗОК" : "RZOK" },
    { key: "cases", label: bg ? "Случаи" : "Cases", numeric: true },
    ...(hasSpend
      ? [
          {
            key: "spend",
            label: bg ? "Стойност" : "Value",
            numeric: true,
          } as Column,
        ]
      : []),
    { key: "share", label: bg ? "Дял" : "Share", numeric: true },
  ];
  const label = names[code] ? `${names[code]} (${code})` : code;
  const biggest = top[0];
  return {
    tool: "nzokPathwayHospitals",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Кои болници лекуват по „${label}" (${f.year})`
      : `Which hospitals treat "${label}" (${f.year})`,
    subtitle: bg
      ? `${fmtInt(f.totalCases, ctx.lang)} случая в ${fmtInt(f.facilityCount, ctx.lang)} заведения. Броят е обем${hasSpend ? "; стойността е случаи × цена по НРД" : " — източникът не съдържа цена на пътека"}.`
      : `${fmtInt(f.totalCases, ctx.lang)} cases across ${fmtInt(f.facilityCount, ctx.lang)} facilities. Cases are volume${hasSpend ? "; value is cases × the НРД list price" : " — the source carries no per-pathway price"}.`,
    columns,
    rows,
    categories: top.map((h) => h.facility),
    series: [
      {
        key: "cases",
        label: bg ? "Случаи" : "Cases",
        points: top.map((h) => ({ x: h.facility, y: Math.round(h.cases) })),
      },
    ],
    viz: "bar",
    facts: {
      pathway: label,
      year: String(f.year),
      total_cases: fmtInt(f.totalCases, ctx.lang),
      facilities: fmtInt(f.facilityCount, ctx.lang),
      top_hospital: biggest?.facility ?? "—",
      top_cases: biggest ? fmtInt(biggest.cases, ctx.lang) : "—",
      ...(hasSpend && f.totalSpendEur != null
        ? { total_value: fmtEurCompact(f.totalSpendEur, ctx.lang) }
        : {}),
    },
    provenance: [
      "nzok_activities (PG)",
      ...(hasSpend ? ["nzok_pathway_tariffs (PG)"] : []),
    ],
  };
};

// ---- public vs private hospitals (the ЕК-съди-България comparison) ----------

type PublicPrivateFile = {
  asOf: string;
  ownership: Record<
    "state" | "municipal" | "private",
    { count: number; nzokEur: number; sharePct: number }
  >;
  privateStats: {
    total: number;
    withShare: number;
    over50: number;
    over50Pct: number;
    medianSharePct: number;
    zeroTender: number;
    over50NoTender: number;
    over50NoTenderAnnualEur: number;
    belowThreshold: number;
    over50WithTender: number;
  };
  hospitals: {
    eik: string;
    name: string;
    nzokEur: number;
    nzokAnnualEur: number;
    revenueEur: number | null;
    revenueYear: number | null;
    nzokShare: number | null;
    tenders3y: number;
  }[];
};

// "Публични срещу частни болници" — the ownership split of НЗОК hospital money
// plus the 50%-threshold / no-tenders headline the EC lawsuit is about.
export const nzokPublicPrivate = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<PublicPrivateFile>(
    "/budget/nzok/public_private.json",
  );
  const order = ["state", "municipal", "private"] as const;
  const label: Record<(typeof order)[number], string> = {
    state: bg ? "Държавни" : "State",
    municipal: bg ? "Общински" : "Municipal",
    private: bg ? "Частни" : "Private",
  };
  const rows: Row[] = order.map((o) => ({
    ownership: label[o],
    hospitals: fmtInt(f.ownership[o].count, ctx.lang),
    nzok: fmtEurCompact(f.ownership[o].nzokEur, ctx.lang),
    share: `${f.ownership[o].sharePct}%`,
  }));
  const columns: Column[] = [
    { key: "ownership", label: bg ? "Собственост" : "Ownership" },
    { key: "hospitals", label: bg ? "Болници" : "Hospitals", numeric: true },
    { key: "nzok", label: bg ? "НЗОК плащания" : "НЗОК paid", numeric: true },
    { key: "share", label: bg ? "Дял" : "Share", numeric: true },
  ];
  const s = f.privateStats;
  return {
    tool: "nzokPublicPrivate",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? "Публични срещу частни болници (НЗОК)"
      : "Public vs private hospitals (НЗОК)",
    subtitle: bg
      ? "Частните болници с над 50% публично финансиране не обявяват обществени поръчки — казусът, по който ЕК съди България (Директива 2014/24/ЕС)."
      : "Private hospitals with >50% public funding run no public tenders — the EC lawsuit (Directive 2014/24/ЕС).",
    columns,
    rows,
    categories: order.map((o) => label[o]),
    series: [
      {
        key: "nzok",
        label: bg ? "НЗОК плащания (€)" : "НЗОК paid (€)",
        points: order.map((o) => ({
          x: label[o],
          y: Math.round(f.ownership[o].nzokEur),
        })),
      },
    ],
    viz: "bar",
    facts: {
      as_of: f.asOf,
      private_share: `${f.ownership.private.sharePct}%`,
      private_nzok: fmtEurCompact(f.ownership.private.nzokEur, ctx.lang),
      private_hospitals: fmtInt(f.ownership.private.count, ctx.lang),
      over_50pct_publicly_funded: `${s.over50Pct}%`,
      median_public_funding: `${s.medianSharePct}%`,
      private_running_no_tenders: `${s.zeroTender}/${s.total}`,
      over_50pct_and_no_tenders: fmtInt(s.over50NoTender, ctx.lang),
      money_outside_tender_annual: fmtEurCompact(
        s.over50NoTenderAnnualEur,
        ctx.lang,
      ),
    },
    provenance: ["budget/nzok/public_private.json"],
  };
};

// Private-hospital ranking — either by ГФО revenue ("приход на частните
// болници") or the majority-public-but-no-tenders leaderboard
// ("кои болници не правят поръчки"). arg `filter`: "notenders" | "revenue".
export const nzokPrivateHospitals = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<PublicPrivateFile>(
    "/budget/nzok/public_private.json",
  );
  const n = Math.min(Math.max(Number(args.count) || 12, 1), 25);
  const noTenders =
    String(args.filter ?? "") === "notenders" ||
    String(args.mode ?? "") === "notenders";

  const pool = noTenders
    ? f.hospitals
        .filter(
          (h) => h.nzokShare != null && h.nzokShare > 0.5 && h.tenders3y === 0,
        )
        .sort((a, b) => b.nzokEur - a.nzokEur)
    : f.hospitals
        .filter((h) => h.revenueEur != null)
        .sort((a, b) => (b.revenueEur ?? 0) - (a.revenueEur ?? 0));
  const top = pool.slice(0, n);

  const rows: Row[] = top.map((h) => ({
    hospital: h.name,
    revenue: h.revenueEur != null ? fmtEurCompact(h.revenueEur, ctx.lang) : "—",
    nzok: fmtEurCompact(h.nzokEur, ctx.lang),
    share: h.nzokShare != null ? `${Math.round(h.nzokShare * 100)}%` : "—",
    tenders:
      h.tenders3y > 0 ? fmtInt(h.tenders3y, ctx.lang) : bg ? "няма" : "none",
  }));
  const columns: Column[] = [
    { key: "hospital", label: bg ? "Болница" : "Hospital" },
    {
      key: "revenue",
      label: bg ? "Приход (ГФО)" : "Revenue (ГФО)",
      numeric: true,
    },
    { key: "nzok", label: bg ? "НЗОК" : "НЗОК", numeric: true },
    { key: "share", label: bg ? "Публично" : "Public", numeric: true },
    { key: "tenders", label: bg ? "Поръчки 3г." : "Tenders 3y", numeric: true },
  ];
  const biggest = top[0];
  return {
    tool: "nzokPrivateHospitals",
    domain: "fiscal",
    kind: "table",
    title: noTenders
      ? bg
        ? "Частни болници над 50% публични — без нито една поръчка"
        : "Private hospitals >50% public — with zero tenders"
      : bg
        ? "Частни болници по приход (ГФО)"
        : "Private hospitals by revenue (ГФО)",
    subtitle: bg
      ? "Приходите са от годишните финансови отчети (ГФО) в Търговския регистър; „Публично“ = НЗОК ÷ приход."
      : "Revenue from annual ГФО in the Commerce Register; “Public” = НЗОК ÷ revenue.",
    columns,
    rows,
    categories: top.map((h) => h.name),
    series: [
      {
        key: noTenders ? "nzok" : "revenue",
        label: noTenders
          ? bg
            ? "НЗОК (€)"
            : "НЗОК (€)"
          : bg
            ? "Приход (€)"
            : "Revenue (€)",
        points: top.map((h) => ({
          x: h.name,
          y: Math.round((noTenders ? h.nzokEur : (h.revenueEur ?? 0)) || 0),
        })),
      },
    ],
    viz: "bar",
    facts: {
      as_of: f.asOf,
      count: fmtInt(pool.length, ctx.lang),
      top_hospital: biggest?.name ?? "—",
      ...(biggest?.revenueEur != null
        ? { top_revenue: fmtEurCompact(biggest.revenueEur, ctx.lang) }
        : {}),
      ...(biggest?.nzokShare != null
        ? { top_public_share: `${Math.round(biggest.nzokShare * 100)}%` }
        : {}),
      ...(biggest?.eik ? { eik_id: biggest.eik } : {}),
    },
    provenance: ["budget/nzok/public_private.json"],
  };
};
