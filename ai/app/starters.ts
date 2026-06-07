// Starter prompts shown as chips under the composer (a random STARTER_COUNT
// sample, with already-asked prompts dropped). Deliberately larger than that
// count so the row stays full after dropping used ones.
//
// Every starter MUST route to a real tool — this is locked by the starter-
// routing guard in ai/tests/regression.ts. Kept in its own pure module (no React
// imports) so that guard can import it under node.

export type Starter = { bg: string; en: string };

export const STARTERS: Starter[] = [
  {
    bg: "Какъв е процентът машинно гласуване в последните 7 избора?",
    en: "What's the machine-voting % in the last 7 elections?",
  },
  {
    bg: "Как се представя ГЕРБ през годините?",
    en: "How has GERB performed over the years?",
  },
  {
    bg: "Какви са резултатите от последните избори?",
    en: "Results of the latest election?",
  },
  { bg: "Къде е силна ГЕРБ?", en: "Where is GERB strongest?" },
  {
    bg: "Покажи резултатите по области.",
    en: "Show the results by region.",
  },
  {
    bg: "Резултати по общини в Пловдив",
    en: "Results by municipality in Plovdiv",
  },
  {
    bg: "Резултати по населени места в община Несебър",
    en: "Results by settlement in Nesebar",
  },
  {
    bg: "Покажи резултатите по секции в Банско",
    en: "Show the results by polling station in Bansko",
  },
  {
    bg: "ГЕРБ по общини в Пловдив",
    en: "GERB by municipality in Plovdiv",
  },
  {
    bg: "Кои общини са с най-висока безработица?",
    en: "Which municipalities have the highest unemployment?",
  },
  {
    bg: "Колко места има всяка партия в парламента?",
    en: "How many seats does each party hold in parliament?",
  },
  {
    bg: "Кои са депутатите от ПП?",
    en: "Who are the MPs from PP?",
  },
  {
    bg: "Сравни изборите от 2022 и 2024",
    en: "Compare the 2022 and 2024 elections",
  },
  { bg: "Каква беше активността през 2023?", en: "What was turnout in 2023?" },
  { bg: "Какъв е държавният бюджет?", en: "What is the state budget?" },
  { bg: "За какво се харчи бюджетът?", en: "What is the budget spent on?" },
  { bg: "Кои депутати са най-богати?", en: "Which MPs are richest?" },
  {
    bg: "Кои са най-големите инвестиционни проекти?",
    en: "What are the biggest investment projects?",
  },
  {
    bg: "Коя социологическа агенция е най-точна?",
    en: "Which polling agency is most accurate?",
  },
  { bg: "Кои са правителствата от 2005?", en: "Governments since 2005?" },
  {
    bg: "Кой спечели общинските съвети?",
    en: "Who won the municipal councils?",
  },
  {
    bg: "Какъв е общинският съвет на София?",
    en: "What is the Sofia municipal council?",
  },
  {
    bg: "Имаше ли нередности на последните избори?",
    en: "Were there irregularities in the latest election?",
  },
];
