import type {
  Language,
  QuestionCatalog,
  QuestionDefinition,
  QuestionSurfaceStatus,
} from "../types";

export type QuestionSurface = "chat" | "sql";

export const surfaceStatus = (
  question: QuestionDefinition,
  surface: QuestionSurface,
): QuestionSurfaceStatus => question[surface].status;

export const questionsForLeaf = (
  catalog: QuestionCatalog,
  surface: QuestionSurface,
  categoryId: string,
  subcategoryId: string,
  includeUnavailable = false,
): QuestionDefinition[] =>
  catalog.questions.filter(
    (question) =>
      question.categoryId === categoryId &&
      question.subcategoryId === subcategoryId &&
      (includeUnavailable || surfaceStatus(question, surface) === "ready"),
  );

const searchableText = (question: QuestionDefinition, lang: Language) =>
  [
    question.question[lang],
    question.question[lang === "bg" ? "en" : "bg"],
    ...(question.aliases.bg ?? []),
    ...(question.aliases.en ?? []),
  ]
    .join(" ")
    .toLocaleLowerCase(lang === "bg" ? "bg" : "en");

export const searchQuestions = (
  catalog: QuestionCatalog,
  surface: QuestionSurface,
  lang: Language,
  query: string,
  includeUnavailable = false,
): QuestionDefinition[] => {
  const terms = query
    .trim()
    .toLocaleLowerCase(lang === "bg" ? "bg" : "en")
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return [];
  return catalog.questions.filter(
    (question) =>
      (includeUnavailable || surfaceStatus(question, surface) === "ready") &&
      terms.every((term) => {
        const category = catalog.categories.find(
          (item) => item.id === question.categoryId,
        );
        const subcategory = category?.subcategories.find(
          (item) => item.id === question.subcategoryId,
        );
        const haystack = [
          searchableText(question, lang),
          category?.label.bg,
          category?.label.en,
          subcategory?.label.bg,
          subcategory?.label.en,
        ]
          .join(" ")
          .toLocaleLowerCase(lang);
        return haystack.includes(term);
      }),
  );
};
