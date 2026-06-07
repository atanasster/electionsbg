// Regression suite: prompt -> expected response, across every tool/dataset.
// Run: npm run ai:test   (npx tsx ai/tests/regression.ts)
//
// Each case asserts two things end to end against the REAL data files:
//   1. the deterministic router maps the prompt to the expected tool
//   2. running that tool returns the expected envelope — golden values where the
//      data is stable (election results, census), structural checks (kind / row
//      counts / fact presence) where it's volatile (assets, polls, latest poll).
// A data refresh or a routing change that breaks an expectation fails loudly.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { route } from "../orchestrator/router";
import { setFetcher } from "../tools/dataClient";
import { runTool } from "../tools/registry";
import type {
  Envelope,
  EnvelopeKind,
  GeoLevel,
  GeoMode,
  Lang,
  ToolContext,
} from "../tools/types";

setFetcher(async (path: string) => {
  const rel = path.startsWith("/") ? path.slice(1) : path;
  return JSON.parse(await readFile(join(process.cwd(), "data", rel), "utf8"));
});

const LATEST = "2026_04_19";

type FactExp = string | RegExp | { num: number };
// Expected map overlay on a response. `false` asserts there is NO map. The deep
// "do the area codes join to the geojson" check lives in ai/tools/geo.harness.ts;
// here we lock that the PROMPT routes to a map of the right shape.
type GeoExp = {
  level: GeoLevel;
  mode?: GeoMode;
  joinKey?: "nuts3" | "nuts4" | "ekatte";
  minAreas?: number;
};
type Case = {
  q: string;
  lang?: Lang;
  election?: string;
  tool: string | null; // null => router should decline (no tool)
  kind?: EnvelopeKind;
  minRows?: number;
  facts?: Record<string, FactExp>;
  geo?: GeoExp | false;
};

// stripped-digits compare so "51 881" / "51 881" / 51 all equal 51881
const digits = (v: unknown): string => String(v).replace(/[^\d]/g, "");
const norm = (v: unknown): string => String(v).replace(/[\s ]/g, "");

const matchFact = (actual: unknown, exp: FactExp): boolean => {
  if (exp instanceof RegExp) return exp.test(String(actual));
  if (typeof exp === "object") return digits(actual) === String(exp.num);
  return norm(actual).toLowerCase().includes(norm(exp).toLowerCase());
};

