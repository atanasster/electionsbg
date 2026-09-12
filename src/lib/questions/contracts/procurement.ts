import type { QuestionDefinition } from "../types";
import {
  validateProcurementQuery,
  type ProcurementQuery,
} from "../../procurementQuery";
export const PROCUREMENT_RISK_WORDS: Record<
  string,
  { bg: string; en: string }
> = {
  debarred: { bg: "отстранени изпълнители", en: "debarred suppliers" },
  mpConnected: { bg: "свързани с депутати", en: "linked to MPs" },
  pepConnected: { bg: "длъжностни лица", en: "public officials" },
  awarderConcentration: { bg: "концентрация", en: "concentration" },
  amendment: { bg: "с анекс", en: "with amendments" },
  annexGrowth: {
    bg: "голямо увеличение на стойността",
    en: "large value increase",
  },
  newFirmWinner: { bg: "новосъздадени фирми", en: "newly established firms" },
  splitPurchase: { bg: "раздробяване", en: "split purchases" },
  appealUpheld: {
    bg: "свързани с уважена жалба",
    en: "linked to a recorded upheld appeal",
  },
  weakCompetition: { bg: "слаба конкуренция", en: "weak competition" },
  directAward: { bg: "пряко възлагане", en: "direct award" },
  shortTenderPeriod: { bg: "кратък срок за оферти", en: "short tender period" },
  nkidMismatch: { bg: "несъответствие на дейност", en: "activity mismatch" },
  nonOpenProcedure: { bg: "неоткрита процедура", en: "non open procedure" },
  rushedDeadline: { bg: "кратък срок", en: "rushed deadline" },
  shortDecisionPeriod: { bg: "бързо решение", en: "short decision period" },
  awardOverEstimate: {
    bg: "над прогнозната стойност",
    en: "award over estimate",
  },
};
type Template = {
  id: string;
  bg: string;
  en: string;
  query: Record<string, unknown>;
};
const base: Template[] = [
  {
    id: "one-bid",
    bg: "Какъв процент от договорите през {year} са с 1 участник?",
    en: "What share of contracts in {year} have one bidder?",
    query: { corpus: "contracts", operation: "share", metric: "oneBid" },
  },
  {
    id: "contracts",
    bg: "Колко договора има през {year}?",
    en: "How many contracts are there in {year}?",
    query: { corpus: "contracts", operation: "count" },
  },
  {
    id: "value",
    bg: "Стойност на договорите през {year}",
    en: "Value of contracts in {year}",
    query: { corpus: "contracts", operation: "sum", metric: "value" },
  },
  {
    id: "tenders",
    bg: "Покажи търговете през {year}",
    en: "Show tenders in {year}",
    query: { corpus: "tenders", operation: "list" },
  },
  {
    id: "appeals",
    bg: "Колко жалби по ЗОП има през {year}?",
    en: "How many procurement complaints in {year}?",
    query: { corpus: "appeals", operation: "count" },
  },
  {
    id: "decisions",
    bg: "Колко акта на КЗК има през {year}?",
    en: "How many KZK acts in {year}?",
    query: { corpus: "decisions", operation: "count" },
  },
  {
    id: "roads",
    bg: "Дял договори за пътища с 1 участник през {year}",
    en: "Share of road contracts with one bidder in {year}",
    query: {
      corpus: "contracts",
      operation: "share",
      metric: "oneBid",
      subjectSectors: ["roads"],
    },
  },
  {
    id: "medical",
    bg: "Дял договори за медицинско оборудване с 1 участник през {year}",
    en: "Share of contracts for medical equipment with one bidder in {year}",
    query: {
      corpus: "contracts",
      operation: "share",
      metric: "oneBid",
      subjectSectors: ["medicalEquipment"],
    },
  },
  {
    id: "health-buyers",
    bg: "Договори на МЗ и НЗОК през {year}",
    en: "Contracts in buyer sector nzok in {year}",
    query: { corpus: "contracts", operation: "count", buyerSectors: ["nzok"] },
  },
  {
    id: "api",
    bg: "Договори на АПИ през {year}",
    en: "Contracts by API in {year}",
    query: { corpus: "contracts", operation: "count", buyerIds: ["000695089"] },
  },
  {
    id: "upheld",
    bg: "Процент уважени жалби по ЗОП през {year}",
    en: "Share of upheld procurement complaints in {year}",
    query: {
      corpus: "appeals",
      operation: "share",
      metric: "upheld",
      denominator: "merits",
    },
  },
  {
    id: "cancelled",
    bg: "Покажи отменени търгове през {year}",
    en: "Show cancelled tenders in {year}",
    query: { corpus: "tenders", operation: "list", status: "cancelled" },
  },
  {
    id: "monthly",
    bg: "Договори по месеци през {year}",
    en: "Monthly contracts in {year}",
    query: { corpus: "contracts", operation: "trend", groupBy: "month" },
  },
];
export const PROCUREMENT_TEMPLATES: Template[] = [
  ...base,
  ...Object.entries(PROCUREMENT_RISK_WORDS).map(([id, words]) => {
    if (id === "amendment")
      return {
        id: "risk-amendment",
        bg: "Покажи анекси през {year}",
        en: "Show amendment events in {year}",
        query: { corpus: "amendments", operation: "list", metric: "records" },
      };
    const tender = [
      "nonOpenProcedure",
      "rushedDeadline",
      "shortDecisionPeriod",
      "awardOverEstimate",
    ].includes(id);
    return {
      id: "risk-" + id,
      bg: `Покажи ${tender ? "търгове" : "договори"} ${words.bg} през {year}`,
      en: `Show ${tender ? "tenders" : "contracts"} ${words.en} in {year}`,
      query: {
        corpus: tender ? "tenders" : "contracts",
        operation: "list",
        metric: "risk",
        numeratorPredicates: ["risk:" + id],
      },
    };
  }),
];
export function procurementTemplate(
  id: string,
  year: number,
  lang: "bg" | "en",
) {
  const t = PROCUREMENT_TEMPLATES.find(
    (t) => "procurement-query-" + t.id === id,
  );
  if (!t || !Number.isInteger(year) || year < 2000 || year > 2100)
    throw Error("Invalid procurement template");
  const parsed = validateProcurementQuery({
    ...t.query,
    ...(["oneBid", "upheld"].includes(String(t.query.metric))
      ? { numeratorPredicates: [String(t.query.metric)] }
      : {}),
    from: `${year}-01-01`,
    toExclusive: `${year + 1}-01-01`,
  });
  if (!parsed.ok) throw Error("Invalid procurement template query");
  return { text: t[lang].replace("{year}", String(year)), query: parsed.query };
}
export const PROCUREMENT_QUESTIONS: QuestionDefinition[] =
  PROCUREMENT_TEMPLATES.map((t) => ({
    id: "procurement-query-" + t.id,
    categoryId: "procurement",
    subcategoryId:
      t.query.corpus === "tenders"
        ? "tenders"
        : t.query.corpus === "appeals" || t.query.corpus === "decisions"
          ? "control"
          : "contracts",
    question: {
      bg: t.bg.replace("{year}", "2026"),
      en: t.en.replace("{year}", "2026"),
    },
    aliases: {},
    parameters: [
      {
        id: "year",
        kind: "year",
        required: true,
        min: 2000,
        max: 2100,
        label: { bg: "Година", en: "Year" },
      },
    ],
    defaults: { year: 2026 },
    chat: { status: "ready", capabilityId: "procurementQuery", version: 1 },
    sql: {
      status: "unavailable",
      reason: {
        bg: "Няма проверен SQL адаптер.",
        en: "No reviewed SQL adapter.",
      },
    },
    sourceIds: [
      t.query.corpus === "appeals"
        ? "db:kzk-appeals-summary"
        : t.query.corpus === "decisions"
          ? "db:kzk-decisions"
          : t.query.corpus === "tenders"
            ? "db:tender-corpus-search"
            : "db:procurement-overview",
    ],
  }));
export const procurementTemplateQuery = (
  id: string,
  year: number,
): ProcurementQuery => procurementTemplate(id, year, "en").query;

const healthcareQuestion = {
  bg: "Какъв процент договори с 1 участник в здравеопазването през 2026?",
  en: "What share of contracts with one bidder in healthcare in 2026?",
};
PROCUREMENT_QUESTIONS.push({
  id: "procurement-healthcare-clarification",
  categoryId: "procurement",
  subcategoryId: "contracts",
  question: healthcareQuestion,
  aliases: {},
  parameters: [
    {
      id: "question",
      kind: "string",
      required: true,
      label: { bg: "Въпрос", en: "Question" },
    },
  ],
  defaults: { question: healthcareQuestion.bg },
  legacyChatArgs: {
    bg: { question: healthcareQuestion.bg },
    en: { question: healthcareQuestion.en },
  },
  chat: { status: "ready", capabilityId: "procurementQuestion" },
  sql: { status: "unavailable" },
  sourceIds: ["db:procurement-overview"],
});
