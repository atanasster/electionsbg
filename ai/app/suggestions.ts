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

// Smaller parties / coalitions whose names aren't hardcoded router tokens. The
// router takes a multi-word capitalized name for a person, so these route to the
// candidate tool, which resolves them against the selected election's party
// roster (the candidate→party fallback). Phrasing is limited to the plain
// "result of X" template — the per-region / over-time / demographic templates
// below need a recognised party TOKEN to keep their intent, which these lack.
// Names stay Cyrillic even in the EN string (matchParty romanizes), matching the
// PARTIES convention above.
const SMALLER_PARTIES = [
  "Синя България",
  "Демократична България",
  "Партия Атака",
];

const AGENCIES = [
  "Алфа Рисърч",
  "Тренд",
  "Галъп",
  "Маркет Линкс",
  "Сова Харис",
  "Медиана",
];

// Parliamentary groups of the sitting НС — each routes to partyMps and resolves
// to a real roster group (verified: ГЕРБ-СДС via the dash-normalized alias, ПП →
// Продължаваме Промяната, ДБ → Демократична България). Kept separate from
// PARTIES, whose БСП/ИТН/МЕЧ/Величие aren't distinct roster groups (the roster
// folds them into a coalition group) and would dead-end the MP-roster query.
const PG_PARTIES = ["ГЕРБ-СДС", "ПП", "ДБ", "ДПС", "Възраждане"];

// Major municipalities whose council composition routes to localCouncil (the
// hemicycle). Verified to resolve in both languages via resolveMunicipality.
const COUNCIL_CITIES: { bg: string; en: string }[] = [
  { bg: "София", en: "Sofia" },
  { bg: "Пловдив", en: "Plovdiv" },
  { bg: "Варна", en: "Varna" },
  { bg: "Бургас", en: "Burgas" },
  { bg: "Русе", en: "Ruse" },
  { bg: "Стара Загора", en: "Stara Zagora" },
  { bg: "Плевен", en: "Pleven" },
];

// Oblasts whose per-municipality winner breakdown routes to municipalityWinners
// (the party-blind "results by municipality in X"). Curated clean names (not the
// OBLASTS map, which carries Sofia's МИР shards + abroad). Verified to resolve.
const WINNER_OBLASTS: { bg: string; en: string }[] = [
  { bg: "Благоевград", en: "Blagoevgrad" },
  { bg: "Пловдив", en: "Plovdiv" },
  { bg: "Варна", en: "Varna" },
  { bg: "Бургас", en: "Burgas" },
  { bg: "Стара Загора", en: "Stara Zagora" },
];

// Municipalities whose per-settlement / per-section winner breakdowns route to
// settlementWinners / sectionWinners. Verified to resolve in both languages.
const WINNER_MUNIS: { bg: string; en: string }[] = [
  { bg: "Самоков", en: "Samokov" },
  { bg: "Несебър", en: "Nesebar" },
  { bg: "Банско", en: "Bansko" },
];

// Single settlements (villages) whose own results / trend route to
// settlementResults / settlementHistory. The "с." / "village of" marker is what
// flags ONE place to the router; each is an unambiguous name with vote data.
const SETTLEMENTS: { bg: string; en: string }[] = [
  { bg: "Иново", en: "Inovo" },
  { bg: "Труд", en: "Trud" },
  { bg: "Бръшлян", en: "Brashlyan" },
];

