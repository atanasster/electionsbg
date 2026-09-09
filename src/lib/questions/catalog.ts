import rawCategories from "../../../ai/app/starterCategories.json";
import rawPrompts from "../../../ai/app/starterPrompts.json";
import type {
  LocalizedText,
  QuestionCatalog,
  QuestionCategory,
  QuestionDefinition,
  QuestionParameter,
  QuestionParameterKind,
} from "./types";
import { REVIEWED_CHAT_SQL_ADAPTERS } from "./sql/availability";

type RawPrompt = (typeof rawPrompts)[number];

const labels: Record<string, LocalizedText> = {
  a: { bg: "Първа стойност", en: "First value" },
  b: { bg: "Втора стойност", en: "Second value" },
  agency: { bg: "Агенция", en: "Agency" },
  oblast: { bg: "Област или МИР", en: "Oblast or district" },
  party: { bg: "Партия", en: "Party" },
  place: { bg: "Място", en: "Place" },
  section: { bg: "Секция", en: "Polling section" },
  year: { bg: "Година", en: "Year" },
  years: { bg: "Брой години", en: "Number of years" },
  name: { bg: "Име", en: "Name" },
  company: { bg: "Фирма", en: "Company" },
};

const labelFor = (id: string): LocalizedText =>
  labels[id] ?? { bg: id, en: id };

const requiredByTool: Record<string, string[]> = {
  partyResult: ["party"],
  candidateResult: ["name"],
  agencyProfile: ["agency"],
  agencyPolls: ["agency"],
  agencyAccuracyHistory: ["agency"],
  municipalityWinners: ["oblast"],
  settlementWinners: ["place"],
  sectionWinners: ["place"],
  sectionResults: ["section"],
  sectionRiskHistory: ["section"],
  settlementResults: ["place"],
  settlementHistory: ["place"],
  municipalityResults: ["place"],
  municipalityHistory: ["place"],
  regionResults: ["oblast"],
  regionResultsTrend: ["oblast"],
  regionHistory: ["oblast"],
  localOblastMayors: ["place"],
  localMunicipality: ["place"],
  localMayorRace: ["place"],
  localMayorHistory: ["place"],
  localSubMayors: ["place"],
  localCouncil: ["place"],
  simulateTaxChange: ["change"],
  budgetFunction: ["category"],
  partyFinance: ["party"],
  companyConnections: ["company"],
  euComparison: ["indicator"],
  subnationalIndicator: ["place"],
  regionIndicator: ["oblast"],
  localTaxes: ["place"],
  settlementPrices: ["place"],
  chainProfile: ["chain"],
  governanceProfile: ["place"],
  comparePlaces: ["a", "b"],
  census: ["place"],
  procurementBySettlement: ["place"],
  myAreaAlerts: ["place"],
  councilResolutions: ["place"],
  partyDemographics: ["party"],
  mpVotingProfile: ["name"],
  mpSimilarity: ["name"],
  partyMps: ["party"],
};

const parameterKind = (tool: string, id: string): QuestionParameterKind => {
  if (tool === "comparePlaces" && (id === "a" || id === "b")) return "place";
  if (tool === "compareElections" && (id === "a" || id === "b"))
    return "election";
  if (id === "year") return "year";
  if (/^(years|n|count|limit)$/.test(id)) return "number";
  if (/(^|_)(date|from|to)($|_)/.test(id)) return "date";
  if (/election|^a$|^b$/.test(id)) return "election";
  if (/place|region|municipality|settlement|section|oblast/.test(id))
    return "place";
  if (/person|candidate|^mp$/.test(id)) return "person";
  if (/eik|company|contractor|entity/.test(id)) return "company";
  return "string";
};

const parametersFor = (prompt: RawPrompt): QuestionParameter[] => {
  const ids = [
    ...new Set(Object.values(prompt.args).flatMap((args) => Object.keys(args))),
  ];
  const required = new Set(requiredByTool[prompt.tool] ?? []);
  return ids.map((id) => {
    const kind = parameterKind(prompt.tool, id);
    return {
      id,
      kind,
      required: required.has(id),
      label: labelFor(id),
      ...(kind === "year" ? { min: 1900, max: 2100 } : {}),
      ...(/^(years|n|count|limit)$/.test(id) ? { min: 1, max: 5000 } : {}),
    };
  });
};

const canonicalDefaults = (prompt: RawPrompt): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(prompt.args.bg).filter(
      ([key, value]) =>
        JSON.stringify(value) ===
        JSON.stringify((prompt.args.en as Record<string, unknown>)[key]),
    ),
  );

export const QUESTION_CATEGORIES: QuestionCategory[] = [
  ...rawCategories.map((category) => ({
    id: category.id,
    label: { bg: category.bg, en: category.en },
    subcategories: category.subcategories.map((subcategory) => ({
      id: subcategory.id,
      label: { bg: subcategory.bg, en: subcategory.en },
    })),
  })),
  {
    id: "data-coverage",
    label: { bg: "Данни и покритие", en: "Data and coverage" },
    utility: true,
    subcategories: [
      { id: "search", label: { bg: "Търсене", en: "Search" } },
      {
        id: "freshness",
        label: { bg: "Актуалност", en: "Freshness" },
      },
      { id: "coverage", label: { bg: "Обхват", en: "Coverage" } },
    ],
  },
];

export const QUESTION_DEFINITIONS: QuestionDefinition[] = rawPrompts.map(
  (prompt) => {
    const sqlCapabilityId = REVIEWED_CHAT_SQL_ADAPTERS[prompt.id];
    return {
      id: prompt.id,
      categoryId: prompt.category,
      subcategoryId: prompt.subcategory,
      question: { bg: prompt.bg, en: prompt.en },
      aliases: {},
      parameters: parametersFor(prompt),
      defaults: canonicalDefaults(prompt),
      legacyChatArgs: prompt.args,
      chat: { status: "ready", capabilityId: prompt.tool },
      sql: sqlCapabilityId
        ? { status: "ready", capabilityId: sqlCapabilityId, version: 1 }
        : {
            status: "review",
            reason: {
              bg: "SQL вариантът още не е проверен.",
              en: "The SQL version has not been reviewed yet.",
            },
          },
      sourceIds: [],
    };
  },
);

export const QUESTION_CATALOG: QuestionCatalog = {
  categories: QUESTION_CATEGORIES,
  questions: QUESTION_DEFINITIONS,
};

export const questionById = (id: string): QuestionDefinition | undefined =>
  QUESTION_DEFINITIONS.find((question) => question.id === id);
