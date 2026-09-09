import { EXPANDED_SQL_RECIPES, expandedSqlText } from "./expanded";
import { SQL_TOPICS } from "./topics";
import { QUESTION_CATEGORIES, QUESTION_DEFINITIONS } from "../catalog";
import type {
  LocalizedText,
  QuestionCatalog,
  QuestionDefinition,
  QuestionParameterKind,
} from "../types";
import { CHAT_SQL_RECIPES, LEGACY_SQL_RECIPES } from "./recipes";

const bgQuestions: Record<string, string> = {
  "top-contractors":
    "Кои фирми имат най-голяма стойност на възложени договори?",
  "companies-by-all-public-money":
    "Кои фирми получават най-много от всички източници на публични средства?",
  "contractors-ranked-and-scoped":
    "Кои са водещите изпълнители за избрания период?",
  "top-awarders": "Кои публични организации възлагат най-много средства?",
  "where-a-buyer-sits":
    "В кое населено място, община и област е седалището на възложителя?",
  "biggest-tenders":
    "Кои са най-големите обявени процедури по прогнозна стойност?",
  "forecast-vs-actual":
    "Как прогнозната стойност се сравнява с възложената стойност?",
  "one-buyer-s-procurement-profile":
    "Какво купува един възложител, от кого и при каква конкуренция?",
  "single-bidder-contracts":
    "Кои са най-големите договори само с един участник?",
  "riskiest-buyers": "Кои възложители имат най-много индикатори за риск?",
  "appeals-and-how-they-ended": "Как приключиха последните жалби пред КЗК?",
  "find-a-person": "Къде се среща едно име във всички масиви за лица?",
  "a-person-s-declared-wealth-by-year":
    "Какво е декларирало едно лице по години?",
  "money-declared-abroad":
    "Кои лица декларират банкови или инвестиционни активи извън България?",
  "who-owns-a-company": "Кой притежава фирмата и какви са дяловете?",
  "officers-of-a-company":
    "Кои са управителите, директорите и собствениците на фирмата?",
  "politically-connected-companies":
    "Кои фирми са свързани с депутати или длъжностни лица?",
  "companies-registered-in-a-place":
    "Кои фирми са регистрирани в населеното място?",
  "municipal-financial-health":
    "Какви са тримесечните показатели за финансовото състояние на общините?",
  "what-is-open-right-now":
    "За кои процедури може да се кандидатства в момента?",
  "base-rates-for-a-procedure":
    "До колко проекта е достигнало плащане и каква е медианната помощ по процедура?",
  "clean-delivery-register":
    "Кои договори по еврофондове са приключили без финансова корекция?",
  "interreg-operations":
    "Какви трансгранични проекти и бюджети има по Interreg?",
  "bulgarian-interreg-partners":
    "Кои български организации участват в Interreg и с какъв бюджет?",
  "voting-twins": "Кои депутати гласуват най-сходно?",
  "party-cohesion": "Колко често депутатите от една партия гласуват еднакво?",
  "a-day-in-the-chamber":
    "Какви гласувания са проведени в един парламентарен ден?",
  "what-the-health-fund-pays-each-hospital":
    "Колко плаща НЗОК на всяка болница за болнична помощ?",
  "medicine-reimbursement-by-molecule":
    "Колко възстановява НЗОК по активно вещество?",
  "contractors-in-the-registry":
    "Кои изпълнители се намират и в Търговския регистър?",
  "both-contracts-and-eu-funds":
    "Кои фирми получават и обществени поръчки, и средства от ЕС?",
  "officials-who-hold-company-roles":
    "Кои деклариращи лица имат роли във фирми?",
  "hospitals-that-also-buy":
    "Кои финансирани от НЗОК болници са и възложители?",
  "name-search": "Къде се среща име сред фирми, управители и изпълнители?",
  "unified-search": "Какво намира общото търсене за фирми, лица и изпълнители?",
  "what-changed-recently": "Какви нови записи са добавени наскоро?",
  "corpus-sizes": "Какъв е приблизителният размер на всеки масив?",
};

const parameterLabel = (id: string): LocalizedText =>
  ({
    eik: { bg: "ЕИК", en: "EIK" },
    ekatte: { bg: "ЕКАТТЕ", en: "EKATTE" },
    name: { bg: "Име", en: "Name" },
    query: { bg: "Търсене", en: "Search" },
    company: { bg: "Фирма / ЕИК", en: "Company / EIK" },
    scope: { bg: "Период", en: "Period" },
    from: { bg: "От дата", en: "From date" },
    days: { bg: "Брой дни", en: "Number of days" },
    limit: { bg: "Брой резултати", en: "Result limit" },
  })[id] ?? { bg: id, en: id };

const questionKind = (
  recipeId: string,
  id: string,
  kind: string,
): QuestionParameterKind =>
  kind === "code" && (id === "eik" || id === "company")
    ? "company"
    : kind === "code" && id === "ekatte"
      ? "place"
      : recipeId === "find-a-person" && id === "name"
        ? "person"
        : kind === "integer" || kind === "quarter"
          ? "number"
          : kind === "year"
            ? "year"
            : kind === "date"
              ? "date"
              : kind === "enum"
                ? "enum"
                : "string";

export const SQL_QUESTION_DEFINITIONS: QuestionDefinition[] = [
  ...LEGACY_SQL_RECIPES,
  ...EXPANDED_SQL_RECIPES,
].map((recipe) => {
  const [categoryId, subcategoryId] = SQL_TOPICS[recipe.id];
  return {
    id: recipe.questionId,
    categoryId,
    subcategoryId,
    question: {
      bg:
        bgQuestions[recipe.id] ?? expandedSqlText(recipe.id) ?? recipe.answers,
      en: recipe.answers,
    },
    aliases: { en: [recipe.label] },
    parameters: recipe.parameters.map((parameter) => ({
      id: parameter.id,
      kind: questionKind(recipe.id, parameter.id, parameter.kind),
      required: parameter.required,
      label: parameterLabel(parameter.id),
      min: parameter.min,
      max: parameter.max,
      values: parameter.values?.map(String),
    })),
    defaults: Object.fromEntries(
      recipe.parameters.flatMap((parameter) =>
        parameter.default === undefined
          ? []
          : [[parameter.id, parameter.default]],
      ),
    ),
    chat: {
      status: "unavailable",
      reason: {
        bg: "Въпросът е наличен в браузъра за данни.",
        en: "This question is available in the data browser.",
      },
    },
    sql: { status: "ready", capabilityId: recipe.id, version: 1 },
    sourceIds: recipe.relations,
  };
});

export const SQL_QUESTION_CATALOG: QuestionCatalog = {
  categories: QUESTION_CATEGORIES,
  questions: [
    ...QUESTION_DEFINITIONS.map((question) => {
      const recipe = CHAT_SQL_RECIPES.find(
        (candidate) => candidate.questionId === question.id,
      );
      return recipe
        ? {
            ...question,
            sourceIds: [
              ...new Set([...question.sourceIds, ...recipe.relations]),
            ],
          }
        : question;
    }),
    ...SQL_QUESTION_DEFINITIONS,
  ],
};