// Well-known candidates (verified present in the latest candidates.json) — these
// route to candidateResult for their preferential-vote breakdown.
const CANDIDATES: { bg: string; en: string }[] = [
  { bg: "Бойко Борисов", en: "Boyko Borisov" },
  { bg: "Делян Пеевски", en: "Delyan Peevski" },
  { bg: "Асен Василев", en: "Asen Vasilev" },
  { bg: "Костадин Костадинов", en: "Kostadin Kostadinov" },
  { bg: "Божидар Божанов", en: "Bozhidar Bozhanov" },
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
    bg: "Колко места има всяка партия в парламента?",
    en: "How many seats does each party hold in parliament?",
  },
  {
    bg: "Как се променят местата по партии последните 5 години?",
    en: "How have seats per party changed over the last 5 years?",
  },
  {
    bg: "Кой печели гласа в чужбина последните години?",
    en: "Who wins the diaspora vote over recent years?",
  },
  {
    bg: "Как се променят прахосаните гласове през годините?",
    en: "How have wasted votes changed over time?",
  },
  {
    bg: "Как се променя вотът за общинските съвети през годините?",
    en: "How has the council vote changed across cycles?",
  },
  {
    bg: "Как се променят кметовете по партии през годините?",
    en: "How have mayoralties per party changed across cycles?",
  },
  {
    bg: "Как се променя бюджетът през годините?",
    en: "How has the budget changed over the years?",
  },
  {
    bg: "Кой спечели общинските съвети?",
    en: "Who won the municipal councils?",
  },
  {
    bg: "Кои общини са с най-висока безработица?",
    en: "Which municipalities have the highest unemployment?",
  },
  {
    bg: "Коя област е с най-висок БВП на човек?",
    en: "Which oblast has the highest GDP per capita?",
  },
  {
    bg: "Как гласуват ромските квартали?",
    en: "How do the Roma neighbourhoods vote?",
  },
  {
    bg: "Коя партия печели ромските гласове последните 5 години?",
    en: "Which party wins the Roma vote over the last 5 years?",
  },
  {
    bg: "Какъв е индексът на изборния риск?",
    en: "What is the election risk index?",
  },
  {
    bg: "Колко критични секции има?",
    en: "How many critical sections?",
  },
  {
    bg: "Колко гласове са прахосани под прага?",
    en: "How many votes were wasted below the threshold?",
  },
  { bg: "Как гласува диаспората?", en: "How did the diaspora vote?" },
  {
    bg: "Какво показва тестът на Бенфорд?",
    en: "What does the Benford test show?",
  },
  { bg: "Кои депутати са най-лоялни?", en: "Which MPs are most loyal?" },
  {
    bg: "Коя група гласува най-единно?",
    en: "Which group votes most cohesively?",
  },
  {
    bg: "Какво разделя гласоподавателите?",
    en: "What divides the electorate?",
  },
];

export const SUGGESTIONS: Suggestion[] = [
  ...BASE,
  ...PARTIES.flatMap((p) => [
    { bg: `Колко гласа взе ${p}?`, en: `How many votes did ${p} get?` },
    { bg: `Къде е силна ${p}?`, en: `Where is ${p} strongest?` },
    {
      bg: `${p} по общини в Пловдив`,
      en: `${p} by municipality in Plovdiv`,
    },
    {
      bg: `Как се представя ${p} през годините?`,
      en: `How has ${p} done over the years?`,
    },
    { bg: `Кой гласува за ${p}?`, en: `Who votes for ${p}?` },
  ]),
  ...SMALLER_PARTIES.flatMap((p) => [
    { bg: `Колко гласа взе ${p}?`, en: `How many votes did ${p} get?` },
    { bg: `Резултати за ${p}`, en: `Results for ${p}` },
  ]),
  ...PG_PARTIES.map((p) => ({
    bg: `Кои са депутатите от ${p}?`,
    en: `Who are the MPs from ${p}?`,
  })),
  ...Object.values(OBLASTS).map((o) => ({
    bg: `Каква е активността в ${o.bg}?`,
    en: `What is the turnout in ${o.en}?`,
  })),
  ...WINNER_OBLASTS.map((o) => ({
    bg: `Резултати по общини в ${o.bg}`,
    en: `Results by municipality in ${o.en}`,
  })),
  ...WINNER_MUNIS.map((m) => ({
    bg: `Резултати по населени места в община ${m.bg}`,
    en: `Results by settlement in ${m.en}`,
  })),
  ...WINNER_MUNIS.map((m) => ({
    bg: `Резултати по секции в ${m.bg}`,
    en: `Results by polling station in ${m.en}`,
  })),
  ...SETTLEMENTS.map((s) => ({
    bg: `Резултатите в с. ${s.bg}`,
    en: `Results in the village of ${s.en}`,
  })),
  ...SETTLEMENTS.map((s) => ({
    bg: `Резултатите в с. ${s.bg} за последните 5 години`,
    en: `Results in the village of ${s.en} over the last 5 years`,
  })),
  ...AGENCIES.map((a) => ({
    bg: `Колко е точна ${a}?`,
    en: `How accurate is ${a}?`,
  })),
  ...COUNCIL_CITIES.map((c) => ({
    bg: `Какъв е общинският съвет на ${c.bg}?`,
    en: `What is the ${c.en} municipal council?`,
  })),
  ...CANDIDATES.map((c) => ({
    bg: `Резултати за ${c.bg}`,
    en: `Results for ${c.en}`,
  })),
  ...CANDIDATES.map((c) => ({
    bg: `Как гласува ${c.bg} в парламента?`,
    en: `How does ${c.en} vote in parliament?`,
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
