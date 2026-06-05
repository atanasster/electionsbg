// Entity-driven query autocomplete. A curated bank of questions built from the
// real party / oblast / agency entities, each phrased to route to a real tool.
// Substring-matched against the input as the user types.

import { OBLASTS } from "../tools/place";
import type { Lang } from "../tools/types";

export type Suggestion = { bg: string; en: string };

const PARTIES = [
  "ГЕРБ-СДС",
  "ПП-ДБ",
  "Възраждане",
  "ДПС",
  "БСП",
  "ИТН",
  "МЕЧ",
  "Величие",
];

const AGENCIES = [
  "Алфа Рисърч",
  "Тренд",
  "Галъп",
  "Маркет Линкс",
  "Сова Харис",
  "Медиана",
];

const BASE: Suggestion[] = [
  {
    bg: "Какви са резултатите от последните избори?",
    en: "Results of the latest election?",
  },
  {
    bg: "Как се променя избирателната активност през годините?",
    en: "How has turnout changed over the years?",
  },
  {
    bg: "Какъв е процентът машинно гласуване в последните избори?",
    en: "Machine-voting share in the latest election?",
  },
  { bg: "Сравни последните избори", en: "Compare the recent elections" },
  {
    bg: "Имаше ли нередности на последните избори?",
    en: "Were there irregularities in the latest election?",
  },
  { bg: "Какъв е държавният бюджет?", en: "What is the state budget?" },
  { bg: "За какво се харчи бюджетът?", en: "What is the budget spent on?" },
  {
    bg: "Кои са най-големите инвестиционни проекти?",
    en: "Biggest investment projects?",
  },
  { bg: "Кои депутати са най-богати?", en: "Which MPs are richest?" },
  { bg: "Кои са правителствата от 2005?", en: "Governments since 2005?" },
  {
    bg: "Коя социологическа агенция е най-точна?",
    en: "Which polling agency is most accurate?",
  },
  {
    bg: "Кой спечели общинските съвети?",
    en: "Who won the municipal councils?",
  },
];

export const SUGGESTIONS: Suggestion[] = [
  ...BASE,
  ...PARTIES.flatMap((p) => [
    { bg: `Колко гласа взе ${p}?`, en: `How many votes did ${p} get?` },
    { bg: `Къде е силна ${p}?`, en: `Where is ${p} strongest?` },
    {
      bg: `Как се представя ${p} през годините?`,
      en: `How has ${p} done over the years?`,
    },
  ]),
  ...Object.values(OBLASTS).map((o) => ({
    bg: `Каква е активността в ${o.bg}?`,
    en: `What is the turnout in ${o.en}?`,
  })),
  ...AGENCIES.map((a) => ({
    bg: `Колко е точна ${a}?`,
    en: `How accurate is ${a}?`,
  })),
];

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

export const matchSuggestions = (
  q: string,
  lang: Lang,
  limit = 6,
): Suggestion[] => {
  const needle = norm(q);
  if (needle.length < 2) return [];
  // skip if the input already equals a suggestion (nothing to add)
  const hits = SUGGESTIONS.filter((s) => {
    const text = norm(s[lang]);
    return text.includes(needle) && text !== needle;
  });
  return hits.slice(0, limit);
};
