import { validateFundingQuery, type FundingArgs } from "../../fundingQuery";
import type { QuestionDefinition } from "../types";
export const FUNDING_TEMPLATES: {
  id: string;
  bg: string;
  en: string;
  query: FundingArgs | null;
}[] = [
  {
    id: "S01",
    bg: "Колко проекта по ИСУН има по програми 2021–2027?",
    en: "How many ISUN projects are in 2021–2027 programmes?",
    query: {
      corpus: "isunProjects",
      operation: "count",
      programmingPeriods: ["2021-2027"],
    },
  },
  {
    id: "S02",
    bg: "Кои са най-големите бенефициенти по размер на безвъзмездната помощ по ИСУН?",
    en: "Which ISUN beneficiaries have the largest grants?",
    query: {
      corpus: "isunProjects",
      operation: "rank",
      metric: "amount",
      groupBy: "entity",
    },
  },
  {
    id: "S03",
    bg: "Какъв е размерът на безвъзмездната помощ за проекти за здравеопазване по ИСУН?",
    en: "How much grant funding do ISUN healthcare projects have?",
    query: {
      corpus: "isunProjects",
      operation: "sum",
      metric: "amount",
      themeIds: ["health"],
    },
  },
  {
    id: "S04",
    bg: "Покажи проектите по ИСУН за пътища с обща стойност над 1 млн. евро.",
    en: "Show ISUN road projects with total cost above €1 million.",
    query: {
      corpus: "isunProjects",
      operation: "list",
      themeIds: ["roads"],
      amountBasis: "projectCost",
      amountMin: 1000000,
      amountMinRelation: "gt",
    },
  },
  {
    id: "S05",
    bg: "Какъв е делът на изплатеното спрямо безвъзмездната помощ по програми в ИСУН?",
    en: "What is cumulative paid funding as a share of grants by ISUN programme?",
    query: {
      corpus: "isunProjects",
      operation: "share",
      metric: "paidRatio",
      groupBy: "programme",
    },
  },
  {
    id: "S06",
    bg: "Кои програми по ИСУН имат най-висока концентрация на безвъзмездна помощ по бенефициент?",
    en: "Which ISUN programmes have the highest beneficiary concentration by grant value?",
    query: {
      corpus: "isunProjects",
      operation: "rank",
      metric: "hhi",
      groupBy: "programme",
      minGroupCount: 5,
    },
  },
  {
    id: "S07",
    bg: "Покажи проектите по ИСУН за изпълнение в община Русе.",
    en: "Show ISUN projects implemented in Ruse municipality.",
    query: {
      corpus: "isunProjects",
      operation: "list",
      placeIds: ["RSE27"],
      placeBasis: "implementation",
    },
  },
  {
    id: "S08",
    bg: "Колко договора по ИСУН са подписани през 2026?",
    en: "How many ISUN agreements were signed in 2026?",
    query: null,
  },
  {
    id: "S09",
    bg: "Колко земеделски субсидии са изплатени за финансова 2025 година?",
    en: "How much in farm subsidies was paid for financial year 2025?",
    query: {
      corpus: "agriPayments",
      operation: "sum",
      metric: "amount",
      financialYears: ["2025"],
    },
  },
  {
    id: "S10",
    bg: "Кои юридически лица са получили най-много земеделски субсидии за финансова 2025 година?",
    en: "Which legal entities received the most farm subsidies for financial year 2025?",
    query: {
      corpus: "agriPayments",
      operation: "rank",
      metric: "amount",
      groupBy: "entity",
      entityClass: "legal",
      financialYears: ["2025"],
    },
  },
  {
    id: "S11",
    bg: "Разпредели земеделските субсидии за финансова 2025 година по схеми.",
    en: "Break down farm subsidies for financial year 2025 by scheme.",
    query: {
      corpus: "agriPayments",
      operation: "rank",
      metric: "amount",
      groupBy: "scheme",
      financialYears: ["2025"],
    },
  },
  {
    id: "S12",
    bg: "Сравни земеделските субсидии за финансови 2024 и 2025 години.",
    en: "Compare farm subsidies for financial years 2024 and 2025.",
    query: {
      corpus: "agriPayments",
      operation: "compare",
      metric: "amount",
      financialYears: ["2024"],
      compareFinancialYears: ["2025"],
    },
  },
  {
    id: "S13",
    bg: "Колко земеделски субсидии е получил ЕИК {eik} за финансова {year} година по схема {scheme}?",
    en: "How much did EIK {eik} receive for financial year {year} under scheme {scheme}?",
    query: null,
  },
  {
    id: "S14",
    bg: "Какъв дял от субсидиите за юридически лица получават десетте най-големи получатели през финансова 2025 година?",
    en: "What share of legal-entity subsidies goes to the ten largest recipients in financial year 2025?",
    query: {
      corpus: "agriPayments",
      operation: "share",
      metric: "topShare",
      entityClass: "legal",
      topN: 10,
      financialYears: ["2025"],
    },
  },
  {
    id: "S15",
    bg: "Покажи юридическите получатели на земеделски субсидии с установена връзка с публични фигури за финансова 2025 година.",
    en: "Show legal farm-subsidy recipients with documented public-figure links for financial year 2025.",
    query: {
      corpus: "agriPayments",
      operation: "list",
      entityClass: "legal",
      basePredicates: ["political"],
      financialYears: ["2025"],
    },
  },
  {
    id: "S16",
    bg: "Разпредели земеделските субсидии по област на получателя за финансова 2025 година.",
    en: "Break down farm subsidies by recipient region for financial year 2025.",
    query: {
      corpus: "agriPayments",
      operation: "rank",
      metric: "amount",
      groupBy: "place",
      financialYears: ["2025"],
    },
  },
  {
    id: "S17",
    bg: "Колко операции по Interreg има за програмен период 2021–2027?",
    en: "How many Interreg operations are in the 2021–2027 programming period?",
    query: {
      corpus: "interregOperations",
      operation: "count",
      programmingPeriods: ["2021-2027"],
    },
  },
  {
    id: "S18",
    bg: "Какъв е публикуваният бюджет на българските партньори по Interreg за период 2021–2027?",
    en: "What is the published budget of Bulgarian Interreg partners in 2021–2027?",
    query: {
      corpus: "interregPartners",
      operation: "sum",
      metric: "amount",
      basePredicates: ["bulgarian"],
      programmingPeriods: ["2021-2027"],
    },
  },
  {
    id: "S19",
    bg: "Покажи операциите по Interreg, започнали през 2026.",
    en: "Show Interreg operations starting in 2026.",
    query: {
      corpus: "interregOperations",
      operation: "list",
      dateBasis: "start",
      from: "2026-01-01",
      toExclusive: "2027-01-01",
    },
  },
  {
    id: "S20",
    bg: "Покажи операциите по Interreg с крайна дата през 2026.",
    en: "Show Interreg operations with end dates in 2026.",
    query: {
      corpus: "interregOperations",
      operation: "list",
      dateBasis: "end",
      from: "2026-01-01",
      toExclusive: "2027-01-01",
    },
  },
  {
    id: "S21",
    bg: "Кои български партньори по Interreg имат най-голям публикуван бюджет?",
    en: "Which Bulgarian Interreg partners have the largest published budgets?",
    query: {
      corpus: "interregPartners",
      operation: "rank",
      metric: "amount",
      groupBy: "entity",
      basePredicates: ["bulgarian"],
    },
  },
  {
    id: "S22",
    bg: "Какъв дял от българските партньорства по Interreg нямат публикуван бюджет?",
    en: "What share of Bulgarian Interreg partnerships have unpublished budgets?",
    query: {
      corpus: "interregPartners",
      operation: "share",
      basePredicates: ["bulgarian"],
      numeratorPredicates: ["unpublishedBudget"],
      denominator: "evaluable",
    },
  },
  {
    id: "S23",
    bg: "Покажи водещите български партньори по Interreg Румъния–България за 2021–2027.",
    en: "Show Bulgarian lead partners in Interreg Romania–Bulgaria for 2021–2027.",
    query: {
      corpus: "interregPartners",
      operation: "list",
      basePredicates: ["bulgarian", "lead"],
      programmingPeriods: ["2021-2027"],
      programmeIds: ["INTERREG-ROBG-2127"],
    },
  },
  {
    id: "S24",
    bg: "Покажи партньорствата по Interreg с партньори от община Русе.",
    en: "Show Interreg partnerships with partners based in Ruse municipality.",
    query: {
      corpus: "interregPartners",
      operation: "list",
      placeIds: ["RSE27"],
      placeBasis: "partner",
    },
  },
];

