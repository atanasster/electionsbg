import toolSourcesJson from "../../../ai/app/toolSources.json";
const toolSources: Record<string, string[]> = toolSourcesJson;
import editorialAliasesJson from "../../../ai/app/editorialAliases.json";
const editorialAliases: Record<string, string[]> = editorialAliasesJson;
import { BUDGET_QUESTIONS } from "./contracts/budget";
import { parameterLabels as labels } from "./parameterLabels";
import rawToolParameters from "../../../ai/app/toolParameters.json";
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
import {
  REVIEWED_CHAT_SQL_ADAPTERS,
  REVIEWED_CHAT_SQL_SOURCES,
} from "./sql/availability";
import {
  MUNICIPAL_FISCAL_MAX_RESULTS,
  MUNICIPAL_FISCAL_MAX_YEAR,
  MUNICIPAL_FISCAL_METRICS,
  MUNICIPAL_FISCAL_MIN_YEAR,
} from "./contracts/municipalFiscal";
import {
  ELECTION_ROUND_MAX,
  ELECTION_ROUND_MIN,
  LATEST_PARLIAMENTARY_CONTEST,
  LATEST_PRESIDENTIAL_CONTEST,
  PRESIDENTIAL_CONTESTS,
} from "./contracts/elections";

type RawPrompt = (typeof rawPrompts)[number];
type ParameterMetadata = {
  name: string;
  type: string;
  required?: boolean;
  default?: string | number;
  values?: (string | number)[];
  description: LocalizedText;
};
const toolParameters = rawToolParameters as Record<string, ParameterMetadata[]>;

const labelFor = (id: string): LocalizedText =>
  labels[id] ?? { bg: id, en: id };

const requiredByTool: Record<string, string[]> = {
  nationalResults: ["election"],
  presidentialResults: ["cycle", "round"],
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
  personWealth: ["name"],
  municipalFiscalRanking: ["year", "metric"],
};

const parameterKind = (tool: string, id: string): QuestionParameterKind => {
  if (tool === "personWealth" && id === "name") return "person";
  if (tool === "comparePlaces" && (id === "a" || id === "b")) return "place";
  if (tool === "compareElections" && (id === "a" || id === "b"))
    return "election";
  if (id === "year") return "year";
  if (id === "cycle") return "year";
  if (id === "round") return "number";
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
    ...new Set([
      ...Object.values(prompt.args).flatMap((args) => Object.keys(args)),
      ...(toolParameters[prompt.tool] ?? [])
        .filter((p) => p.required || !REVIEWED_CHAT_SQL_ADAPTERS[prompt.tool])
        .map((p) => p.name),
    ]),
  ];
  if (prompt.tool === "nationalResults" && !ids.includes("election"))
    ids.push("election");
  const required = new Set([
    ...(requiredByTool[prompt.tool] ?? []),
    ...(toolParameters[prompt.tool] ?? [])
      .filter((p) => p.required)
      .map((p) => p.name),
  ]);
  return ids.map((id) => {
    const metadata = toolParameters[prompt.tool]?.find((p) => p.name === id);
    const kind = metadata?.values
      ? "enum"
      : metadata?.type === "count"
        ? "number"
        : parameterKind(prompt.tool, id);
    const base: QuestionParameter = {
      id,
      kind,
      required: required.has(id),
      label: labels[id] ?? metadata?.description ?? labelFor(id),
      ...(metadata?.values ? { values: metadata.values.map(String) } : {}),
      ...(kind === "year" ? { min: 1900, max: 2100 } : {}),
      ...(/^(years|n|count|limit)$/.test(id) ? { min: 1, max: 5000 } : {}),
    };
    if (id === "year" && BUDGET_QUESTIONS.some((s) => s.id === prompt.tool))
      return { ...base, min: 1990, max: 2100 };
    if (prompt.tool === "municipalFiscalRanking" && id === "count")
      return { ...base, max: MUNICIPAL_FISCAL_MAX_RESULTS };
    if (prompt.tool === "municipalFiscalRanking" && id === "year")
      return {
        ...base,
        min: MUNICIPAL_FISCAL_MIN_YEAR,
        max: MUNICIPAL_FISCAL_MAX_YEAR,
      };
    if (prompt.tool === "municipalFiscalRanking" && id === "metric")
      return { ...base, kind: "enum", values: [...MUNICIPAL_FISCAL_METRICS] };
    if (prompt.tool === "presidentialResults" && id === "cycle") {
      const withoutNumericBounds = { ...base };
      delete withoutNumericBounds.min;
      delete withoutNumericBounds.max;
      return {
        ...withoutNumericBounds,
        kind: "enum",
        values: [...PRESIDENTIAL_CONTESTS],
      };
    }
    if (prompt.tool === "presidentialResults" && id === "round")
      return {
        ...base,
        kind: "number",
        values: undefined,
        min: ELECTION_ROUND_MIN,
        max: ELECTION_ROUND_MAX,
      };
    return base;
  });
};

const canonicalDefaults = (prompt: RawPrompt): Record<string, unknown> => ({
  ...Object.fromEntries(
    Object.entries(prompt.args.bg).filter(
      ([key, value]) =>
        JSON.stringify(value) ===
        JSON.stringify((prompt.args.en as Record<string, unknown>)[key]),
    ),
  ),
  ...(prompt.tool === "nationalResults"
    ? { election: LATEST_PARLIAMENTARY_CONTEST }
    : {}),
  ...(prompt.tool === "presidentialResults"
    ? { cycle: LATEST_PRESIDENTIAL_CONTEST }
    : {}),
});

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
      aliases: { bg: editorialAliases[prompt.id] ?? [] },
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
      sourceIds:
        REVIEWED_CHAT_SQL_SOURCES[prompt.id] ?? toolSources[prompt.tool] ?? [],
    };
  },
);

export const QUESTION_CATALOG: QuestionCatalog = {
  categories: QUESTION_CATEGORIES,
  questions: QUESTION_DEFINITIONS,
};

export const questionById = (id: string): QuestionDefinition | undefined =>
  QUESTION_DEFINITIONS.find((question) => question.id === id);
