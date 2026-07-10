// Съдебна власт (judiciary) tools. Four of them, over two committed artifacts:
//
//   judiciaryBudget       /budget/vss/budget.json      — the ЗДБРБ „Бюджет на
//                                                        съдебната власт" article:
//                                                        per-body spend + own revenue
//   judiciaryCaseload     /judiciary/caseload.json     — cases filed/resolved/pending
//   judiciaryWorkload     /judiciary/caseload.json     — both official workload measures
//   judiciaryDeclarations /judiciary/declarations.json — the ИВСС register index +
//                                                        its non-compliance lists
//
// Amounts are in EUR. Mirrors the fiscal/НЗОК tools' Envelope shape; every fact
// goes through ctx.lang, and the tool never computes prose numbers — narrate()
// reads env.facts.
//
// The declarations tool reports the register INDEX (who filed, when) and what the
// ИВСС itself publishes about non-compliance. It never reports the contents of a
// declaration, and never infers anything about an individual's wealth.

import { fetchData } from "./dataClient";
import { fmtEurCompact, fmtInt } from "./format";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

type Money = { amountEur: number; amount: number; currency: string };

/** Resolve a requested year against the years an artifact actually has.
 *
 *  Falling back to the latest year answers a question the user did not ask —
 *  "бюджетът през 2015" would silently return 2025. When the asked-for year is
 *  absent we say so, and name the range that IS available. `null` request →
 *  newest, which is the sensible default for a bare question. */
const pickYear = <T>(
  years: T[],
  yearOf: (y: T) => number,
  want: unknown,
): { year: T | null; missing: number | null; first: number; last: number } => {
  // An empty artifact would make Math.min/max return ±Infinity and the envelope
  // would tell the reader the data covers "Infinity–-Infinity".
  if (!years.length) return { year: null, missing: null, first: 0, last: 0 };
  const sorted = years.map(yearOf);
  const first = Math.min(...sorted);
  const last = Math.max(...sorted);
  // `Number(null)` and `Number("")` are both 0 — finite — so an explicit null from
  // the LLM tool-call path (where an optional param is commonly filled with null)
  // would ask for "year 0" and get "Няма данни за 0 г.". Treat absent as absent,
  // as ai/tools/fiscal.ts already does.
  const w = want == null || want === "" ? NaN : Number(want);
  if (!Number.isFinite(w))
    return { year: years[0] ?? null, missing: null, first, last };
  const hit = years.find((y) => yearOf(y) === w);
  return hit
    ? { year: hit, missing: null, first, last }
    : { year: null, missing: w, first, last };
};

/** One decimal, localised — the grain the ВСС itself publishes its load figures at. */
const n1 = (v: number, lang: ToolContext["lang"]) =>
  v.toLocaleString(lang, { maximumFractionDigits: 1 });

/** The "you asked for a year we don't have" envelope. */
const noYearEnvelope = (
  tool: string,
  domain: Envelope["domain"],
  provenance: string[],
  missing: number,
  first: number,
  last: number,
  lang: ToolContext["lang"],
): Envelope => ({
  tool,
  domain,
  kind: "scalar",
  title:
    lang === "bg"
      ? `Няма данни за ${missing} г. (наличните години са ${first}–${last})`
      : `No data for ${missing} (available years are ${first}–${last})`,
  viz: "none",
  facts: { requested_year: missing, first_year: first, last_year: last },
  provenance,
});

type JudiciaryBudgetLine = {
  id: string;
  bg: string;
  en: string;
  amount: Money;
};
type JudiciaryBudgetYear = {
  fiscalYear: number;
  basis: "law";
  totalRevenue: Money;
  totalExpenditure: Money;
  bodies: JudiciaryBudgetLine[];
  revenue: JudiciaryBudgetLine[];
};
type JudiciaryBudgetFile = {
  latestYear: number;
  years: JudiciaryBudgetYear[]; // descending by fiscalYear
};

