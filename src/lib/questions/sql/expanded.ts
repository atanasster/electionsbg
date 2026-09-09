import { BUDGET_QUESTIONS } from "../contracts/budget";
import { sqlInteger, sqlText } from "./literals";
import type { SqlRecipe, SqlRecipeParameter } from "./types";
export const BUDGET_SQL_RECIPES: SqlRecipe[] = BUDGET_QUESTIONS.map((s) => ({
  id: s.id,
  questionId: s.id,
  version: 1,
  label: s.en,
  answers: s.en,
  purpose: "Budget and taxes",
  parameters:
    "year" in s
      ? [
          {
            id: "year",
            kind: "year",
            required: false,
            default: s.year,
            min: 1990,
            max: 2100,
          },
        ]
      : [],
  relations: [s.relation],
  outputColumns: ["data"],
  build: (p) => {
    const year =
      "year" in s ? sqlInteger(p.year ?? s.year, "year", 1990, 2100) : "NULL";
    const args =
      s.id === "budgetVariance"
        ? `${year}, 20`
        : s.id === "budgetMinistries" || s.id === "budgetMunicipalTransfers"
          ? `${year}, NULL, 300`
          : s.id === "budgetInvestmentPayments"
            ? "NULL, 300"
            : year;
    return `-- Published observations; NULL is unpublished, not zero. Coverage and basis are included.\nSELECT ${s.relation}(${args}) AS data;`;
  },
}));
export const EXTRA_SQL_QUESTIONS = [
  {
    id: "budget-programme-detail",
    category: "public-money",
    leaf: "ministries",
    bg: "Какви са програмите, планът и изпълнението на министерството?",
    en: "What are a ministry’s programmes, plan and execution?",
    relation: "budget_admin_detail",
    sql: "budget_admin_detail('admin-ministerstvo-na-otbranata', 2024)",
  },
  {
    id: "budget-functional-explorer",
    category: "public-money",
    leaf: "budget",
    bg: "Какви са бюджетните разходи по функции?",
    en: "What are budget expenditures by function?",
    relation: "budget_cofog_list",
    sql: "budget_cofog_list(2024, 'eur')",
  },
  {
    id: "budget-monthly-series",
    category: "public-money",
    leaf: "budget",
    bg: "Как се променят месечните бюджетни приходи и разходи?",
    en: "How do monthly budget revenues and expenditure change?",
    relation: "budget_series",
    sql: "budget_series(NULL, NULL, NULL, 'eur')",
  },
  {
    id: "budget-municipality-detail",
    category: "public-money",
    leaf: "municipal",
    bg: "Какви са трансферите и изпълнението на общинския бюджет?",
    en: "What are municipal transfers and budget execution?",
    relation: "budget_muni_detail",
    sql: "budget_muni_detail('VAR06', 2024)",
  },
  {
    id: "school-directory",
    category: "education",
    leaf: "schools",
    bg: "Кои училища имат публикувани резултати от матурите?",
    en: "Which schools have published matura results?",
    relation: "school_payloads",
    sql: "(SELECT payload FROM school_payloads WHERE kind = 'directory' AND key = '')",
  },
] as const;
/** Small table examples use a strict quoted filter and a bounded row count. */
export const TABLE_SQL_QUESTIONS = [
  [
    "school-results",
    "education",
    "schools",
    "Резултати от матури по училища",
    "Matura results by school",
    "school_scores",
  ],
  [
    "school-context",
    "education",
    "access",
    "Образователен контекст по училища",
    "School educational context",
    "school_context",
  ],
  [
    "agriculture-payments",
    "funds",
    "agriculture",
    "Земеделски субсидии по получатели",
    "Agricultural subsidies by beneficiary",
    "agri_subsidies",
  ],
  [
    "agriculture-schemes",
    "funds",
    "agriculture",
    "Земеделски схеми по години",
    "Agricultural schemes by year",
    "agri_scheme_year",
  ],
  [
    "ngo-funding",
    "business",
    "ngos",
    "Финансиране на организации с нестопанска цел",
    "Nonprofit organisation funding",
    "ngo_funding",
  ],
  [
    "retail-products",
    "cost-living",
    "basket",
    "Продукти в наблюдението на цените",
    "Products in retail price monitoring",
    "price_products",
  ],
  [
    "retail-current",
    "cost-living",
    "basket",
    "Последни наблюдавани цени",
    "Latest observed retail prices",
    "price_current",
  ],
  [
    "declaration-income",
    "business",
    "income-debt",
    "Декларирани доходи",
    "Declared income",
    "declaration_income",
  ],
  [
    "declaration-obligations",
    "business",
    "income-debt",
    "Декларирани задължения",
    "Declared obligations",
    "declaration_obligation",
  ],
  [
    "declaration-changes",
    "business",
    "changes",
    "Промени в декларациите",
    "Declaration changes",
    "declaration_event",
  ],
  [
    "council-resolutions",
    "institutions",
    "councils",
    "Решения на общинските съвети",
    "Municipal council resolutions",
    "council_resolution",
  ],
  [
    "council-votes",
    "institutions",
    "councils",
    "Гласувания в общинските съвети",
    "Municipal council votes",
    "council_vote",
  ],
  [
    "legislation-register",
    "institutions",
    "legislation",
    "Законопроекти в парламента",
    "Parliamentary bills",
    "bill",
  ],
  [
    "magistrate-assets",
    "justice-security",
    "courts",
    "Декларирани активи на магистрати",
    "Magistrate declared assets",
    "magistrate_filing_asset",
  ],
  [
    "water-operators",
    "water-environment",
    "water",
    "ВиК оператори и географски обхват",
    "Water operators and geographical coverage",
    "water_operator_geo",
  ],
  [
    "administrative-services",
    "institutions",
    "services",
    "Регистър на административните услуги",
    "Administrative services register",
    "admin_services",
  ],
  [
    "excise-warehouses",
    "public-money",
    "taxes",
    "Регистър на данъчните складове",
    "Tax warehouse register",
    "excise_warehouses",
  ],
] as const;
const yearParam: SqlRecipeParameter = {
  id: "year",
  kind: "year",
  required: true,
  default: 2024,
  min: 1990,
  max: 2100,
};
const extraParameters = (id: string): SqlRecipeParameter[] =>
  id === "budget-programme-detail"
    ? [
        {
          id: "institution",
          kind: "text",
          required: true,
          default: "admin-ministerstvo-na-otbranata",
        },
        yearParam,
      ]
    : id === "budget-municipality-detail"
      ? [
          {
            id: "municipality",
            kind: "code",
            required: true,
            default: "VAR06",
          },
          yearParam,
        ]
      : id === "budget-functional-explorer"
        ? [yearParam]
        : [];
