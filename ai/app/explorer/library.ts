import {
  QUESTION_CATEGORIES,
  QUESTION_DEFINITIONS,
} from "../../../src/lib/questions/catalog";
import { TOOLS } from "../../tools/registry";
import { translitKey } from "../../tools/translit";
import type { Lang } from "../../tools/types";
import rawTitles from "./toolTitles.json";
const titles: Record<string, Record<Lang, string>> = rawTitles;
export const LIBRARY = TOOLS.map((tool) => {
  const questions = QUESTION_DEFINITIONS.filter(
    (q) => q.chat.capabilityId === tool.name,
  );
  const categoryId = questions[0]?.categoryId ?? "data-coverage";
  const subcategoryId = questions[0]?.subcategoryId ?? "coverage";
  return {
    tool,
    questions,
    categoryId,
    subcategoryId,
    title: titles[tool.name] ?? tool.description,
  };
});
export type LibraryEntry = (typeof LIBRARY)[number];
export { QUESTION_CATEGORIES };
export const filterLibrary = (
  query: string,
  category = "",
  subcategory = "",
  recent?: readonly string[],
) => {
  const terms = translitKey(query).split(/\s+/).filter(Boolean);
  const matches = LIBRARY.filter((entry) => {
    if (category && entry.categoryId !== category) return false;
    if (subcategory && entry.subcategoryId !== subcategory) return false;
    if (recent && !recent.includes(entry.tool.name)) return false;
    const c = QUESTION_CATEGORIES.find((c) => c.id === entry.categoryId);
    const s = c?.subcategories.find((s) => s.id === entry.subcategoryId);
    const haystack = translitKey(
      [
        entry.tool.name,
        ...Object.values(entry.title),
        ...Object.values(entry.tool.description),
        ...Object.values(c?.label ?? {}),
        ...Object.values(s?.label ?? {}),
        ...entry.questions.flatMap((q) => [
          ...Object.values(q.question),
          ...(q.aliases.bg ?? []),
          ...(q.aliases.en ?? []),
        ]),
      ].join(" "),
    );
    return terms.every((term) => haystack.includes(term));
  });
  return recent
    ? matches.sort(
        (a, b) => recent.indexOf(a.tool.name) - recent.indexOf(b.tool.name),
      )
    : matches;
};
export const WELCOME_IDS = [
  "budgetVariance",
  "nationalResults",
  "municipalityResults",
  "companyConnections",
  "waterServices",
  "agencyPolls",
];