// "Къде отиват парите на съдебната власт?" — the per-body expenditure split plus
// the self-financing ratio (съдебни такси against the judiciary's own costs),
// both printed in the State Budget Law and published nowhere else together.
export const judiciaryBudget = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<JudiciaryBudgetFile>("/budget/vss/budget.json");
  const picked = pickYear(f.years, (y) => y.fiscalYear, args.year);
  if (picked.missing != null)
    return noYearEnvelope(
      "judiciaryBudget",
      "fiscal",
      ["budget/vss/budget.json"],
      picked.missing,
      picked.first,
      picked.last,
      ctx.lang,
    );
  const year = picked.year;
  if (!year) {
    return {
      tool: "judiciaryBudget",
      domain: "fiscal",
      kind: "scalar",
      title: bg
        ? "Няма данни за бюджета на съдебната власт"
        : "No judiciary budget data",
      viz: "none",
      facts: {},
      provenance: ["budget/vss/budget.json"],
    };
  }

  const total = year.totalExpenditure.amountEur;
  const revenue = year.totalRevenue.amountEur;
  const bodies = [...year.bodies]
    .map((b) => ({ label: bg ? b.bg : b.en, eur: b.amount.amountEur }))
    .filter((b) => b.eur > 0)
    .sort((a, b) => b.eur - a.eur);
  const biggest = bodies[0];
  const courtFees =
    year.revenue.find((r) => r.id === "courtFees")?.amount.amountEur ?? 0;
  const selfFinance = total > 0 ? round2((100 * revenue) / total) : 0;

  const rows: Row[] = bodies.map((b) => ({
    body: b.label,
    amount: fmtEurCompact(b.eur, ctx.lang),
    share: total > 0 ? round2((100 * b.eur) / total) : 0,
  }));
  const columns: Column[] = [
    { key: "body", label: bg ? "Орган" : "Body" },
    { key: "amount", label: bg ? "Разход" : "Spend", numeric: true },
    { key: "share", label: "%", numeric: true, format: "pct" },
  ];

  return {
    tool: "judiciaryBudget",
    domain: "fiscal",
    kind: "table",
    title: bg
      ? `Бюджетът на съдебната власт по органи (${year.fiscalYear})`
      : `The judiciary's budget by spending body (${year.fiscalYear})`,
    subtitle: bg
      ? "Разходи по органи, приети със Закона за държавния бюджет"
      : "Per-body expenditure as adopted in the State Budget Law",
    columns,
    rows,
    categories: bodies.map((b) => b.label),
    series: [
      {
        key: "amount",
        label: bg ? "Разход (€)" : "Spend (€)",
        points: bodies.map((b) => ({ x: b.label, y: Math.round(b.eur) })),
      },
    ],
    viz: "bar",
    facts: {
      year: year.fiscalYear,
      total: fmtEurCompact(total, ctx.lang),
      biggest_body: biggest?.label ?? "—",
      biggest_amount: biggest ? fmtEurCompact(biggest.eur, ctx.lang) : "—",
      biggest_share:
        biggest && total > 0 ? `${round2((100 * biggest.eur) / total)}%` : "—",
      own_revenue: fmtEurCompact(revenue, ctx.lang),
      court_fees: fmtEurCompact(courtFees, ctx.lang),
      self_financing: `${selfFinance}%`,
      bodies: bodies.length,
    },
    provenance: ["budget/vss/budget.json"],
  };
};

// ---- caseload, delays and workload (ВСС annual statistical tables) -----------

type JudiciaryTier = {
  id: string;
  bg: string;
  en: string;
  filed: number;
  resolved: number;
  withinDeadlinePct: number;
  pendingEnd: number;
  judges: number;
  loadPerPostToConsider: number;
  actualLoadToConsider: number;
};
type JudiciaryYear = {
  year: number;
  tiers: JudiciaryTier[];
  total: JudiciaryTier;
};
type JudiciaryCaseloadFile = {
  latestYear: number;
  years: JudiciaryYear[]; // descending
};

