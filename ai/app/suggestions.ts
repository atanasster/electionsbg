// Entity-driven query autocomplete. A curated bank of questions built from the
// real party / oblast / agency entities, each bound to a catalog intent.
// Substring-matched against the input as the user types.

import { OBLASTS } from "../tools/place";
import { STARTERS } from "./starters";
import type { Lang } from "../tools/types";

export type Suggestion = {
  bg: string;
  en: string;
  questionId: string;
  parameters?: Record<string, unknown>;
};

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

// Additional parties dispatch directly to partyResult. Names remain Cyrillic
// in both labels and are resolved against the selected election's roster.
const SMALLER_PARTIES = ["Синя България", "Демократична България"];

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

// Municipalities whose OWN party results / trend route to municipalityResults /
// municipalityHistory ("резултатите в община X"). Verified to resolve as a
// município (not the same-name oblast) with vote data.
const RESULT_MUNIS: { bg: string; en: string }[] = [
  { bg: "Пловдив", en: "Plovdiv" },
  { bg: "Варна", en: "Varna" },
  { bg: "Бургас", en: "Burgas" },
  { bg: "Русе", en: "Ruse" },
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

export const SUGGESTIONS: Suggestion[] = [
  ...STARTERS.map((s) => ({ bg: s.bg, en: s.en, questionId: s.id })),
  ...PARTIES.flatMap((p) => [
    {
      questionId: "partyResult",
      parameters: { party: p },
      bg: `Колко гласа взе ${p}?`,
      en: `How many votes did ${p} get?`,
    },
    {
      questionId: "regionBreakdown",
      parameters: { party: p },
      bg: `Къде е силна ${p}?`,
      en: `Where is ${p} strongest?`,
    },
    {
      questionId: "municipalityBreakdown",
      parameters: { party: p, oblast: "PDV" },
      bg: `${p} по общини в Пловдив`,
      en: `${p} by municipality in Plovdiv`,
    },
    {
      questionId: "partyTimeline",
      parameters: { party: p },
      bg: `Как се представя ${p} през годините?`,
      en: `How has ${p} done over the years?`,
    },
    {
      questionId: "partyDemographics",
      parameters: { party: p },
      bg: `Кой гласува за ${p}?`,
      en: `Who votes for ${p}?`,
    },
  ]),
  ...SMALLER_PARTIES.flatMap((p) => [
    {
      questionId: "partyResult",
      parameters: { party: p },
      bg: `Колко гласа взе ${p}?`,
      en: `How many votes did ${p} get?`,
    },
    {
      questionId: "partyResult",
      parameters: { party: p },
      bg: `Резултати за ${p}`,
      en: `Results for ${p}`,
    },
  ]),
  ...PG_PARTIES.map((p) => ({
    questionId: "partyMps",
    parameters: { party: p },
    bg: `Кои са депутатите от ${p}?`,
    en: `Who are the MPs from ${p}?`,
  })),
  ...Object.values(OBLASTS).map((o) => ({
    questionId: "regionHistory",
    parameters: { oblast: o.bg },
    bg: `Каква е активността в ${o.bg}?`,
    en: `What is the turnout in ${o.en}?`,
  })),
  ...WINNER_OBLASTS.map((o) => ({
    questionId: "municipalityWinners",
    parameters: { oblast: o.bg },
    bg: `Резултати по общини в ${o.bg}`,
    en: `Results by municipality in ${o.en}`,
  })),
  ...WINNER_MUNIS.map((m) => ({
    questionId: "settlementWinners",
    parameters: { place: m.bg },
    bg: `Резултати по населени места в община ${m.bg}`,
    en: `Results by settlement in ${m.en}`,
  })),
  ...WINNER_MUNIS.map((m) => ({
    questionId: "sectionWinners",
    parameters: { place: m.bg },
    bg: `Резултати по секции в ${m.bg}`,
    en: `Results by polling station in ${m.en}`,
  })),
  ...SETTLEMENTS.map((s) => ({
    questionId: "settlementResults",
    parameters: { place: s.bg },
    bg: `Резултатите в с. ${s.bg}`,
    en: `Results in the village of ${s.en}`,
  })),
  ...SETTLEMENTS.map((s) => ({
    questionId: "settlementHistory",
    parameters: { place: s.bg, years: 5 },
    bg: `Резултатите в с. ${s.bg} за последните 5 години`,
    en: `Results in the village of ${s.en} over the last 5 years`,
  })),
  // one município's own results / trend
  ...RESULT_MUNIS.map((m) => ({
    questionId: "municipalityResults",
    parameters: { place: m.bg },
    bg: `Резултатите в община ${m.bg}`,
    en: `Results in ${m.en} municipality`,
  })),
  ...RESULT_MUNIS.map((m) => ({
    questionId: "municipalityHistory",
    parameters: { place: m.bg, years: 5 },
    bg: `Резултатите в община ${m.bg} за последните 5 години`,
    en: `Results in ${m.en} municipality over the last 5 years`,
  })),
  // one oblast's own results / trend
  ...WINNER_OBLASTS.map((o) => ({
    questionId: "regionResults",
    parameters: { oblast: o.bg },
    bg: `Резултатите в област ${o.bg}`,
    en: `Results in ${o.en} region`,
  })),
  ...WINNER_OBLASTS.map((o) => ({
    questionId: "regionResultsTrend",
    parameters: { oblast: o.bg, years: 5 },
    bg: `Резултатите в област ${o.bg} за последните 5 години`,
    en: `Results in ${o.en} region over the last 5 years`,
  })),
  // Sofia city (the 3 МИР combined) + abroad (diaspora), each with a trend
  {
    questionId: "regionResults",
    parameters: { oblast: "SOF_CITY" },
    bg: "Резултатите в София",
    en: "Results in Sofia",
  },
  {
    questionId: "regionResultsTrend",
    parameters: { oblast: "SOF_CITY", years: 5 },
    bg: "Резултатите в София за последните 5 години",
    en: "Results in Sofia over the last 5 years",
  },
  {
    questionId: "diasporaVote",
    parameters: {},
    bg: "Резултатите в чужбина",
    en: "Results abroad",
  },
  {
    questionId: "diasporaVoteTrend",
    parameters: { years: 5 },
    bg: "Резултатите в чужбина за последните 5 години",
    en: "Results abroad over the last 5 years",
  },
  ...AGENCIES.map((a) => ({
    questionId: "agencyAccuracyHistory",
    parameters: { agency: a },
    bg: `Колко е точна ${a}?`,
    en: `How accurate is ${a}?`,
  })),
  ...COUNCIL_CITIES.map((c) => ({
    questionId: "localCouncil",
    parameters: { place: c.bg },
    bg: `Какъв е общинският съвет на ${c.bg}?`,
    en: `What is the ${c.en} municipal council?`,
  })),
  ...CANDIDATES.map((c) => ({
    questionId: "candidateResult",
    parameters: { name: c.bg },
    bg: `Резултати за ${c.bg}`,
    en: `Results for ${c.en}`,
  })),
  ...CANDIDATES.map((c) => ({
    questionId: "mpVotingProfile",
    parameters: { name: c.bg },
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