const extraSql = (
  spec: (typeof EXTRA_SQL_QUESTIONS)[number],
  p: Record<string, string | number>,
) => {
  const year = p.year == null ? "NULL" : sqlInteger(p.year, "year", 1990, 2100);
  if (spec.id === "budget-programme-detail")
    return `budget_admin_detail(${sqlText(p.institution, "institution")}, ${year})`;
  if (spec.id === "budget-municipality-detail")
    return `budget_muni_detail(${sqlText(p.municipality, "municipality")}, ${year})`;
  if (spec.id === "budget-functional-explorer")
    return `budget_cofog_list(${year}, 'eur')`;
  return spec.sql;
};
export const EXPANDED_SQL_RECIPES: SqlRecipe[] = [
  ...EXTRA_SQL_QUESTIONS.map((s) => ({
    id: s.id,
    questionId: s.id,
    version: 1 as const,
    label: s.en,
    answers: s.en,
    purpose: s.category,
    parameters: extraParameters(s.id),
    relations: [s.relation],
    outputColumns: ["data"],
    build: (p: Record<string, string | number>) =>
      `SELECT ${extraSql(s, p)} AS data;`,
  })),
  ...TABLE_SQL_QUESTIONS.map(([id, category, , bg, en, relation]) => ({
    id,
    questionId: id,
    version: 1 as const,
    label: en,
    answers: en,
    purpose: category,
    parameters: [
      {
        id: "limit",
        kind: "integer" as const,
        required: true,
        default: 50,
        min: 1,
        max: 200,
      },
    ],
    relations: [relation],
    outputColumns: ["data"],
    build: (p: Record<string, string | number>) =>
      `-- ${bg}. A bounded sample, not a ranking or a complete aggregate.\nSELECT to_jsonb(r) AS data FROM ${relation} r\nLIMIT ${sqlInteger(p.limit ?? 50, "limit", 1, 200)};`,
  })),
];
// Kept local to avoid broad schema scans in the chat bundle.
export const expandedSqlText = (id: string) =>
  EXTRA_SQL_QUESTIONS.find((s) => s.id === id)?.bg ??
  TABLE_SQL_QUESTIONS.find((s) => s[0] === id)?.[3];