// "Колко дела влизат в съдилищата и колко излизат?" — the movement of cases per
// court tier, with the clearance rate that says whether the backlog grows.
export const judiciaryCaseload = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<JudiciaryCaseloadFile>("/judiciary/caseload.json");
  const picked = pickYear(f.years, (y) => y.year, args.year);
  if (picked.missing != null)
    return noYearEnvelope(
      "judiciaryCaseload",
      "indicators",
      ["judiciary/caseload.json"],
      picked.missing,
      picked.first,
      picked.last,
      ctx.lang,
    );
  const year = picked.year;
  if (!year) {
    return {
      tool: "judiciaryCaseload",
      domain: "indicators",
      kind: "scalar",
      title: bg ? "Няма данни за делата" : "No caseload data",
      viz: "none",
      facts: {},
      provenance: ["judiciary/caseload.json"],
    };
  }

  const t = year.total;
  const clearance = t.filed > 0 ? round2((100 * t.resolved) / t.filed) : 0;
  // The most-loaded tier by actual (not nominal) workload — the honest read.
  const busiest = [...year.tiers].sort(
    (a, b) => b.actualLoadToConsider - a.actualLoadToConsider,
  )[0];

  const rows: Row[] = year.tiers.map((x) => ({
    tier: bg ? x.bg : x.en,
    filed: fmtInt(x.filed, ctx.lang),
    resolved: fmtInt(x.resolved, ctx.lang),
    clearance: x.filed > 0 ? round2((100 * x.resolved) / x.filed) : 0,
    pending: fmtInt(x.pendingEnd, ctx.lang),
  }));
  const columns: Column[] = [
    { key: "tier", label: bg ? "Съдилища" : "Courts" },
    { key: "filed", label: bg ? "Постъпили" : "Filed", numeric: true },
    { key: "resolved", label: bg ? "Свършени" : "Resolved", numeric: true },
    {
      key: "clearance",
      label: bg ? "Приключваемост" : "Clearance",
      numeric: true,
      format: "pct",
    },
    { key: "pending", label: bg ? "Висящи" : "Pending", numeric: true },
  ];

  return {
    tool: "judiciaryCaseload",
    domain: "indicators",
    kind: "table",
    title: bg
      ? `Движение на делата в съдилищата (${year.year})`
      : `The movement of cases through the courts (${year.year})`,
    subtitle: bg
      ? "Постъпили, свършени и висящи дела по съдебен ред"
      : "Cases filed, resolved and pending by court tier",
    columns,
    rows,
    categories: year.tiers.map((x) => (bg ? x.bg : x.en)),
    series: [
      {
        key: "filed",
        label: bg ? "Постъпили дела" : "Cases filed",
        points: year.tiers.map((x) => ({
          x: bg ? x.bg : x.en,
          y: x.filed,
        })),
      },
    ],
    viz: "bar",
    facts: {
      year: year.year,
      filed: fmtInt(t.filed, ctx.lang),
      resolved: fmtInt(t.resolved, ctx.lang),
      clearance: `${clearance}%`,
      within_deadline: `${t.withinDeadlinePct}%`,
      pending: fmtInt(t.pendingEnd, ctx.lang),
      judges: fmtInt(t.judges, ctx.lang),
      busiest_tier: busiest ? (bg ? busiest.bg : busiest.en) : "—",
      busiest_load: busiest
        ? busiest.actualLoadToConsider.toLocaleString(ctx.lang, {
            maximumFractionDigits: 1,
          })
        : "—",
    },
    provenance: ["judiciary/caseload.json"],
  };
};

// "Колко натоварени са съдиите?" — both official measures side by side, per tier.
export const judiciaryWorkload = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<JudiciaryCaseloadFile>("/judiciary/caseload.json");
  const picked = pickYear(f.years, (y) => y.year, args.year);
  if (picked.missing != null)
    return noYearEnvelope(
      "judiciaryWorkload",
      "indicators",
      ["judiciary/caseload.json"],
      picked.missing,
      picked.first,
      picked.last,
      ctx.lang,
    );
  const year = picked.year;
  if (!year) {
    return {
      tool: "judiciaryWorkload",
      domain: "indicators",
      kind: "scalar",
      title: bg ? "Няма данни за натовареността" : "No workload data",
      viz: "none",
      facts: {},
      provenance: ["judiciary/caseload.json"],
    };
  }

  const tiers = [...year.tiers].sort(
    (a, b) => b.actualLoadToConsider - a.actualLoadToConsider,
  );
  const busiest = tiers[0];
  const quietest = tiers[tiers.length - 1];

  const rows: Row[] = tiers.map((x) => ({
    tier: bg ? x.bg : x.en,
    judges: fmtInt(x.judges, ctx.lang),
    perPost: n1(x.loadPerPostToConsider, ctx.lang),
    actual: n1(x.actualLoadToConsider, ctx.lang),
  }));
  const columns: Column[] = [
    { key: "tier", label: bg ? "Съдилища" : "Courts" },
    {
      key: "judges",
      label: bg ? "Съдии по щат" : "Judge posts",
      numeric: true,
    },
    { key: "perPost", label: bg ? "По щат" : "Per post", numeric: true },
    { key: "actual", label: bg ? "Действителна" : "Actual", numeric: true },
  ];

  return {
    tool: "judiciaryWorkload",
    domain: "indicators",
    kind: "table",
    title: bg
      ? `Натовареност на съдиите по съдебен ред (${year.year})`
      : `Judges' workload by court tier (${year.year})`,
    subtitle: bg
      ? "Дела за разглеждане на съдия месечно: по щат и действителна (спрямо отработени човекомесеци)"
      : "Cases per judge per month: per allocated post and actual (per person-month worked)",
    columns,
    rows,
    categories: tiers.map((x) => (bg ? x.bg : x.en)),
    series: [
      {
        key: "actual",
        label: bg ? "Действителна натовареност" : "Actual workload",
        points: tiers.map((x) => ({
          x: bg ? x.bg : x.en,
          y: Math.round(x.actualLoadToConsider * 10) / 10,
        })),
      },
    ],
    viz: "bar",
    facts: {
      year: year.year,
      judges: fmtInt(year.total.judges, ctx.lang),
      national_per_post: n1(year.total.loadPerPostToConsider, ctx.lang),
      national_actual: n1(year.total.actualLoadToConsider, ctx.lang),
      busiest_tier: busiest ? (bg ? busiest.bg : busiest.en) : "—",
      busiest_load: busiest ? n1(busiest.actualLoadToConsider, ctx.lang) : "—",
      quietest_tier: quietest ? (bg ? quietest.bg : quietest.en) : "—",
      quietest_load: quietest
        ? n1(quietest.actualLoadToConsider, ctx.lang)
        : "—",
    },
    provenance: ["judiciary/caseload.json"],
  };
};

