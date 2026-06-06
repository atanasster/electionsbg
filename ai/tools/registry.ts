// The tool registry: the single surface the orchestrator (and the dropdown
// harness) sees. The grammar-constrained LLM picks a tool name + args from here.
// Tools are grouped by `domain` for routing + the Explorer dropdown.

import {
  budgetByFunction,
  budgetFunction,
  budgetOverview,
  fundsOverview,
  procurementTotals,
} from "./fiscal";
import { governments } from "./govpeople";
import {
  localCouncilVoteShare,
  localMayorsWon,
  localMunicipality,
} from "./local";
import {
  budgetExecution,
  investmentProjects,
  ministryBudget,
} from "./budgetDepth";
import { census } from "./census";
import {
  electionAnomalies,
  regionBreakdown,
  regionHistory,
  voteTransitions,
} from "./electionDepth";
import { govDebt, noiFunds } from "./fiscalDebt";
import {
  chmiEvents,
  localCouncil,
  localMayorHistory,
  localMayorRace,
} from "./localDetail";
import { macroByCategory, macroIndicator, macroOverview } from "./macro";
import {
  airQuality,
  councilResolutions,
  graoPopulation,
  landUse,
} from "./placeData";
import {
  financingOverview,
  mpAssetsTop,
  mpConnectionsTop,
  officialsAssetsTop,
  pollAccuracy,
} from "./people";
import {
  comparePlaces,
  governanceProfile,
  procurementBySettlement,
} from "./profile";
import {
  localTaxes,
  rankPlaces,
  regionIndicator,
  subnationalIndicator,
  transparencyScore,
} from "./placesGov";
import { compareElections, machineVoteShare, turnout } from "./metrics";
import { candidateResult } from "./candidate";
import { nationalResults, partyResult } from "./national";
import { partyTimeline } from "./parties";
import { agencyProfile, latestPolls } from "./pollsDepth";
import { machineVoteSeries, turnoutSeries } from "./series";
import type { Domain, ToolArgs, ToolContext, ToolDef } from "./types";