const CASES: Case[] = [
  // ---- parliamentary elections ----------------------------------------------
  {
    q: "Какъв е процентът машинно гласуване в последните 7 избора?",
    tool: "machineVoteSeries",
    kind: "series",
    facts: { elections_count: { num: 7 } },
  },
  {
    q: "machine voting in the last 7 elections",
    lang: "en",
    tool: "machineVoteSeries",
    facts: { elections_count: { num: 7 } },
  },
  {
    // "7 years" is a DATE window, not 7 elections: it covers since 2019, which
    // holds 8 elections (the 2021-04-04 election the 7-elections slice drops).
    q: "Какъв е процентът машинно гласуване в последните 7 години?",
    tool: "machineVoteSeries",
    kind: "series",
    facts: { window_years: { num: 7 }, elections_count: { num: 8 } },
  },
  {
    q: "turnout over the last 10 years",
    lang: "en",
    tool: "turnoutSeries",
    kind: "series",
    facts: { window_years: { num: 10 } },
  },
  {
    q: "Как се променя избирателната активност през годините?",
    tool: "turnoutSeries",
    kind: "series",
  },
  {
    q: "Какви са резултатите от последните избори?",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
    // every national-results answer carries a winner-per-oblast map
    geo: {
      level: "oblast",
      mode: "choropleth",
      joinKey: "nuts3",
      minAreas: 25,
    },
  },
  {
    // the "by region" intent (the hero map card) -> national results + oblast map
    q: "Покажи резултатите по области.",
    tool: "nationalResults",
    geo: {
      level: "oblast",
      mode: "choropleth",
      joinKey: "nuts3",
      minAreas: 25,
    },
  },
  {
    q: "Show the results by region.",
    lang: "en",
    tool: "nationalResults",
    geo: { level: "oblast", joinKey: "nuts3", minAreas: 25 },
  },
  {
    // bare multi-election year routed end-to-end -> combined results table
    // (party rows × one column per ballot)
    q: "Какви са резултатите от изборите 2024?",
    tool: "nationalResults",
    kind: "table",
    minRows: 2,
    facts: { year: /2024/, elections_count: { num: 2 } },
  },
  {
    // seats-per-party "in parliament" -> hemicycle (kind table + viz hemicycle),
    // NOT a roll-call or national-results table
    q: "Колко места има всяка партия в парламента?",
    tool: "parliamentSeats",
    kind: "table",
    minRows: 4,
    facts: { total_seats: { num: 240 }, majority: { num: 121 } },
  },
  {
    q: "How many seats does each party hold in parliament?",
    lang: "en",
    tool: "parliamentSeats",
    kind: "table",
    facts: { total_seats: { num: 240 }, parties_seated: { num: 5 } },
  },
  {
    q: "Колко гласа взе ГЕРБ?",
    tool: "partyResult",
    kind: "scalar",
    facts: { party: "ГЕРБ", pct: /\d/ },
  },
  {
    // EN latin party token must resolve to the Cyrillic record via matchParty's
    // romanization (otherwise "no party matched gerb")
    q: "How many votes did GERB get?",
    lang: "en",
    tool: "partyResult",
    kind: "scalar",
    facts: { party: "ГЕРБ", pct: /\d/ },
  },
  {
    q: "Как се представя ГЕРБ през годините?",
    tool: "partyTimeline",
    kind: "series",
    facts: { appearances: { num: 12 } },
  },
  {
    // a person name -> candidate preferential results, NOT national results
    q: "резултатите за Божидар Божанов",
    tool: "candidateResult",
    facts: { name: "Божанов" },
  },
  {
    q: "Какъв беше делът на машинното гласуване през 2023?",
    tool: "machineVoteShare",
    facts: { machine_share: /58/ },
  },
  {
    q: "Каква беше активността през 2023?",
    tool: "turnout",
    facts: { turnout: /\d/ },
  },
  {
    q: "Сравни изборите от 2022 и 2024",
    tool: "compareElections",
    kind: "table",
    minRows: 4,
  },
  {
    // bare compare, no explicit year -> default to the two most recent elections
    q: "сравни изборите последните 5 години",
    tool: "compareElections",
    kind: "table",
    minRows: 4,
  },
  {
    // compare phrasing but a party is named -> party-over-time, not compareElections
    q: "сравни изборите последните 5 години за ГЕРБ",
    tool: "partyTimeline",
    kind: "series",
  },
  {
    q: "Къде е силна ГЕРБ?",
    tool: "regionBreakdown",
    kind: "table",
    facts: { strongest: "Ловеч" },
    // a party's regional strength shades every oblast by its share (ramp)
    geo: {
      level: "oblast",
      mode: "choropleth",
      joinKey: "nuts3",
      minAreas: 25,
    },
  },
  {
    // drill-down: a party by municipality within one oblast → muni ramp map
    q: "ГЕРБ по общини във Варна",
    tool: "municipalityBreakdown",
    kind: "table",
    geo: {
      level: "municipality",
      mode: "choropleth",
      joinKey: "nuts4",
      minAreas: 5,
    },
  },
  {
    // drill-down: a party by settlement within one município → settlement ramp.
    // "в община Варна" must NOT divert to the municipality rule.
    q: "ГЕРБ по населени места в община Варна",
    tool: "settlementBreakdown",
    kind: "table",
    geo: {
      level: "settlement",
      mode: "choropleth",
      joinKey: "ekatte",
      minAreas: 2,
    },
  },
  {
    // EN party-map: the router extracts the latin token "gerb"; matchParty
    // romanizes both sides so it resolves to the Cyrillic-only record (ГЕРБ-СДС)
    // and the oblast share map renders (regression for the latin-token fix).
    q: "Where is GERB strongest?",
    lang: "en",
    tool: "regionBreakdown",
    geo: {
      level: "oblast",
      mode: "choropleth",
      joinKey: "nuts3",
      minAreas: 25,
    },
  },
  {
    q: "Имаше ли нередности на последните избори?",
    tool: "electionAnomalies",
    facts: { problem_sections: { num: 138 } },
  },
  {
    // a per-party flash-memory question must answer about parties, NOT fall
    // through to the generic anomalies counter
    q: "кои партии загубиха най-много от липсваща флаш памет",
    tool: "flashMemoryByParty",
    kind: "table",
    minRows: 1,
    facts: { biggest_loser: /\(/ },
  },
  {
    q: "which parties lost the most from missing flash memory",
    lang: "en",
    tool: "flashMemoryByParty",
    kind: "table",
    minRows: 1,
  },
  {
    // machine-vote share BY PARTY -> per-party tool, not the party-blind national
    // machine-share metric
    q: "кои партии гласуват най-много машинно",
    tool: "machineVoteByParty",
    kind: "table",
    minRows: 2,
    facts: { most_machine: /%/ },
  },
  {
    // EN "vs" must not be read as a two-election comparison here
    q: "machine vs paper voting by party",
    lang: "en",
    tool: "machineVoteByParty",
    kind: "table",
    minRows: 2,
  },
  {
    q: "Как се променя активността в Хасково?",
    tool: "regionHistory",
    kind: "series",
    facts: { oblast: "Хасково" },
  },
  {
    q: "Къде отидоха гласовете на последните избори?",
    tool: "voteTransitions",
    kind: "table",
    minRows: 1,
  },
  // ---- polls -----------------------------------------------------------------
  {
    q: "Коя социологическа агенция е най-точна?",
    tool: "pollAccuracy",
    kind: "table",
    facts: { most_accurate: "Алфа", best_grade: "A+" },
  },
  {
    q: "Колко е точна Алфа Рисърч?",
    tool: "agencyProfile",
    kind: "scalar",
    facts: { grade: "A+" },
  },
  {
    q: "Какво показват последните проучвания?",
    tool: "latestPolls",
    kind: "table",
    facts: { leader: /%/ },
  },
  { q: "Какво би станало ако изборите бяха сега?", tool: "latestPolls" },
  // ---- local elections -------------------------------------------------------
  {
    q: "Кой спечели общинските съвети?",
    tool: "localCouncilVoteShare",
    kind: "table",
    facts: { leader: "ГЕРБ" },
  },
  {
    // a named year selects that local cycle — previously the router dropped the
    // year and resolveLocalCycle silently answered for the latest (2023) cycle.
    q: "Кой спечели общинските съвети през 2019?",
    tool: "localCouncilVoteShare",
    kind: "table",
    facts: { cycle: "2019" },
  },
  {
    q: "Колко кмета спечели ГЕРБ на местните избори?",
    tool: "localMayorsWon",
    facts: { leader: "ГЕРБ" },
  },
  {
    q: "Кой е кметът на Пловдив?",
    tool: "localMunicipality",
    kind: "scalar",
    facts: { mayor: "Костадин" },
  },
  {
    q: "Кои бяха кандидатите за кмет на Варна?",
    tool: "localMayorRace",
    kind: "table",
    facts: { winner: "Коцев" },
  },
  {
    // per-município council -> hemicycle (kind table + viz hemicycle); 51 seats
    // -> majority 26, no single-party majority
    q: "Какъв е общинският съвет на Бургас?",
    tool: "localCouncil",
    kind: "table",
    facts: { total_seats: { num: 51 }, majority: { num: 26 } },
  },
  {
    q: "Има ли частични местни избори?",
    tool: "chmiEvents",
    kind: "table",
    facts: { total: { num: 379 } },
  },
  // ---- local: mayors over cycles + place comparison --------------------------
  {
    q: "Кои са последните кметове на София?",
    tool: "localMayorHistory",
    kind: "table",
    minRows: 4,
    facts: { latest_mayor: "Терзиев" },
  },
  {
    q: "Сравни Варна и Бургас",
    tool: "comparePlaces",
    kind: "table",
    minRows: 3,
    facts: { a: "Варна", b: "Бургас" },
  },
  {
    q: "compare Plovdiv and Varna",
    lang: "en",
    tool: "comparePlaces",
    kind: "table",
    minRows: 3,
  },
  {
    // Sofia районs (districts) — sub-municipal mayors
    q: "Кои са районните кметове на София?",
    tool: "localSubMayors",
    kind: "table",
    minRows: 20,
    facts: { level: "районни" },
  },
  {
    // a regular município's settlement (kmetstvo) mayors
    q: "Кметове на кметствата в Асеновград",
    tool: "localSubMayors",
    kind: "table",
    minRows: 10,
    facts: { place: "Асеновград" },
  },
  {
    // oblast-wide mayors-by-party rollup (canonicalised across the province)
    q: "Колко кметове спечели всяка партия в област Пловдив?",
    tool: "localOblastMayors",
    kind: "table",
    minRows: 4,
    facts: { oblast: "Пловдив", leader: "БСП-ОЛ" },
  },
  {
    q: "mayors won by party in Varna province",
    lang: "en",
    tool: "localOblastMayors",
    kind: "table",
    minRows: 3,
    facts: { leader: "ГЕРБ-СДС" },
  },
  // ---- fiscal ----------------------------------------------------------------
  {
    q: "Какъв е държавният бюджет?",
    tool: "budgetOverview",
    kind: "table",
    minRows: 4,
  },
  {
    // a named fiscal year selects that year's execution (router -> args.year)
    q: "Какъв е държавният бюджет за 2022?",
    tool: "budgetOverview",
    kind: "table",
    facts: { year: { num: 2022 } },
  },
  {
    q: "За какво се харчи бюджетът?",
    tool: "budgetByFunction",
    kind: "table",
    minRows: 5,
  },
  {
    // year selection on the functional breakdown
    q: "За какво се харчи бюджетът през 2021?",
    tool: "budgetByFunction",
    kind: "table",
    facts: { year: { num: 2021 } },
  },
  {
    // year selection on a single function slice
    q: "Колко се отделя за здравеопазване през 2022?",
    tool: "budgetFunction",
    kind: "series",
    facts: { year: { num: 2022 }, function: "Здравеопазв" },
  },
  {
    q: "Покажи изпълнението на бюджета по месеци",
    tool: "budgetExecution",
    kind: "series",
  },
  {
    q: "Какъв е бюджетът на Министерството на транспорта?",
    tool: "ministryBudget",
    facts: { ministry: "транспорт" },
  },
  {
    q: "Кои са най-големите инвестиционни проекти?",
    tool: "investmentProjects",
    kind: "table",
    facts: { project_count: { num: 3065 } },
  },
  {
    q: "Колко са обществените поръчки?",
    tool: "procurementTotals",
    facts: { contracts: /\d/ },
  },
  {
    q: "Колко обществени поръчки има в Русе?",
    tool: "procurementBySettlement",
    facts: { total: /€/ },
  },
  {
    q: "Кой получава най-много европейски средства?",
    tool: "fundsOverview",
    kind: "table",
    minRows: 5,
  },
  {
    q: "Какви са последните емисии на държавен дълг?",
    tool: "govDebt",
    kind: "table",
    minRows: 1,
    facts: { total_recent: /€/ },
  },
  {
    q: "Колко харчи НОИ за пенсии?",
    tool: "noiFunds",
    facts: { year: /20\d\d/ },
  },
  // ---- budget slices: a specific function/category, not the whole budget ------
  {
    // pensions phrased "в бюджета" must NOT return the whole-budget overview
    q: "какъв е процентът на пенсиите в бюджета?",
    tool: "noiFunds",
    facts: { year: /20\d\d/ },
  },
  {
    q: "колко пари отиват за здравеопазване?",
    tool: "budgetFunction",
    kind: "series",
    facts: { function: "Здраве", share_of_budget: /%/ },
  },
  {
    q: "разходи за отбрана",
    tool: "budgetFunction",
    kind: "series",
    facts: { function: "Отбрана", share_of_budget: /%/ },
  },
  {
    q: "колко за образование?",
    tool: "budgetFunction",
    kind: "series",
    facts: { function: "Образование" },
  },
  {
    q: "разходи за социална защита",
    tool: "budgetFunction",
    kind: "series",
    facts: { function: "Социална" },
  },
  {
    q: "defence spending",
    lang: "en",
    tool: "budgetFunction",
    kind: "series",
    facts: { function: "Defence" },
  },
  // whole-budget questions still hit the overview / functional table
  {
    q: "какъв е държавният бюджет?",
    tool: "budgetOverview",
    kind: "table",
    minRows: 4,
  },
  // ---- people ----------------------------------------------------------------
  {
    q: "Кои са правителствата от 2005?",
    tool: "governments",
    kind: "table",
    minRows: 5,
  },
  {
    q: "Кои депутати са най-богати?",
    tool: "mpAssetsTop",
    kind: "table",
    facts: { richest: "Пеевски" },
  },
  {
    q: "Кои депутати имат най-много фирмени връзки?",
    tool: "mpConnectionsTop",
    facts: { most_connected: "Михайлов" },
  },
  {
    // "which PARTY" (not which MP) -> per-party rollup
    q: "коя партия има най-богати депутати",
    tool: "mpAssetsByParty",
    kind: "table",
    minRows: 2,
    facts: { richest_party: /\(/ },
  },
  {
    // declines today (no "депутат" keyword) -> must now route to the party rollup
    q: "кои партии имат най-много бизнес връзки",
    tool: "mpConnectionsByParty",
    kind: "table",
    minRows: 2,
  },
  {
    q: "Кои министри са най-богати?",
    tool: "officialsAssetsTop",
    kind: "table",
    minRows: 1,
  },
  {
    q: "Партиите подават ли финансови отчети навреме?",
    tool: "financingOverview",
    facts: { distinct_parties: { num: 236 } },
  },
  // ---- indicators ------------------------------------------------------------
  {
    q: "Каква е инфлацията?",
    tool: "macroIndicator",
    kind: "series",
    facts: { indicator: "нфлация" },
  },
  {
    // a named year pins the indicator's as-of point (still draws the full trend)
    q: "Каква беше инфлацията през 2019?",
    tool: "macroIndicator",
    kind: "series",
    facts: { latest_period: /2019/ },
  },
  { q: "Как е икономиката?", tool: "macroOverview", kind: "table", minRows: 3 },
  {
    q: "Покажи показателите за управление",
    tool: "macroByCategory",
    kind: "table",
    minRows: 3,
  },
  {
    q: "Каква е безработицата в Сливен?",
    tool: "subnationalIndicator",
    kind: "series",
    facts: { place: "Сливен" },
  },
  {
    // per-município indicator pinned to a year
    q: "Каква беше безработицата в Сливен през 2019?",
    tool: "subnationalIndicator",
    kind: "series",
    facts: { place: "Сливен", latest_year: { num: 2019 } },
  },
  {
    q: "Какъв е БВП на човек във Варна?",
    tool: "regionIndicator",
    kind: "series",
    facts: { oblast: "Варна" },
  },
  {
    // per-oblast indicator pinned to a year
    q: "Какъв беше БВП на човек във Варна през 2020?",
    tool: "regionIndicator",
    kind: "series",
    facts: { oblast: "Варна", latest_year: { num: 2020 } },
  },
  // ---- ranking across a tier (slice the whole level, not one place) ----------
  {
    q: "кои общини са с най-висока безработица?",
    tool: "rankPlaces",
    kind: "table",
    facts: { indicator: "безработица", order: "най-високи", level: "общини" },
  },
  {
    q: "коя област е с най-висок БВП на човек?",
    tool: "rankPlaces",
    kind: "table",
    facts: { level: "области" },
  },
  {
    q: "топ 5 области по нетна миграция",
    tool: "rankPlaces",
    kind: "table",
    minRows: 5,
    facts: { level: "области" },
  },
  {
    q: "коя е най-прозрачната община?",
    tool: "rankPlaces",
    kind: "table",
    facts: { indicator: "Прозрачност" },
  },
  {
    q: "кои общини са с най-нисък среден успех на матурите?",
    tool: "rankPlaces",
    kind: "table",
    facts: { order: "най-ниски" },
  },
  {
    q: "Колко прозрачна е община Русе?",
    tool: "transparencyScore",
    facts: { composite: /\d/ },
  },
  {
    q: "Какви са данъците в Пловдив?",
    tool: "localTaxes",
    kind: "table",
    minRows: 1,
    facts: { place: "Пловдив" },
  },
  // ---- place ("my area") -----------------------------------------------------
  {
    q: "Разкажи ми за Габрово",
    tool: "governanceProfile",
    kind: "scalar",
    facts: { population: { num: 51881 } },
  },
  {
    // as-of year re-anchors the year-aware slices (local cycle + indicators) —
    // the 2019 mayor/turnout/unemployment, not the latest
    q: "Разкажи ми за Габрово през 2019",
    tool: "governanceProfile",
    kind: "scalar",
    facts: { local_turnout: /\(2019\)/, unemployment: /\(2019\)/ },
  },
  {
    q: "Колко жители има Видин?",
    tool: "census",
    facts: { population: { num: 47847 } },
  },
  {
    q: "Какво е регистрираното население на Габрово?",
    tool: "graoPopulation",
    facts: { permanent: { num: 57970 } },
  },
  {
    q: "Какъв е въздухът в Перник?",
    tool: "airQuality",
    kind: "table",
    minRows: 1,
  },
  {
    q: "Какво реши общинският съвет на Русе?",
    tool: "councilResolutions",
    kind: "table",
    minRows: 1,
  },
  {
    q: "Колко гора има в България?",
    tool: "landUse",
    kind: "table",
    minRows: 5,
  },
  // ---- routing robustness: phrasings that previously mis-routed (esp. under a
  //      weak model) — compare/results must never become machine-voting --------
  {
    q: "сравни последните избори",
    tool: "compareElections",
    kind: "table",
    minRows: 4,
  },
  {
    q: "сравни изборите през последните години",
    tool: "compareElections",
    kind: "table",
    minRows: 4,
  },
  {
    q: "compare the last elections",
    lang: "en",
    tool: "compareElections",
    kind: "table",
    minRows: 4,
  },
  {
    q: "сравни 2021 и 2023",
    tool: "compareElections",
    kind: "table",
    minRows: 4,
  },
  // general "results / what happened / overview" -> nationalResults, never machine
  {
    q: "какво стана на изборите",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  {
    q: "обобщи последните избори",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  {
    q: "покажи резултатите",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  {
    q: "election results",
    lang: "en",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  {
    q: "election overview",
    lang: "en",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  {
    q: "who won the latest election",
    lang: "en",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  // election-topic catch-all -> sensible default (results), not a decline
  {
    q: "изборите ме интересуват",
    tool: "nationalResults",
    kind: "table",
    minRows: 5,
  },
  // machine voting ONLY when explicitly asked
  {
    q: "машинно гласуване 2023",
    tool: "machineVoteShare",
    facts: { machine_share: /\d/ },
  },
  {
    q: "машинно гласуване през годините",
    tool: "machineVoteSeries",
    kind: "series",
  },
  {
    q: "machine voting over time",
    lang: "en",
    tool: "machineVoteSeries",
    kind: "series",
  },
  // turnout disambiguation: 2021 held 3 elections, so a bare year fans out into
  // one combined comparison (a bar per ballot) instead of silently picking Nov.
  {
    q: "turnout in 2021",
    lang: "en",
    tool: "turnout",
    kind: "series",
    minRows: 3,
    facts: { year: /2021/, elections_count: { num: 3 } },
  },
  {
    // a month NAME pins one ballot of a multi-election year via the keyword
    // router's detectMonth — must resolve to that ballot, NOT fan out
    q: "Каква беше активността през юли 2021?",
    tool: "turnout",
    kind: "scalar",
    facts: { turnout: /\d/, election: "2021" },
  },
  { q: "избирателна активност", tool: "turnoutSeries", kind: "series" },
  // party phrasings
  {
    q: "колко гласа взе БСП",
    tool: "partyResult",
    kind: "scalar",
    facts: { party: "БСП" },
  },
  {
    q: "как се представя ДПС през годините",
    tool: "partyTimeline",
    kind: "series",
  },
  // ---- election integrity & anomalies ----------------------------------------
  {
    q: "Как гласуват ромските квартали?",
    tool: "problemSections",
    kind: "table",
    facts: { neighborhoods: { num: 8 } },
  },
  {
    q: "Има ли контролиран вот?",
    tool: "problemSections",
    kind: "table",
    minRows: 1,
  },
  {
    q: "Какъв е индексът на изборния риск?",
    tool: "riskScore",
    kind: "table",
    minRows: 4,
    facts: { critical: /\d/ },
  },
  { q: "Колко критични секции има?", tool: "riskScore", kind: "table" },
  {
    q: "Има ли клъстери на изборния риск?",
    tool: "riskClusters",
    kind: "table",
    minRows: 1,
    facts: { clusters: /\d/ },
  },
  {
    // "which party is in the riskiest sections" -> the party-grounded clusters
    // tool, not the party-blind risk-band index
    q: "коя партия е в най-рисковите секции",
    tool: "riskClusters",
    kind: "table",
    minRows: 1,
  },
  {
    q: "Кои места са с устойчив изборен риск?",
    tool: "clusterPersistence",
    kind: "table",
    minRows: 1,
    facts: { loci: /\d/ },
  },
  {
    q: "Какво показва тестът на Бенфорд?",
    tool: "benfordAnomalies",
    kind: "table",
    minRows: 1,
    facts: { parties_tested: /\d/ },
  },
  {
    q: "Benford test for the latest election",
    lang: "en",
    tool: "benfordAnomalies",
    kind: "table",
  },
  {
    q: "Колко гласове са прахосани под прага?",
    tool: "wastedVotes",
    kind: "table",
    minRows: 1,
    facts: { national_share: /%/ },
  },
  { q: "wasted votes", lang: "en", tool: "wastedVotes", kind: "table" },
  {
    // "which party wasted the most" -> per-party ranking (previously declined:
    // "прахоса" didn't match "прахосан")
    q: "коя партия прахоса най-много гласове",
    tool: "wastedVotesByParty",
    kind: "table",
    minRows: 2,
    facts: { top_wasted: /\(/ },
  },
  {
    q: "which party wasted the most votes",
    lang: "en",
    tool: "wastedVotesByParty",
    kind: "table",
    minRows: 2,
  },
  {
    // recount-by-party: only 2024-10-27 has recount data (region_votes.original)
    q: "кои партии загубиха от преброяване наново",
    election: "2024_10_27",
    tool: "recountByParty",
    kind: "table",
    minRows: 2,
    facts: { biggest_loser: /\(/ },
  },
  {
    // a cycle WITHOUT a recount -> honest no-recount scalar, still routed here
    q: "кои партии загубиха от преброяване наново",
    tool: "recountByParty",
    kind: "scalar",
  },
  {
    q: "Кои населени места са съмнителни?",
    tool: "suspiciousSettlements",
    kind: "table",
    minRows: 3,
    facts: { concentrated: /\d/ },
  },
  {
    q: "Как гласува диаспората?",
    tool: "diasporaVote",
    kind: "table",
    minRows: 1,
    facts: { leader: /%/ },
  },
  {
    q: "How did the diaspora vote?",
    lang: "en",
    tool: "diasporaVote",
    kind: "table",
  },
  {
    q: "Колко избиратели запазиха своя вот?",
    tool: "voterPersistence",
    kind: "table",
    minRows: 1,
    facts: { national_stay_rate: /%/ },
  },
  // ---- demographics (census correlations) ------------------------------------
  {
    q: "Кой гласува за Възраждане?",
    tool: "partyDemographics",
    kind: "table",
    minRows: 1,
    facts: { party: "Възраждане" },
  },
  {
    q: "Демографски профил на ДПС",
    tool: "partyDemographics",
    kind: "table",
    facts: { party: "ДПС" },
  },
  {
    q: "Какво разделя гласоподавателите?",
    tool: "demographicCleavages",
    kind: "table",
    minRows: 1,
    facts: { most_divisive: /\(/ },
  },
  // ---- parliament roll-call --------------------------------------------------
  {
    q: "Кои депутати са най-лоялни?",
    tool: "mpLoyalty",
    kind: "table",
    minRows: 1,
    facts: { ns: "52", most_loyal: /%/ },
  },
  {
    q: "which MPs are most loyal?",
    lang: "en",
    tool: "mpLoyalty",
    kind: "table",
  },
  {
    q: "Кои депутати отсъстват най-много?",
    tool: "mpAttendance",
    kind: "table",
    minRows: 1,
    facts: { worst_attendance: /%/ },
  },
  {
    q: "Коя група гласува най-единно?",
    tool: "factionCohesion",
    kind: "table",
    minRows: 1,
    facts: { most_cohesive: /%/ },
  },
  {
    q: "Как гласува Бойко Борисов в парламента?",
    tool: "mpVotingProfile",
    kind: "scalar",
    facts: { name: "Борисов" },
  },
  {
    q: "Кой гласува като Асен Василев?",
    tool: "mpSimilarity",
    kind: "table",
    minRows: 1,
    facts: { mp: "Василев" },
  },
  {
    // EN-spelled MP name resolves against the Cyrillic roster via romanization
    q: "who votes like Asen Vasilev?",
    lang: "en",
    tool: "mpSimilarity",
    kind: "table",
    minRows: 1,
    facts: { mp: "Василев" },
  },
  {
    q: "How does Boyko Borisov vote in parliament?",
    lang: "en",
    tool: "mpVotingProfile",
    kind: "scalar",
    facts: { name: "Борисов" },
  },
  {
    q: "Как гласува парламентът за бюджета?",
    tool: "voteSearch",
    kind: "table",
    minRows: 1,
    facts: { matches: /\d/ },
  },
  {
    q: "Кои са най-оспорваните гласувания?",
    tool: "voteSearch",
    kind: "table",
    minRows: 1,
  },
  // ---- schools ---------------------------------------------------------------
  {
    q: "Кои са най-добрите училища в Пловдив?",
    tool: "schoolScores",
    kind: "table",
    minRows: 1,
    facts: { place: "Пловдив" },
  },
  {
    q: "best schools in Plovdiv",
    lang: "en",
    tool: "schoolScores",
    kind: "table",
  },
  // ---- a specific election year for a new tool -------------------------------
  { q: "индекс на риска 2023", tool: "riskScore", kind: "table" },
  // ---- BORDER CASES: disambiguation between new and existing tools -----------
  // "Roma in X" (count) -> census, NOT the problem-sections feature
  {
    q: "колко роми има във Видин",
    tool: "census",
    facts: { population: /\d/ },
  },
  // "проблемни секции" -> the anomaly counter, NOT the Roma-neighbourhood tool
  {
    q: "проблемни секции на последните избори",
    tool: "electionAnomalies",
    facts: { problem_sections: /\d/ },
  },
  // "кой гласува за X" (a party) -> demographics; "колко гласа взе X" -> result
  { q: "кой гласува за ГЕРБ", tool: "partyDemographics", kind: "table" },
  {
    q: "колко гласа взе ГЕРБ",
    tool: "partyResult",
    kind: "scalar",
    facts: { party: "ГЕРБ" },
  },
  // a named MP "in parliament" -> roll-call profile; bare name -> preferences
  {
    q: "как гласува Бойко Борисов в парламента",
    tool: "mpVotingProfile",
    kind: "scalar",
  },
  {
    q: "резултатите за Бойко Борисов",
    tool: "candidateResult",
    facts: { name: "Борисов" },
  },
  // "училища в X" -> per-school scores; bare "матура в X" -> municipal average
  {
    q: "най-добрите училища в Сливен",
    tool: "schoolScores",
    kind: "table",
  },
  {
    q: "среден успех на матурите в Сливен",
    tool: "subnationalIndicator",
    kind: "series",
    facts: { place: "Сливен" },
  },
  // ---- BORDER CASES: graceful failure on unknown entities --------------------
  {
    // unknown município -> localMunicipality declines cleanly (scalar, no mayor)
    q: "Кой е кметът на Несъществуевоград?",
    tool: "localMunicipality",
    kind: "scalar",
  },
  {
    q: "Колко жители има Несъществуевоград?",
    tool: "census",
    kind: "scalar",
  },
  {
    q: "Как гласува Иван Несъществуващ в парламента?",
    tool: "mpVotingProfile",
    kind: "scalar",
  },
  {
    q: "Кои са най-добрите училища в Несъществуевоград?",
    tool: "schoolScores",
    kind: "scalar",
  },
  {
    // oldest election (2005) has no prior -> voterPersistence declines cleanly
    q: "Колко избиратели запазиха своя вот?",
    election: "2005_06_25",
    tool: "voterPersistence",
    kind: "scalar",
  },
  {
    // a vote-search term that matches no title -> graceful "not found" scalar
    q: "как гласува парламентът за еднорози",
    tool: "voteSearch",
    kind: "scalar",
  },
  // ---- negative --------------------------------------------------------------
  { q: "времето е хубаво днес", tool: null },
  { q: "разкажи ми виц", tool: null },
  { q: "колко е 2 плюс 2", tool: null },
  { q: "рецепта за баница", tool: null },
  { q: "what's the weather like today?", lang: "en", tool: null },
  { q: "tell me a story about dragons", lang: "en", tool: null },
];

// Raw-arg cases: the LLM router emits {tool, args} directly and can't know the
// exact ballot date, so it passes a bare year / loose date as `election`. These
// run the tool with those raw args (bypassing the keyword router, which would
// have pre-resolved the year) to assert resolveElection maps them to the right
// election rather than silently falling back to the selected one.
type ArgCase = {
  label: string;
  tool: string;
  args: Record<string, unknown>;
  election?: string; // the SELECTED election (the wrong-fallback target)
  facts: Record<string, FactExp>;
};
const ARG_CASES: ArgCase[] = [
  {
    // the reported bug: "turnout in 2023" under the cloud model answered for the
    // selected 2026 election. A bare year must resolve to that year's election.
    label: 'turnout election:"2023" (selected 2026)',
    tool: "turnout",
    args: { election: "2023" },
    election: "2026_04_19",
    facts: { election: "2023", turnout: { num: 4051 } },
  },
  {
    // a loose hyphenated date the model might emit
    label: 'turnout election:"2024-06-09"',
    tool: "turnout",
    args: { election: "2024-06-09" },
    election: "2026_04_19",
    facts: { election: "2024" },
  },
  {
    // multi-election year + a month disambiguates to the right ballot
    label: 'turnout election:"2021_07" -> July 2021',
    tool: "turnout",
    args: { election: "2021_07" },
    election: "2026_04_19",
    facts: { election: "2021" },
  },
  {
    // bare 2021 (3 elections) -> combined comparison across the year's ballots
    // (a scalar metric fans out into a bar series), not the newest alone.
    label: 'turnout election:"2021" -> combined 2021',
    tool: "turnout",
    args: { election: "2021" },
    election: "2026_04_19",
    facts: { year: /2021/, elections_count: { num: 3 } },
  },
  {
    // national results keyed by a bare year (same resolver, different tool)
    label: 'nationalResults election:"2022"',
    tool: "nationalResults",
    args: { election: "2022" },
    election: "2026_04_19",
    facts: { election: "2022" },
  },
  {
    // bare multi-election year on a TABLE tool -> aligned comparison table
    // (party rows × one votes column per ballot)
    label: 'nationalResults election:"2024" -> combined 2024',
    tool: "nationalResults",
    args: { election: "2024" },
    election: "2026_04_19",
    facts: { year: /2024/, elections_count: { num: 2 } },
  },
  {
    // LOCAL: a bare year resolves to that year's cycle (2015 -> 2015_10_25_mi),
    // not the latest — mirrors resolveElection for the municipal data tree.
    label: 'localCouncilVoteShare cycle:"2015"',
    tool: "localCouncilVoteShare",
    args: { cycle: "2015" },
    facts: { cycle: "2015" },
  },
];

let failures = 0;
const fail = (q: string, msg: string) => {
  failures += 1;
  console.error(`  ✗ "${q}"\n      ${msg}`);
};

const run = async () => {
  for (const c of CASES) {
    const ctx: ToolContext = {
      lang: c.lang ?? "bg",
      election: c.election ?? LATEST,
    };
    const r = route(c.q, ctx);
    const got = r?.tool ?? null;
    if (got !== c.tool) {
      fail(c.q, `routed to ${got ?? "(none)"}, expected ${c.tool ?? "(none)"}`);
      continue;
    }
    if (c.tool === null) continue; // negative case routed correctly
    let env: Envelope;
    try {
      env = (await runTool(r!.tool, r!.args, ctx)) as Envelope;
    } catch (e) {
      fail(c.q, `tool threw: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (c.kind && env.kind !== c.kind) {
      fail(c.q, `kind ${env.kind}, expected ${c.kind}`);
      continue;
    }
    if (c.minRows != null) {
      const n = env.rows?.length ?? env.series?.[0]?.points.length ?? 0;
      if (n < c.minRows) {
        fail(c.q, `${n} rows/points, expected >= ${c.minRows}`);
        continue;
      }
    }
    for (const [k, exp] of Object.entries(c.facts ?? {})) {
      if (!(k in env.facts) || !matchFact(env.facts[k], exp)) {
        fail(
          c.q,
          `fact "${k}"=${JSON.stringify(env.facts[k])} did not match ${exp}`,
        );
      }
    }
    if (c.geo === false) {
      if (env.geo)
        fail(c.q, `expected no map, got ${env.geo.level}/${env.geo.mode}`);
    } else if (c.geo) {
      const g = env.geo;
      if (!g) {
        fail(c.q, `expected a ${c.geo.level} map overlay, got none`);
      } else {
        if (g.level !== c.geo.level)
          fail(c.q, `geo level ${g.level}, expected ${c.geo.level}`);
        if (c.geo.mode && g.mode !== c.geo.mode)
          fail(c.q, `geo mode ${g.mode}, expected ${c.geo.mode}`);
        if (c.geo.joinKey && g.joinKey !== c.geo.joinKey)
          fail(c.q, `geo joinKey ${g.joinKey}, expected ${c.geo.joinKey}`);
        if (c.geo.minAreas != null && (g.areas?.length ?? 0) < c.geo.minAreas)
          fail(
            c.q,
            `geo ${g.areas?.length ?? 0} areas, expected >= ${c.geo.minAreas}`,
          );
      }
    }
  }

  // LLM-router arg resolution (bare year / loose date), bypassing the keyword
  // router so we exercise resolveElection on the raw shape the model emits.
  for (const c of ARG_CASES) {
    const ctx: ToolContext = {
      lang: "bg",
      election: c.election ?? LATEST,
    };
    let env: Envelope;
    try {
      env = (await runTool(c.tool, c.args, ctx)) as Envelope;
    } catch (e) {
      fail(
        c.label,
        `tool threw: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    for (const [k, exp] of Object.entries(c.facts)) {
      if (!(k in env.facts) || !matchFact(env.facts[k], exp)) {
        fail(
          c.label,
          `fact "${k}"=${JSON.stringify(env.facts[k])} did not match ${exp}`,
        );
      }
    }
  }

  const total = CASES.length + ARG_CASES.length;
  const passed = total - failures;
  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — ${passed}/${total} regression cases`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