// ---- the ИВСС asset-declaration register (index, not contents) --------------

type IntegrityList = {
  id: string;
  bg: string;
  en: string;
  legalRef: string;
  year: number | null;
  people: {
    name: string;
    position: string;
    court: string;
    /** ИВСС footnote (1): the person did file, after the deadline. */
    filedLate: boolean;
  }[];
};
type DeclarationsFile = {
  latestYear: number;
  totals: {
    declarations: number;
    magistrates: number;
    firstYear: number;
    lastYear: number;
  };
  years: { year: number; declarations: number; magistrates: number }[];
  filingCalendar: {
    total: number;
    deadline: string;
    byMonth: { month: number; count: number }[];
  };
  integrity: IntegrityList[];
};

// "Подават ли магистратите декларациите си навреме?" — the register index plus
// the Inspectorate's own non-compliance lists. This tool reports WHAT was filed
// and WHEN, and whom the ИВСС names — never the contents of a declaration, and
// never an inference about any individual's wealth.
export const judiciaryDeclarations = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const f = await fetchData<DeclarationsFile>("/judiciary/declarations.json");
  if (!f.years?.length) {
    return {
      tool: "judiciaryDeclarations",
      domain: "people",
      kind: "scalar",
      title: bg ? "Няма данни за декларациите" : "No declaration data",
      viz: "none",
      facts: {},
      provenance: ["judiciary/declarations.json"],
    };
  }

  const cal = f.filingCalendar;
  const may = cal.byMonth.find((m) => m.month === 5)?.count ?? 0;
  const mayShare = cal.total > 0 ? round2((100 * may) / cal.total) : 0;
  // The ИВСС keeps FOUR lists, and only three of them are about a missed
  // deadline. The fourth (чл. 175ж, ал. 2 — "установено несъответствие,
  // неотстранено в срок") names magistrates who DID file, on time, but whose
  // declaration was found to conflict with the ИВСС's own checks. Folding it
  // into `flagged_people` would make the narration's "of whom N filed late"
  // remainder read as "the rest never filed" — a false and damaging claim about
  // named people. It gets its own fact.
  const lateLists = f.integrity.filter(
    (l) => l.id !== "discrepancy" && l.people.length > 0,
  );
  const flaggedTotal = lateLists.reduce((s, l) => s + l.people.length, 0);
  // Of those, how many the ИВСС itself marks with the "(1)" footnote — filed,
  // but after the deadline — rather than never having filed at all.
  const filedLate = lateLists.reduce(
    (s, l) => s + l.people.filter((p) => p.filedLate).length,
    0,
  );
  const discrepancyPeople =
    f.integrity.find((l) => l.id === "discrepancy")?.people.length ?? 0;

  // Each list carries its own year — the ИВСС maintains the four pages
  // separately, so a single `list_year` fact would speak falsely for three of
  // them the moment one lags behind.
  const rows: Row[] = f.integrity.map((l) => ({
    list: bg ? l.bg : l.en,
    year: l.year ?? "—",
    ref: l.legalRef,
    people: l.people.length,
  }));
  const columns: Column[] = [
    { key: "list", label: bg ? "Списък на ИВСС" : "Inspectorate list" },
    { key: "year", label: bg ? "Година" : "Year", numeric: true },
    { key: "ref", label: bg ? "Основание" : "Provision" },
    { key: "people", label: bg ? "Души" : "People", numeric: true },
  ];

  return {
    tool: "judiciaryDeclarations",
    domain: "people",
    kind: "table",
    title: bg
      ? "Имуществени декларации на магистратите (ИВСС)"
      : "Magistrates' asset declarations (Inspectorate to the SJC)",
    subtitle: bg
      ? `Индекс на регистъра ${f.totals.firstYear}–${f.totals.lastYear} и списъците на ИВСС за неизрядни декларации`
      : `Register index ${f.totals.firstYear}–${f.totals.lastYear} and the Inspectorate's non-compliance lists`,
    columns,
    rows,
    viz: "none",
    facts: {
      declarations: fmtInt(f.totals.declarations, ctx.lang),
      magistrates: fmtInt(f.totals.magistrates, ctx.lang),
      first_year: f.totals.firstYear,
      last_year: f.totals.lastYear,
      deadline: cal.deadline,
      may_share: `${mayShare}%`,
      flagged_people: flaggedTotal,
      flagged_lists: lateLists.length,
      filed_late: filedLate,
      discrepancy_people: discrepancyPeople,
    },
    provenance: ["judiciary/declarations.json"],
  };
};