export const TOOLS: ToolDef[] = [
  // ---- parliamentary elections ----------------------------------------------
  {
    name: "nationalResults",
    domain: "elections",
    description: {
      bg: "Национални резултати за един избор: гласове, %, мандати по партия.",
      en: "National results for one election: votes, %, seats per party.",
    },
    params: [
      {
        name: "election",
        type: "election",
        description: {
          bg: "Дата на избора (по подразбиране последния).",
          en: "Election date (defaults to latest).",
        },
      },
    ],
    examples: [
      {
        bg: "Какви са резултатите от последните избори?",
        en: "Results of the latest election?",
      },
    ],
    run: nationalResults,
  },
  {
    name: "partyResult",
    domain: "elections",
    description: {
      bg: "Резултатът на една партия за един избор.",
      en: "One party's result in one election.",
    },
    params: [
      {
        name: "party",
        type: "party",
        required: true,
        description: { bg: "Партия", en: "Party" },
      },
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      { bg: "Колко гласа взе ГЕРБ?", en: "How many votes did GERB get?" },
    ],
    run: partyResult,
  },
  {
    name: "candidateResult",
    domain: "elections",
    description: {
      bg: "Преференциални резултати на кандидат по име.",
      en: "A candidate's preferential-vote results by name.",
    },
    params: [
      {
        name: "name",
        type: "person",
        required: true,
        description: { bg: "Име на кандидата", en: "Candidate name" },
      },
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      {
        bg: "Резултатите за Божидар Божанов",
        en: "Results for Bozhidar Bozhanov",
      },
      {
        bg: "Преференции на Делян Пеевски",
        en: "Preferential votes for Delyan Peevski",
      },
    ],
    run: candidateResult,
  },
  {
    name: "machineVoteShare",
    domain: "elections",
    description: {
      bg: "Дял на машинното гласуване за един избор.",
      en: "Machine-voting share for one election.",
    },
    params: [
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      { bg: "Машинно гласуване през 2023?", en: "Machine voting in 2023?" },
    ],
    run: machineVoteShare,
  },
  {
    name: "turnout",
    domain: "elections",
    description: {
      bg: "Избирателна активност за един избор.",
      en: "Voter turnout for one election.",
    },
    params: [
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      {
        bg: "Каква беше активността на последните избори?",
        en: "Turnout in the latest election?",
      },
    ],
    run: turnout,
  },
  {
    name: "compareElections",
    domain: "elections",
    description: {
      bg: "Сравнение на два избора.",
      en: "Compare two elections.",
    },
    params: [
      {
        name: "a",
        type: "election",
        required: true,
        description: { bg: "Първи избор", en: "First election" },
      },
      {
        name: "b",
        type: "election",
        description: { bg: "Втори избор", en: "Second election" },
      },
    ],
    examples: [{ bg: "Сравни 2022 и 2024", en: "Compare 2022 and 2024" }],
    run: compareElections,
  },
  {
    name: "machineVoteSeries",
    domain: "elections",
    description: {
      bg: "Дял на машинното гласуване през последните N избора (тренд).",
      en: "Machine-voting share across the last N elections.",
    },
    params: [
      {
        name: "n",
        type: "count",
        default: 7,
        description: { bg: "Брой избори", en: "Number of elections" },
      },
    ],
    examples: [
      {
        bg: "Машинно гласуване в последните 7 избора?",
        en: "Machine voting in the last 7 elections?",
      },
    ],
    run: machineVoteSeries,
  },
  {
    name: "turnoutSeries",
    domain: "elections",
    description: {
      bg: "Избирателна активност през последните N избора (тренд).",
      en: "Voter turnout across the last N elections.",
    },
    params: [
      {
        name: "n",
        type: "count",
        default: 7,
        description: { bg: "Брой избори", en: "Number of elections" },
      },
    ],
    examples: [
      {
        bg: "Как се променя активността през годините?",
        en: "How has turnout changed over the years?",
      },
    ],
    run: turnoutSeries,
  },
  {
    name: "partyTimeline",
    domain: "elections",
    description: {
      bg: "Дял на една партия през всички избори (с проследяване на преименувания).",
      en: "One party's vote share across all elections.",
    },
    params: [
      {
        name: "party",
        type: "party",
        required: true,
        description: { bg: "Партия", en: "Party" },
      },
    ],
    examples: [
      {
        bg: "Как се представя ГЕРБ през годините?",
        en: "How has GERB performed over the years?",
      },
    ],
    run: partyTimeline,
  },
  {
    name: "pollAccuracy",
    domain: "elections",
    description: {
      bg: "Точност на социологическите агенции (средна грешка спрямо изборния резултат).",
      en: "Polling-agency accuracy (mean error vs the election result).",
    },
    params: [],
    examples: [
      {
        bg: "Коя социологическа агенция е най-точна?",
        en: "Which pollster is most accurate?",
      },
    ],
    run: pollAccuracy,
  },
  {
    name: "agencyProfile",
    domain: "elections",
    description: {
      bg: "Профил на социологическа агенция: оценка, грешка, точност на прага, house effect.",
      en: "A pollster's profile: grade, error, threshold-call rate, house effect.",
    },
    params: [
      {
        name: "agency",
        type: "metric",
        required: true,
        description: { bg: "Агенция", en: "Agency" },
      },
    ],
    examples: [
      {
        bg: "Колко е точна Алфа Рисърч?",
        en: "How accurate is Alpha Research?",
      },
    ],
    run: agencyProfile,
  },
  {
    name: "latestPolls",
    domain: "elections",
    description: {
      bg: "Последното социологическо проучване по партии (вкл. „ако изборите бяха сега“).",
      en: 'The latest poll by party (incl. "if elections were now").',
    },
    params: [],
    examples: [
      {
        bg: "Какво показват последните проучвания?",
        en: "What do the latest polls show?",
      },
    ],
    run: latestPolls,
  },
  {
    name: "regionBreakdown",
    domain: "elections",
    description: {
      bg: "Резултат на партия по области за един избор (къде е силна/слаба).",
      en: "A party's result by oblast in one election (where it's strong/weak).",
    },
    params: [
      {
        name: "party",
        type: "party",
        required: true,
        description: { bg: "Партия", en: "Party" },
      },
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [{ bg: "Къде е силна ГЕРБ?", en: "Where is GERB strongest?" }],
    run: regionBreakdown,
  },
  {
    name: "electionAnomalies",
    domain: "elections",
    description: {
      bg: "Сигнали и нередности за един избор (преброявания, машинни корекции, проблемни секции).",
      en: "Anomaly signals for one election (recounts, machine corrections, problem sections).",
    },
    params: [
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      {
        bg: "Имаше ли нередности на последните избори?",
        en: "Were there anomalies in the latest election?",
      },
    ],
    run: electionAnomalies,
  },
  {
    name: "regionHistory",
    domain: "elections",
    description: {
      bg: "Избирателна активност в една област през всички избори.",
      en: "Voter turnout in one oblast across all elections.",
    },
    params: [
      {
        name: "oblast",
        type: "oblast",
        required: true,
        description: { bg: "Област", en: "Oblast" },
      },
    ],
    examples: [
      {
        bg: "Как се променя активността в Хасково?",
        en: "How has turnout changed in Haskovo?",
      },
    ],
    run: regionHistory,
  },
  {
    name: "voteTransitions",
    domain: "elections",
    description: {
      bg: "Преливане на гласове между два последователни избора (откъде накъде отиват гласовете).",
      en: "Vote transitions between two consecutive elections (where votes moved).",
    },
    params: [
      {
        name: "election",
        type: "election",
        description: { bg: "Целеви избор", en: "Target election" },
      },
    ],
    examples: [
      {
        bg: "Къде отидоха гласовете на последните избори?",
        en: "Where did votes move in the latest election?",
      },
    ],
    run: voteTransitions,
  },
  // ---- local elections ------------------------------------------------------
  {
    name: "localCouncilVoteShare",
    domain: "local",
    description: {
      bg: "Общински съвети — гласове по партия (национално).",
      en: "Municipal council vote share by party (national).",
    },
    params: [
      {
        name: "cycle",
        type: "cycle",
        description: {
          bg: "Местен цикъл (по подразбиране последния)",
          en: "Local cycle (defaults to latest)",
        },
      },
    ],
    examples: [
      {
        bg: "Кой спечели общинските съвети?",
        en: "Who won the municipal councils?",
      },
    ],
    run: localCouncilVoteShare,
  },
  {
    name: "localMayorsWon",
    domain: "local",
    description: {
      bg: "Спечелени кметски места по партия (национално).",
      en: "Mayors won by party (national).",
    },
    params: [
      {
        name: "cycle",
        type: "cycle",
        description: { bg: "Местен цикъл", en: "Local cycle" },
      },
    ],
    examples: [
      {
        bg: "Колко кмета спечели ГЕРБ на местните избори?",
        en: "How many mayors did GERB win locally?",
      },
    ],
    run: localMayorsWon,
  },
  {
    name: "localMunicipality",
    domain: "local",
    description: {
      bg: "Резултати за една община: кмет, общински съвет, активност.",
      en: "One município: elected mayor, council, turnout.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община", en: "Municipality" },
      },
      {
        name: "cycle",
        type: "cycle",
        description: { bg: "Местен цикъл", en: "Local cycle" },
      },
    ],
    examples: [
      { bg: "Кой е кметът на Пловдив?", en: "Who is the mayor of Plovdiv?" },
    ],
    run: localMunicipality,
  },
  {
    name: "localMayorRace",
    domain: "local",
    description: {
      bg: "Пълно класиране на кандидатите за кмет в община.",
      en: "Full mayoral candidate ranking in a município.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община", en: "Municipality" },
      },
      {
        name: "cycle",
        type: "cycle",
        description: { bg: "Местен цикъл", en: "Local cycle" },
      },
    ],
    examples: [
      {
        bg: "Кои бяха кандидатите за кмет на Варна?",
        en: "Who ran for mayor of Varna?",
      },
    ],
    run: localMayorRace,
  },
  {
    name: "localMayorHistory",
    domain: "local",
    description: {
      bg: "Избраните кметове на община през местните цикли (последните кметове).",
      en: "A município's elected mayors across local cycles (the last mayors).",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община", en: "Municipality" },
      },
    ],
    examples: [
      {
        bg: "Кои са последните кметове на София?",
        en: "Who are the last mayors of Sofia?",
      },
    ],
    run: localMayorHistory,
  },
  {
    name: "localCouncil",
    domain: "local",
    description: {
      bg: "Състав на общинския съвет по партии (места).",
      en: "Municipal council seats by party.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община", en: "Municipality" },
      },
      {
        name: "cycle",
        type: "cycle",
        description: { bg: "Местен цикъл", en: "Local cycle" },
      },
    ],
    examples: [
      {
        bg: "Какъв е общинският съвет на Бургас?",
        en: "What's the Burgas council?",
      },
    ],
    run: localCouncil,
  },
  {
    name: "chmiEvents",
    domain: "local",
    description: {
      bg: "Извънредни (частични/нови) местни избори — хронология.",
      en: "Extraordinary (partial/new) local elections feed.",
    },
    params: [
      {
        name: "place",
        type: "place",
        description: { bg: "Община (по избор)", en: "Municipality (optional)" },
      },
    ],
    examples: [
      {
        bg: "Има ли частични местни избори?",
        en: "Any partial local elections?",
      },
    ],
    run: chmiEvents,
  },
  // ---- fiscal ---------------------------------------------------------------
  {
    name: "budgetOverview",
    domain: "fiscal",
    description: {
      bg: "Държавен бюджет — приходи, разходи, салдо за година.",
      en: "State budget — revenue, expenditure, balance for a year.",
    },
    params: [
      {
        name: "year",
        type: "year",
        description: { bg: "Бюджетна година", en: "Fiscal year" },
      },
    ],
    examples: [
      { bg: "Какъв е държавният бюджет?", en: "What's the state budget?" },
    ],
    run: budgetOverview,
  },
  {
    name: "budgetByFunction",
    domain: "fiscal",
    description: {
      bg: "Бюджетни разходи по функция (COFOG).",
      en: "Budget spending by function (COFOG).",
    },
    params: [
      { name: "year", type: "year", description: { bg: "Година", en: "Year" } },
    ],
    examples: [
      { bg: "За какво се харчи бюджетът?", en: "What is the budget spent on?" },
    ],
    run: budgetByFunction,
  },
  {
    name: "budgetFunction",
    domain: "fiscal",
    description: {
      bg: "Разходите за една бюджетна функция (напр. здравеопазване, отбрана, образование): дял + тенденция.",
      en: "Spending on one budget function (e.g. health, defence, education): share + trend.",
    },
    params: [
      {
        name: "category",
        type: "metric",
        required: true,
        description: { bg: "Функция / категория", en: "Function / category" },
      },
      { name: "year", type: "year", description: { bg: "Година", en: "Year" } },
    ],
    examples: [
      {
        bg: "Колко пари отиват за здравеопазване?",
        en: "How much goes to health?",
      },
      { bg: "Разходи за отбрана", en: "Defence spending" },
    ],
    run: budgetFunction,
  },
  {
    name: "procurementTotals",
    domain: "fiscal",
    description: {
      bg: "Обществени поръчки — общи суми и брой (АОП).",
      en: "Public procurement totals (AOP).",
    },
    params: [],
    examples: [
      {
        bg: "Колко са обществените поръчки?",
        en: "How much public procurement is there?",
      },
    ],
    run: procurementTotals,
  },
  {
    name: "fundsOverview",
    domain: "fiscal",
    description: {
      bg: "Европейски средства — топ бенефициенти (ИСУН).",
      en: "EU funds — top beneficiaries (ISUN).",
    },
    params: [],
    examples: [
      {
        bg: "Кой получава най-много европейски средства?",
        en: "Who gets the most EU funds?",
      },
    ],
    run: fundsOverview,
  },
  {
    name: "govDebt",
    domain: "fiscal",
    description: {
      bg: "Държавен дълг — последни емисии (облигации, ДЦК).",
      en: "Government debt — recent issuances (bonds, T-bills).",
    },
    params: [],
    examples: [
      { bg: "Какъв е държавният дълг?", en: "What's the government debt?" },
    ],
    run: govDebt,
  },
  {
    name: "noiFunds",
    domain: "fiscal",
    description: {
      bg: "Социалноосигурителни фондове (НОИ) — приходи, разходи, салдо.",
      en: "Social-security funds (NSSI) — revenue, expenditure, balance.",
    },
    params: [],
    examples: [{ bg: "Колко харчи НОИ?", en: "How much does NSSI spend?" }],
    run: noiFunds,
  },
  {
    name: "budgetExecution",
    domain: "fiscal",
    description: {
      bg: "Месечно изпълнение на държавния бюджет (приходи/разходи/салдо) във времето.",
      en: "Monthly state-budget execution (revenue/expenditure/balance) over time.",
    },
    params: [
      {
        name: "series",
        type: "metric",
        description: {
          bg: "Приходи/разходи/салдо",
          en: "Revenue/expenditure/balance",
        },
      },
    ],
    examples: [
      {
        bg: "Покажи изпълнението на бюджета по месеци",
        en: "Show monthly budget execution",
      },
    ],
    run: budgetExecution,
  },
  {
    name: "ministryBudget",
    domain: "fiscal",
    description: {
      bg: "Бюджет на конкретно министерство/ведомство по програми.",
      en: "A specific ministry's budget by programme.",
    },
    params: [
      {
        name: "ministry",
        type: "metric",
        required: true,
        description: { bg: "Министерство", en: "Ministry" },
      },
    ],
    examples: [
      {
        bg: "Какъв е бюджетът на Министерството на транспорта?",
        en: "What's the transport ministry's budget?",
      },
    ],
    run: ministryBudget,
  },
  {
    name: "investmentProjects",
    domain: "fiscal",
    description: {
      bg: "Инвестиционна програма (Приложение III) — най-големи капиталови проекти.",
      en: "Investment programme (Appendix III) — largest capital projects.",
    },
    params: [
      {
        name: "oblast",
        type: "oblast",
        description: { bg: "Област (по избор)", en: "Oblast (optional)" },
      },
    ],
    examples: [
      {
        bg: "Кои са най-големите инвестиционни проекти?",
        en: "What are the biggest investment projects?",
      },
    ],
    run: investmentProjects,
  },
  // ---- people ---------------------------------------------------------------
  {
    name: "governments",
    domain: "people",
    description: {
      bg: "Правителства от 2005 — премиери, периоди, партии.",
      en: "Governments since 2005 — PMs, periods, parties.",
    },
    params: [],
    examples: [
      {
        bg: "Кои са правителствата от 2005?",
        en: "What governments since 2005?",
      },
    ],
    run: governments,
  },
  {
    name: "mpAssetsTop",
    domain: "people",
    description: {
      bg: "Депутати с най-големи декларирани активи.",
      en: "MPs ranked by declared assets.",
    },
    params: [],
    examples: [
      { bg: "Кои депутати са най-богати?", en: "Which MPs are richest?" },
    ],
    run: mpAssetsTop,
  },
  {
    name: "mpConnectionsTop",
    domain: "people",
    description: {
      bg: "Депутати с най-много бизнес връзки (Търговски регистър).",
      en: "MPs with the most business connections (Commerce Registry).",
    },
    params: [],
    examples: [
      {
        bg: "Кои депутати имат най-много фирмени връзки?",
        en: "Which MPs have the most company links?",
      },
    ],
    run: mpConnectionsTop,
  },
  {
    name: "officialsAssetsTop",
    domain: "people",
    description: {
      bg: "Висши служители (кабинет, зам.-министри, управители) по декларирани активи.",
      en: "Senior officials (cabinet, deputy ministers, governors) by declared assets.",
    },
    params: [
      {
        name: "category",
        type: "metric",
        description: {
          bg: "Категория (кабинет, управители…)",
          en: "Category (cabinet, governors…)",
        },
      },
    ],
    examples: [
      {
        bg: "Кои министри са най-богати?",
        en: "Which cabinet officials are richest?",
      },
    ],
    run: officialsAssetsTop,
  },
  {
    name: "financingOverview",
    domain: "people",
    description: {
      bg: "Партийни финансови отчети — подаване и спазване на сроковете (Сметна палата).",
      en: "Party financial reports — filing compliance (Court of Audit).",
    },
    params: [],
    examples: [
      {
        bg: "Партиите подават ли финансови отчети навреме?",
        en: "Do parties file financial reports on time?",
      },
    ],
    run: financingOverview,
  },
  // ---- indicators -----------------------------------------------------------
  {
    name: "macroIndicator",
    domain: "indicators",
    description: {
      bg: "Макроикономически показател през времето (инфлация, БВП, дълг…).",
      en: "A macro indicator over time (inflation, GDP, debt…).",
    },
    params: [
      {
        name: "indicator",
        type: "indicator",
        description: { bg: "Показател", en: "Indicator" },
      },
      {
        name: "n",
        type: "count",
        description: { bg: "Брой периоди", en: "Number of periods" },
      },
    ],
    examples: [{ bg: "Каква е инфлацията?", en: "What's inflation?" }],
    run: macroIndicator,
  },
  {
    name: "macroOverview",
    domain: "indicators",
    description: {
      bg: "Преглед на ключови макроикономически показатели.",
      en: "Snapshot of key macro indicators.",
    },
    params: [],
    examples: [{ bg: "Как е икономиката?", en: "How is the economy doing?" }],
    run: macroOverview,
  },
  {
    name: "macroByCategory",
    domain: "indicators",
    description: {
      bg: "Показатели по тема: икономика, фискални, управление, общество.",
      en: "Indicators by theme: economy, fiscal, governance, society.",
    },
    params: [
      {
        name: "category",
        type: "indicator",
        description: { bg: "Тема", en: "Theme" },
      },
    ],
    examples: [
      {
        bg: "Покажи показателите за управление",
        en: "Show the governance indicators",
      },
    ],
    run: macroByCategory,
  },
  {
    name: "subnationalIndicator",
    domain: "indicators",
    description: {
      bg: "Показател по община през времето (безработица, ДЗИ, миграция).",
      en: "A per-município indicator over time (unemployment, DZI, migration).",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община", en: "Municipality" },
      },
      {
        name: "indicator",
        type: "indicator",
        description: { bg: "Показател", en: "Indicator" },
      },
    ],
    examples: [
      { bg: "Каква е безработицата в Сливен?", en: "Unemployment in Sliven?" },
    ],
    run: subnationalIndicator,
  },
  {
    name: "rankPlaces",
    domain: "indicators",
    description: {
      bg: "Класация на области/общини по показател (най-високи/най-ниски, топ N).",
      en: "Rank oblasts/municipalities by an indicator (highest/lowest, top N).",
    },
    params: [
      {
        name: "indicator",
        type: "indicator",
        required: true,
        description: { bg: "Показател + посока", en: "Indicator + direction" },
      },
      { name: "n", type: "count", description: { bg: "Брой", en: "How many" } },
    ],
    examples: [
      {
        bg: "Кои общини са с най-висока безработица?",
        en: "Which municipalities have the highest unemployment?",
      },
      {
        bg: "Коя област е с най-висок БВП на човек?",
        en: "Which oblast has the highest GDP per capita?",
      },
      {
        bg: "Коя е най-прозрачната община?",
        en: "Which municipality is the most transparent?",
      },
    ],
    run: rankPlaces,
  },
  {
    name: "regionIndicator",
    domain: "indicators",
    description: {
      bg: "Показател по област (NUTS3): БВП на човек, население, миграция.",
      en: "A per-oblast (NUTS3) indicator: GDP/capita, population, migration.",
    },
    params: [
      {
        name: "oblast",
        type: "oblast",
        required: true,
        description: { bg: "Област", en: "Oblast" },
      },
      {
        name: "indicator",
        type: "indicator",
        description: { bg: "Показател", en: "Indicator" },
      },
    ],
    examples: [
      { bg: "БВП на човек във Варна?", en: "GDP per capita in Varna oblast?" },
    ],
    run: regionIndicator,
  },
  {
    name: "transparencyScore",
    domain: "indicators",
    description: {
      bg: "Индекс на местна прозрачност (LISI) за областен център.",
      en: "Local transparency index (LISI) for an oblast centre.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община", en: "Municipality" },
      },
    ],
    examples: [
      { bg: "Колко прозрачна е община Русе?", en: "How transparent is Ruse?" },
    ],
    run: transparencyScore,
  },
  {
    name: "localTaxes",
    domain: "indicators",
    description: {
      bg: "Местни данъци и такси за община спрямо средното.",
      en: "Local tax rates for a município vs the national average.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община", en: "Municipality" },
      },
    ],
    examples: [
      {
        bg: "Какви са данъците в Пловдив?",
        en: "What are the taxes in Plovdiv?",
      },
    ],
    run: localTaxes,
  },
  {
    name: "landUse",
    domain: "indicators",
    description: {
      bg: "Земеползване по тип територия (национално или по област).",
      en: "Land use by category (national or per oblast).",
    },
    params: [
      {
        name: "oblast",
        type: "oblast",
        description: { bg: "Област (по избор)", en: "Oblast (optional)" },
      },
    ],
    examples: [
      {
        bg: "Колко гора има в България?",
        en: "How much forest is in Bulgaria?",
      },
    ],
    run: landUse,
  },
  // ---- place ("about my area") ----------------------------------------------
  {
    name: "governanceProfile",
    domain: "place",
    description: {
      bg: "Обобщен профил на населено място: население, кмет, съвет, активност, безработица, прозрачност, поръчки.",
      en: "Composite place profile: population, mayor, council, turnout, unemployment, transparency, procurement.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Населено място", en: "Place" },
      },
    ],
    examples: [{ bg: "Разкажи ми за Габрово", en: "Tell me about Gabrovo" }],
    run: governanceProfile,
  },
  {
    name: "comparePlaces",
    domain: "place",
    description: {
      bg: "Сравнява две населени места по управленски показатели (население, кмет, съвет, безработица, прозрачност…).",
      en: "Compares two places across governance indicators (population, mayor, council, unemployment, transparency…).",
    },
    params: [
      {
        name: "a",
        type: "place",
        required: true,
        description: { bg: "Първо място", en: "First place" },
      },
      {
        name: "b",
        type: "place",
        required: true,
        description: { bg: "Второ място", en: "Second place" },
      },
    ],
    examples: [{ bg: "Сравни Варна и Бургас", en: "Compare Varna and Burgas" }],
    run: comparePlaces,
  },
  {
    name: "census",
    domain: "place",
    description: {
      bg: "Демография (Преброяване 2021): население, пол, етнически състав.",
      en: "Demographics (Census 2021): population, gender, ethnicity.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община", en: "Municipality" },
      },
    ],
    examples: [
      { bg: "Колко жители има Видин?", en: "What's the population of Vidin?" },
    ],
    run: census,
  },
  {
    name: "procurementBySettlement",
    domain: "place",
    description: {
      bg: "Обществени поръчки, договорени в едно населено място.",
      en: "Public procurement awarded in one settlement.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Населено място", en: "Settlement" },
      },
    ],
    examples: [
      { bg: "Колко поръчки има в Русе?", en: "How much procurement in Ruse?" },
    ],
    run: procurementBySettlement,
  },
  {
    name: "airQuality",
    domain: "place",
    description: {
      bg: "Качество на въздуха (ФПЧ10/ФПЧ2.5) от станции близо до населено място.",
      en: "Air quality (PM10/PM2.5) from stations near a place.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Населено място", en: "Place" },
      },
    ],
    examples: [
      { bg: "Какъв е въздухът в Перник?", en: "How's the air in Pernik?" },
    ],
    run: airQuality,
  },
  {
    name: "graoPopulation",
    domain: "place",
    description: {
      bg: "Регистрирано население (ГРАО) по постоянен и настоящ адрес.",
      en: "Registered population (GRAO) by permanent and current address.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Населено място", en: "Place" },
      },
    ],
    examples: [
      {
        bg: "Колко души живеят в Габрово?",
        en: "How many people live in Gabrovo?",
      },
    ],
    run: graoPopulation,
  },
  {
    name: "councilResolutions",
    domain: "place",
    description: {
      bg: "Решения на общинския съвет (където е индексирано).",
      en: "Municipal council resolutions (where indexed).",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община", en: "Municipality" },
      },
    ],
    examples: [
      {
        bg: "Какво реши общинският съвет на Русе?",
        en: "What did Ruse council decide?",
      },
    ],
    run: councilResolutions,
  },
];

export const TOOLS_BY_NAME: Record<string, ToolDef> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t]),
);

export const DOMAIN_LABELS: Record<Domain, { bg: string; en: string }> = {
  elections: { bg: "Парламентарни избори", en: "Parliamentary elections" },
  local: { bg: "Местни избори", en: "Local elections" },
  fiscal: { bg: "Публични финанси", en: "Public finance" },
  people: { bg: "Власт и хора", en: "Power & people" },
  indicators: { bg: "Показатели", en: "Indicators" },
  place: { bg: "Моето населено място", en: "My area" },
};

export const runTool = (name: string, args: ToolArgs, ctx: ToolContext) => {
  const tool = TOOLS_BY_NAME[name];
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.run(args, ctx);
};