export function fundingTemplate(
  id: string,
  lang: "bg" | "en",
  values: Record<string, unknown> = {},
) {
  const t = FUNDING_TEMPLATES.find((t) => "funding-query-" + t.id === id);
  if (!t) throw Error("Unknown funding template");
  if (t.id === "S13") {
    const eik = String(values.eik || ""),
      scheme = String(values.scheme || ""),
      year = String(values.year || "");
    const text = t[lang]
      .replace("{eik}", eik || "{eik}")
      .replace("{year}", year || "{year}")
      .replace("{scheme}", scheme || "{scheme}");
    if (!eik || !scheme || !year)
      return { text, tool: "fundingQuestion", args: { question: text } };
    const p = validateFundingQuery({
      corpus: "agriPayments",
      operation: "sum",
      metric: "amount",
      entityIds: [eik],
      schemeIds: [scheme],
      financialYears: [year],
    });
    if (!p.ok) throw Error(JSON.stringify(p.errors));
    return { text, tool: "fundingQuery", args: p.query };
  }
  let text = t[lang];
  const args = { ...t.query };
  if (values.year !== undefined) {
    const year = Number(values.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      throw Error("Invalid financial year");
    args.financialYears = [String(year)];
    text = text.replace(/2025/g, String(year));
  }
  if (values.period !== undefined) {
    args.programmingPeriods = [String(values.period)];
    text = text.replace(/2021[–-]2027/g, String(values.period));
  }
  if (!t.query)
    return { text, tool: "fundingQuestion", args: { question: text } };
  const parsed = validateFundingQuery(args);
  if (!parsed.ok) throw Error(JSON.stringify(parsed.errors));
  return { text, tool: "fundingQuery", args: parsed.query };
}
export const FUNDING_QUESTIONS: QuestionDefinition[] = FUNDING_TEMPLATES.map(
  (t) => ({
    id: "funding-query-" + t.id,
    categoryId: "funds",
    subcategoryId: "projects",
    question: { bg: t.bg, en: t.en },
    aliases: {},
    parameters:
      t.id === "S13"
        ? [
            {
              id: "eik",
              kind: "company",
              required: true,
              label: { bg: "ЕИК на получателя", en: "Recipient EIK" },
            },
            {
              id: "year",
              kind: "year",
              required: true,
              min: 2000,
              max: 2100,
              label: { bg: "Финансова година", en: "Financial year" },
            },
            {
              id: "scheme",
              kind: "string",
              required: true,
              label: { bg: "Код на схемата", en: "Scheme code" },
            },
          ]
        : t.query?.financialYears && !t.query.compareFinancialYears
          ? [
              {
                id: "year",
                kind: "year",
                required: true,
                label: { bg: "Финансова година", en: "Financial year" },
                min: 2000,
                max: 2100,
              },
            ]
          : t.query?.programmingPeriods
            ? [
                {
                  id: "period",
                  kind: "enum",
                  required: true,
                  label: { bg: "Програмен период", en: "Programming period" },
                  values: ["2007-2013", "2014-2020", "2021-2027"],
                },
              ]
            : [],
    defaults:
      t.query?.financialYears && !t.query.compareFinancialYears
        ? { year: 2025 }
        : t.query?.programmingPeriods
          ? { period: "2021-2027" }
          : {},
    chat: {
      status: "ready",
      capabilityId: t.query ? "fundingQuery" : "fundingQuestion",
      version: 1,
    },
    sql: { status: "unavailable" },
    sourceIds: ["db:funding-query"],
  }),
);
