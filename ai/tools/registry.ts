// The tool registry: the single surface the orchestrator (and the dropdown
// harness) sees. The grammar-constrained LLM picks a tool name + args from here.
// Tools are grouped by `domain` for routing + the Explorer dropdown.

import {
  AmbiguousPlaceError,
  clarifyEnvelope,
  municipalityPin,
  settlementPin,
} from "./clarify";
import { loadMunis } from "./place";
import { combineByElection, yearScope } from "./combineYear";
import {
  budgetByFunction,
  budgetFunction,
  budgetOverview,
  budgetTrend,
  fundsOverview,
  awarderProcurement,
  fundsProjects,
  mpProcurement,
  municipalTransfers,
  procurementTotals,
  revenueBreakdown,
  topContractors,
} from "./fiscal";
import { governments } from "./govpeople";
import {
  localCouncilTrend,
  localCouncilVoteShare,
  localMayorsTrend,
  localMayorsWon,
  localMunicipality,
  localOblastMayors,
  localVoteFlows,
} from "./local";
import {
  budgetExecution,
  investmentProjects,
  ministryBudget,
} from "./budgetDepth";
import { census } from "./census";
import {
  electionAnomalies,
  flashMemoryByParty,
  machineVoteByParty,
  municipalityBreakdown,
  recountByParty,
  regionBreakdown,
  regionHistory,
  settlementBreakdown,
  voteTransitions,
  wastedVotesByParty,
} from "./electionDepth";
import { govDebt, noiFunds } from "./fiscalDebt";
import {
  chmiEvents,
  localCouncil,
  localMayorHistory,
  localMayorRace,
  localMayorSections,
  localSubMayors,
} from "./localDetail";
import {
  euComparison,
  macroByCategory,
  macroIndicator,
  macroOverview,
} from "./macro";
import {
  airQuality,
  councilResolutions,
  graoPopulation,
  landUse,
} from "./placeData";
import {
  companyConnections,
  financingOverview,
  mpAssetsByParty,
  mpAssetsTop,
  mpConnectionsByParty,
  mpConnectionsTop,
  officialsAssetsTop,
  partyFinance,
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
import {
  basketAffordability,
  basketVsInflation,
  cheapestChains,
  priceIndex,
  priceRanking,
  settlementPrices,
} from "./prices";
import { compareElections, machineVoteShare, turnout } from "./metrics";
import { simulateTaxChange } from "./taxPolicy";
import { candidateResult } from "./candidate";
import {
  nationalResults,
  parliamentSeats,
  partyResult,
  regionWinners,
  seatsHistory,
} from "./national";
import { partyTimeline } from "./parties";
import {
  accuracyTrend,
  agencyAccuracyHistory,
  agencyPolls,
  agencyProfile,
  latestPolls,
} from "./pollsDepth";
import { machineVoteSeries, turnoutSeries } from "./series";
import {
  benfordAnomalies,
  clusterPersistence,
  diasporaVote,
  diasporaVoteTrend,
  problemSections,
  riskClusters,
  riskIndex,
  riskScore,
  romaVoteTrend,
  suspiciousSettlements,
  wastedVotes,
  wastedVotesTrend,
} from "./integrity";
import { demographicCleavages, partyDemographics } from "./demographics";
import { voterPersistence } from "./flows";
import {
  factionCohesion,
  mpAttendance,
  mpLoyalty,
  mpSimilarity,
  mpVotingProfile,
  partyMps,
  voteSearch,
} from "./parliament";
import { schoolScores } from "./schools";
import { sectionHistory, sectionResults, sectionRiskHistory } from "./sections";
import { settlementHistory, settlementResults } from "./settlement";
import {
  municipalityHistory,
  municipalityResults,
  regionResults,
  regionResultsTrend,
} from "./areaResults";
import {
  municipalityWinners,
  sectionWinners,
  settlementWinners,
} from "./winners";
import type {
  ClarifyOption,
  Domain,
  Envelope,
  ToolArgs,
  ToolContext,
  ToolDef,
} from "./types";

export const TOOLS: ToolDef[] = [
  // ---- parliamentary elections ----------------------------------------------
  {
    name: "nationalResults",
    domain: "elections",
    description: {
      bg: "Национални резултати за един избор: брой гласове, % и разпределение на мандатите по партии.",
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
        bg: "Какви са резултатите от последните парламентарни избори?",
        en: "What were the results of the latest parliamentary election?",
      },
      {
        bg: "Колко мандата спечелиха партиите на последния вот?",
        en: "How many seats did each party win in the latest vote?",
      },
    ],
    run: nationalResults,
  },
  {
    name: "regionWinners",
    domain: "elections",
    description: {
      bg: "Резултати по области: водещата партия във всяка област (списък + карта).",
      en: "Results by region: the leading party in each oblast (list + map).",
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
        bg: "Покажи резултатите по области.",
        en: "Show the results by region.",
      },
      {
        bg: "Коя партия спечели във всяка област?",
        en: "Which party won in each region?",
      },
    ],
    run: regionWinners,
  },
  {
    name: "parliamentSeats",
    domain: "elections",
    description: {
      bg: "Разпределение на местата в парламента по партия (полукръг на Народното събрание).",
      en: "Seat composition of parliament per party (National Assembly hemicycle).",
    },
    params: [
      {
        name: "election",
        type: "election",
        description: {
          bg: "Дата на избора (по подразбиране последния — действащото НС).",
          en: "Election date (defaults to latest — the sitting Assembly).",
        },
      },
    ],
    examples: [
      {
        bg: "Колко места има всяка партия в парламента?",
        en: "How many seats does each party hold in parliament?",
      },
      {
        bg: "Разпределение на мандатите в Народното събрание",
        en: "Seat breakdown in the National Assembly",
      },
    ],
    run: parliamentSeats,
  },
  {
    name: "seatsHistory",
    domain: "elections",
    description: {
      bg: "Тренд на местата (мандатите) на всяка партия през последните избори (многолинейна графика, с проследяване на преименувания).",
      en: "Trend of each party's seats (MPs) across recent elections (multi-line chart, tracks renames).",
    },
    params: [
      {
        name: "years",
        type: "count",
        description: {
          bg: "Брой години назад (времеви прозорец, не брой избори)",
          en: "Number of years back (date window, not an election count)",
        },
      },
      {
        name: "n",
        type: "count",
        description: { bg: "Брой избори", en: "Number of elections" },
      },
    ],
    examples: [
      {
        bg: "Колко места има всяка партия в парламента последните 5 години?",
        en: "How many seats has each party held in parliament over the last 5 years?",
      },
      {
        bg: "Как се променят мандатите по партии през годините?",
        en: "How have seats per party changed over time?",
      },
    ],
    run: seatsHistory,
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
      {
        name: "years",
        type: "count",
        description: {
          bg: "Брой години назад (времеви прозорец, не брой избори)",
          en: "Number of years back (date window, not an election count)",
        },
      },
    ],
    examples: [
      {
        bg: "Машинно гласуване в последните 7 избора?",
        en: "Machine voting in the last 7 elections?",
      },
      {
        bg: "Какъв е процентът машинно гласуване в последните 7 години?",
        en: "What's the machine-voting % over the last 7 years?",
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
      {
        name: "years",
        type: "count",
        description: {
          bg: "Брой години назад (времеви прозорец, не брой избори)",
          en: "Number of years back (date window, not an election count)",
        },
      },
    ],
    examples: [
      {
        bg: "Как се променя активността през годините?",
        en: "How has turnout changed over the years?",
      },
      {
        bg: "Каква е активността през последните 7 години?",
        en: "What's the turnout over the last 7 years?",
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
    name: "agencyPolls",
    domain: "elections",
    description: {
      bg: "История на проучванията на една агенция: подкрепата по партии през всичките ѝ проучвания (тренд).",
      en: "One agency's poll history: party support across all its polls over time (trend).",
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
        bg: "История на проучванията на Маркет Линкс",
        en: "Market Links poll history",
      },
    ],
    run: agencyPolls,
  },
  {
    name: "agencyAccuracyHistory",
    domain: "elections",
    description: {
      bg: "Точност на една агенция през годините: средна грешка спрямо резултата по избори (тренд).",
      en: "One agency's accuracy over time: mean error vs the result by election (trend).",
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
        bg: "Как се променя точността на Алфа Рисърч през годините?",
        en: "How has Alpha Research's accuracy changed over time?",
      },
    ],
    run: agencyAccuracyHistory,
  },
  {
    name: "accuracyTrend",
    domain: "elections",
    description: {
      bg: "Сравнение на точността на социологическите агенции през изборите (тренд, по една линия на агенция).",
      en: "Pollster accuracy compared across elections over time (trend, one line per agency).",
    },
    params: [],
    examples: [
      {
        bg: "Как се променя точността на агенциите през годините?",
        en: "How has pollster accuracy changed over the years?",
      },
    ],
    run: accuracyTrend,
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
    name: "municipalityBreakdown",
    domain: "elections",
    description: {
      bg: "Резултат на партия по общини в една област (карта + класация).",
      en: "A party's result by municipality within one oblast (map + ranking).",
    },
    params: [
      {
        name: "party",
        type: "party",
        required: true,
        description: { bg: "Партия", en: "Party" },
      },
      {
        name: "oblast",
        type: "oblast",
        required: true,
        description: { bg: "Област", en: "Oblast" },
      },
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      { bg: "ГЕРБ по общини във Варна", en: "GERB by municipality in Varna" },
    ],
    run: municipalityBreakdown,
  },
  {
    name: "municipalityWinners",
    domain: "elections",
    description: {
      bg: "Резултати по общини в една област: водещата партия във всяка община (списък + карта).",
      en: "Results by municipality in one oblast: the leading party in each (list + map).",
    },
    params: [
      {
        name: "oblast",
        type: "oblast",
        required: true,
        description: { bg: "Област", en: "Oblast" },
      },
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      {
        bg: "Покажи резултатите по общини в Благоевград",
        en: "Show the results by municipality in Blagoevgrad",
      },
      {
        bg: "Коя партия спечели във всяка община в Бургас?",
        en: "Which party won in each municipality of Burgas?",
      },
    ],
    run: municipalityWinners,
  },
  {
    name: "settlementWinners",
    domain: "elections",
    description: {
      bg: "Резултати по населени места в една община: водещата партия във всяко (списък + карта).",
      en: "Results by settlement in one municipality: the leading party in each (list + map).",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община", en: "Municipality" },
      },
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      {
        bg: "Покажи резултатите по населени места в община Банско",
        en: "Show the results by settlement in Bansko",
      },
      {
        bg: "Кой спечели по села в община Самоков?",
        en: "Which party won in each village of Samokov?",
      },
    ],
    run: settlementWinners,
  },
  {
    name: "sectionWinners",
    domain: "elections",
    description: {
      bg: "Резултати по избирателни секции в населено място: водещата партия във всяка секция.",
      en: "Results by polling section in a settlement: the leading party in each section.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: {
          bg: "Населено място / община",
          en: "Settlement / municipality",
        },
      },
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      {
        bg: "Покажи резултатите по секции в Банско",
        en: "Show the results by polling station in Bansko",
      },
    ],
    run: sectionWinners,
  },
  {
    name: "sectionResults",
    domain: "elections",
    description: {
      bg: "Резултати в една избирателна секция (по номер): гласове и % по партия + активност.",
      en: "Results in one polling section (by its number): votes and % per party + turnout.",
    },
    params: [
      {
        name: "section",
        type: "metric",
        required: true,
        description: {
          bg: "Номер на секция (9 цифри), напр. 050900092",
          en: "Section number (9 digits), e.g. 050900092",
        },
      },
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      {
        bg: "Резултатите в секция 050900092",
        en: "Results in section 050900092",
      },
      {
        bg: "Как гласува секция 234600045?",
        en: "How did section 234600045 vote?",
      },
    ],
    run: sectionResults,
  },
  {
    name: "sectionHistory",
    domain: "elections",
    description: {
      bg: "Как гласува една секция (по номер) през годините — дял по партия през изборите (многолиниен тренд).",
      en: "How one polling section (by its number) voted over time — vote share per party across elections (multi-line trend).",
    },
    params: [
      {
        name: "section",
        type: "metric",
        required: true,
        description: {
          bg: "Номер на секция (9 цифри), напр. 050900092",
          en: "Section number (9 digits), e.g. 050900092",
        },
      },
    ],
    examples: [
      {
        bg: "Как е гласувала секция 050900092 през годините?",
        en: "How has section 050900092 voted over the years?",
      },
      {
        bg: "Тренд на секция 234600045",
        en: "Trend for section 234600045",
      },
    ],
    run: sectionHistory,
  },
  {
    name: "sectionRiskHistory",
    domain: "elections",
    description: {
      bg: "Риск-профил на една секция (по номер) през годините — ниво на риск при скрининг за всеки избор + дали е проблемна секция (ромска махала) или повтарящ се клъстер.",
      en: "Risk profile of one polling section (by its number) over time — risk-screening band per election plus whether it is a flagged problem section (Roma neighborhood) or a persistent cross-election cluster.",
    },
    params: [
      {
        name: "section",
        type: "metric",
        required: true,
        description: {
          bg: "Номер на секция (9 цифри), напр. 162202002",
          en: "Section number (9 digits), e.g. 162202002",
        },
      },
    ],
    examples: [
      {
        bg: "Каква е историята на риска за секция 162202002?",
        en: "What's the risk history of section 162202002?",
      },
      {
        bg: "Секция 162202002 проблемна ли е или в клъстер?",
        en: "Is section 162202002 a problem section or in a cluster?",
      },
    ],
    run: sectionRiskHistory,
  },
  {
    name: "settlementResults",
    domain: "elections",
    description: {
      bg: "Резултати в едно населено място (село/град): гласове и % по партия + активност.",
      en: "Results in one settlement (village/town): votes and % per party + turnout.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Населено място", en: "Settlement" },
      },
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      {
        bg: "Резултатите в с. Иново",
        en: "Results in the village of Inovo",
      },
      {
        bg: "Как гласува гр. Банско?",
        en: "How did the town of Bansko vote?",
      },
    ],
    run: settlementResults,
  },
  {
    name: "settlementHistory",
    domain: "elections",
    description: {
      bg: "Как гласува едно населено място през годините — дял по партия през изборите (многолиниен тренд).",
      en: "How one settlement voted over time — vote share per party across elections (multi-line trend).",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Населено място", en: "Settlement" },
      },
      {
        name: "years",
        type: "count",
        description: {
          bg: "Брой години назад (времеви прозорец, не брой избори)",
          en: "Number of years back (date window, not an election count)",
        },
      },
      {
        name: "n",
        type: "count",
        description: { bg: "Брой избори", en: "Number of elections" },
      },
    ],
    examples: [
      {
        bg: "Резултатите в с. Иново за последните 5 години",
        en: "Results in the village of Inovo over the last 5 years",
      },
      {
        bg: "Как гласува с. Иново през годините?",
        en: "How has the village of Inovo voted over the years?",
      },
    ],
    run: settlementHistory,
  },
  {
    name: "municipalityResults",
    domain: "elections",
    description: {
      bg: "Резултати в една община: гласове и % по партия + активност.",
      en: "Results in one municipality: votes and % per party + turnout.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община", en: "Municipality" },
      },
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      {
        bg: "Резултатите в община Пловдив",
        en: "Results in Plovdiv municipality",
      },
      {
        bg: "Как гласува община Варна?",
        en: "How did Varna municipality vote?",
      },
    ],
    run: municipalityResults,
  },
  {
    name: "municipalityHistory",
    domain: "elections",
    description: {
      bg: "Как гласува една община през годините — дял по партия през изборите (многолиниен тренд).",
      en: "How one municipality voted over time — vote share per party across elections (multi-line trend).",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община", en: "Municipality" },
      },
      {
        name: "years",
        type: "count",
        description: {
          bg: "Брой години назад (времеви прозорец, не брой избори)",
          en: "Number of years back (date window, not an election count)",
        },
      },
      {
        name: "n",
        type: "count",
        description: { bg: "Брой избори", en: "Number of elections" },
      },
    ],
    examples: [
      {
        bg: "Резултатите в община Пловдив за последните 5 години",
        en: "Results in Plovdiv municipality over the last 5 years",
      },
    ],
    run: municipalityHistory,
  },
  {
    name: "regionResults",
    domain: "elections",
    description: {
      bg: "Резултати в една област/МИР: гласове и % по партия + активност (вкл. София-град = трите столични МИР сборно).",
      en: "Results in one region/oblast: votes and % per party + turnout (incl. Sofia city = its three MIR combined).",
    },
    params: [
      {
        name: "oblast",
        type: "oblast",
        required: true,
        description: { bg: "Област / МИР", en: "Region / oblast" },
      },
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      { bg: "Резултатите в област Варна", en: "Results in Varna region" },
      { bg: "Резултатите в София", en: "Results in Sofia" },
    ],
    run: regionResults,
  },
  {
    name: "regionResultsTrend",
    domain: "elections",
    description: {
      bg: "Как гласува една област/МИР през годините — дял по партия през изборите (многолиниен тренд).",
      en: "How one region/oblast voted over time — vote share per party across elections (multi-line trend).",
    },
    params: [
      {
        name: "oblast",
        type: "oblast",
        required: true,
        description: { bg: "Област / МИР", en: "Region / oblast" },
      },
      {
        name: "years",
        type: "count",
        description: {
          bg: "Брой години назад (времеви прозорец, не брой избори)",
          en: "Number of years back (date window, not an election count)",
        },
      },
      {
        name: "n",
        type: "count",
        description: { bg: "Брой избори", en: "Number of elections" },
      },
    ],
    examples: [
      {
        bg: "Резултатите в област Варна за последните 5 години",
        en: "Results in Varna region over the last 5 years",
      },
    ],
    run: regionResultsTrend,
  },
  {
    name: "settlementBreakdown",
    domain: "elections",
    description: {
      bg: "Резултат на партия по населени места в една община (карта + класация).",
      en: "A party's result by settlement within one municipality (map + ranking).",
    },
    params: [
      {
        name: "party",
        type: "party",
        required: true,
        description: { bg: "Партия", en: "Party" },
      },
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община", en: "Municipality" },
      },
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      {
        bg: "ГЕРБ по населени места в община Варна",
        en: "GERB by settlement in Varna municipality",
      },
    ],
    run: settlementBreakdown,
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
    name: "flashMemoryByParty",
    domain: "elections",
    description: {
      bg: "Разлика машинно преброяване срещу флаш памет (СУЕМГ) по партия — кои партии печелят/губят гласове.",
      en: "Machine count vs flash-memory (СУЕМГ) difference by party — which parties gained/lost votes.",
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
        bg: "Кои партии загубиха най-много от липсваща флаш памет?",
        en: "Which parties lost the most from missing flash memory?",
      },
    ],
    run: flashMemoryByParty,
  },
  {
    name: "machineVoteByParty",
    domain: "elections",
    description: {
      bg: "Дял на машинното спрямо хартиеното гласуване по партия — кои партии гласуват машинно.",
      en: "Machine vs paper voting share by party — which parties vote on machines.",
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
        bg: "Кои партии гласуват най-много машинно?",
        en: "Which parties vote on machines the most?",
      },
    ],
    run: machineVoteByParty,
  },
  {
    name: "wastedVotesByParty",
    domain: "elections",
    description: {
      bg: "Прахосани гласове (под 4% прага) по партия — кои партии загубиха най-много гласове.",
      en: "Wasted votes (below the 4% threshold) by party — which parties lost the most votes.",
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
        bg: "Коя партия прахоса най-много гласове?",
        en: "Which party wasted the most votes?",
      },
    ],
    run: wastedVotesByParty,
  },
  {
    name: "recountByParty",
    domain: "elections",
    description: {
      bg: "Промяна в гласовете по партия след ръчно преброяване наново (само избори с преброяване, напр. окт 2024).",
      en: "Per-party vote change after a manual recount (only elections with a recount, e.g. Oct 2024).",
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
        bg: "Кои партии загубиха от преброяването наново през 2024?",
        en: "Which parties lost from the 2024 recount?",
      },
    ],
    run: recountByParty,
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
    name: "localCouncilTrend",
    domain: "local",
    description: {
      bg: "Тренд на гласовете за общинските съвети по партия през местните цикли 2007–2023.",
      en: "Council vote-share trend by party across the local-election cycles 2007–2023.",
    },
    params: [],
    examples: [
      {
        bg: "Как се променя вотът за общинските съвети през годините?",
        en: "How has the council vote changed across cycles?",
      },
    ],
    run: localCouncilTrend,
  },
  {
    name: "localVoteFlows",
    domain: "local",
    description: {
      bg: "Преливане на гласове между местни избори (общински съвети) — къде отиват гласовете на партиите между два цикъла.",
      en: "Vote transitions between local elections (municipal councils) — where party votes moved between two cycles.",
    },
    params: [],
    examples: [
      {
        bg: "Накъде се преляха гласовете на местните избори?",
        en: "Where did local-election council votes flow?",
      },
      {
        bg: "Преливане на гласове между местните избори",
        en: "Vote transitions between local elections",
      },
    ],
    run: localVoteFlows,
  },
  {
    name: "localMayorsTrend",
    domain: "local",
    description: {
      bg: "Тренд на спечелените кметски места по партия през местните цикли 2007–2023.",
      en: "Mayors-won trend by party across the local-election cycles 2007–2023.",
    },
    params: [],
    examples: [
      {
        bg: "Как се променят кметовете по партии през годините?",
        en: "How have mayoralties per party changed across cycles?",
      },
    ],
    run: localMayorsTrend,
  },
  {
    name: "localOblastMayors",
    domain: "local",
    description: {
      bg: "Спечелени кметски места по партия в една област/провинция.",
      en: "Mayors won by party within a single province (oblast).",
    },
    params: [
      {
        name: "place",
        type: "oblast",
        required: true,
        description: { bg: "Област / провинция", en: "Province (oblast)" },
      },
      {
        name: "cycle",
        type: "cycle",
        description: { bg: "Местен цикъл", en: "Local cycle" },
      },
    ],
    examples: [
      {
        bg: "Колко кмета спечели всяка партия в област Пловдив?",
        en: "How many mayors did each party win in Plovdiv province?",
      },
      {
        bg: "Кметове по партия в област Варна",
        en: "Mayors by party in Varna province",
      },
    ],
    run: localOblastMayors,
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
    name: "localMayorSections",
    domain: "local",
    description: {
      bg: "Къде избраният кмет е най-силен и най-слаб по избирателни секции.",
      en: "Where the elected mayor ran strongest and weakest, by polling station.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община или район", en: "Municipality or district" },
      },
      {
        name: "cycle",
        type: "cycle",
        description: { bg: "Местен цикъл", en: "Local cycle" },
      },
    ],
    examples: [
      {
        bg: "В кои секции кметът на Айтос спечели най-много?",
        en: "Which polling stations did the mayor of Aytos win biggest?",
      },
      {
        bg: "Къде беше най-силен кметът на район Средец?",
        en: "Where was the mayor of Sredets district strongest?",
      },
    ],
    run: localMayorSections,
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
    name: "localSubMayors",
    domain: "local",
    description: {
      bg: "Кметове на районите (София) или на кметствата в община.",
      en: "District mayors (Sofia) or settlement (kmetstvo) mayors of a município.",
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
        bg: "Кои са районните кметове на София?",
        en: "Who are Sofia's district mayors?",
      },
      {
        bg: "Кметове на кметствата в Асеновград",
        en: "Settlement mayors in Asenovgrad",
      },
    ],
    run: localSubMayors,
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
      bg: "Извънредни (частични/нови) местни избори — хронология с активност.",
      en: "Extraordinary (partial/new) local elections feed, with turnout.",
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
      {
        bg: "Каква беше активността на частичния избор?",
        en: "What was the turnout in the by-election?",
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
    name: "budgetTrend",
    domain: "fiscal",
    description: {
      bg: "Тренд на държавния бюджет — приходи и разходи по години (завършени фискални години).",
      en: "State-budget trend — revenue and spending by year (completed fiscal years).",
    },
    params: [],
    examples: [
      {
        bg: "Как се променя бюджетът през годините?",
        en: "How has the budget changed over the years?",
      },
      {
        bg: "Бюджет — приходи и разходи по години",
        en: "State budget revenue and spending over time",
      },
    ],
    run: budgetTrend,
  },
  {
    name: "simulateTaxChange",
    domain: "fiscal",
    description: {
      bg: "Какво става с бюджета при данъчна промяна (ДДС, ДДФЛ, необлагаем минимум, корпоративен, дивидент, МОД) — оценен ефект върху приходите + линк към симулатора.",
      en: "Budget effect of a tax change (VAT, income tax, untaxed minimum, corporate, dividend, МОД cap) — scored revenue impact + a simulator deep link.",
    },
    params: [
      {
        name: "change",
        type: "metric",
        required: true,
        description: {
          bg: "Описание на промяната (напр. „ДДС 22%“)",
          en: 'The change to score (e.g. "VAT 22%")',
        },
      },
    ],
    examples: [
      {
        bg: "Какво става, ако ДДС стане 22%?",
        en: "What if VAT goes to 22%?",
      },
      {
        bg: "Колко струва необлагаем минимум от 620 €?",
        en: "What if income tax goes to 15%?",
      },
    ],
    run: simulateTaxChange,
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
    name: "topContractors",
    domain: "fiscal",
    description: {
      bg: "Най-големи изпълнители по обществени поръчки по обща стойност, с маркер за свързаните с депутати (АОП).",
      en: "Largest public-procurement contractors by total value, flagging the MP-tied ones (AOP).",
    },
    params: [
      {
        name: "count",
        type: "count",
        description: { bg: "Брой", en: "How many" },
      },
    ],
    examples: [
      {
        bg: "Кои са най-големите изпълнители по обществени поръчки?",
        en: "Who are the biggest public-procurement contractors?",
      },
      {
        bg: "Топ фирми по държавни договори",
        en: "Top firms by state contracts",
      },
    ],
    run: topContractors,
  },
  {
    name: "mpProcurement",
    domain: "fiscal",
    description: {
      bg: "Обществени поръчки към фирми, свързани със заседаващи депутати; за конкретен депутат — по години.",
      en: "Public procurement going to companies tied to sitting MPs; for a named MP, broken down by year.",
    },
    params: [
      {
        name: "person",
        type: "person",
        description: { bg: "Депутат (по избор)", en: "MP (optional)" },
      },
    ],
    examples: [
      {
        bg: "Кои фирми на депутати печелят обществени поръчки?",
        en: "Which MP-linked firms win public contracts?",
      },
      {
        bg: "Поръчки към фирми, свързани с депутати",
        en: "Procurement to companies connected to MPs",
      },
    ],
    run: mpProcurement,
  },
  {
    name: "awarderProcurement",
    domain: "fiscal",
    description: {
      bg: "Обществени поръчки на един възложител (институция) — колко е похарчил, най-големи изпълнители и по години. Включва малките възложители (училища, детски градини) от ЦАИС ЕОП.",
      en: "Public procurement for one contracting authority (institution) — how much it spent, its largest suppliers and by-year trend. Covers the small buyers (schools, kindergartens) from the ЦАИС ЕОП feed.",
    },
    params: [
      {
        name: "org",
        type: "metric",
        description: {
          bg: "Институция (име или ЕИК)",
          en: "Institution (name or EIK)",
        },
      },
    ],
    examples: [
      {
        bg: "Колко похарчи СУ „Добри Чинтулов“ за обществени поръчки?",
        en: "How much did the Ministry of Defence spend on procurement?",
      },
      {
        bg: "Обществени поръчки на Община Пловдив",
        en: "Procurement by the National Revenue Agency",
      },
    ],
    run: awarderProcurement,
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
    name: "revenueBreakdown",
    domain: "fiscal",
    description: {
      bg: "Структура на данъчните приходи — акциз по продукт + ДДС при внос + мита (Митница), деклариран ДДС по сектор и ДДФЛ по вид доход (НАП).",
      en: "Tax-revenue breakdown — excise by product + import VAT + customs duties (Customs), domestic VAT by sector and PIT by income type (NRA).",
    },
    params: [
      {
        name: "category",
        type: "metric",
        description: {
          bg: "Вид (акциз / ДДС / ДДФЛ)",
          en: "Kind (excise / VAT / PIT)",
        },
      },
      { name: "year", type: "year", description: { bg: "Година", en: "Year" } },
    ],
    examples: [
      {
        bg: "Откъде идват приходите от акцизи?",
        en: "Where does excise revenue come from?",
      },
      { bg: "Деклариран ДДС по сектор", en: "Declared VAT by sector" },
    ],
    run: revenueBreakdown,
  },
  {
    name: "fundsProjects",
    domain: "fiscal",
    description: {
      bg: "Европейски средства на ниво проекти (ИСУН) — общо договорено, реално изплатено (усвояване) и топ програми.",
      en: "EU funds at project grain (ISUN) — total contracted, actually paid (absorption) and top programmes.",
    },
    params: [],
    examples: [
      {
        bg: "Колко европейски средства са усвоени?",
        en: "How much EU funding has actually been absorbed?",
      },
      {
        bg: "Кои програми усвояват най-много евросредства?",
        en: "Which programmes absorb the most EU money?",
      },
    ],
    run: fundsProjects,
  },
  {
    name: "municipalTransfers",
    domain: "fiscal",
    description: {
      bg: "Трансфери от държавата към общините по вид (Чл. 53 ЗДБРБ) — делегирани дейности, изравнителна и капиталова субсидия и др.",
      en: "State transfers to municipalities by type (Art. 53 of the State Budget Law) — delegated activities, equalization and capital subsidies, etc.",
    },
    params: [
      { name: "year", type: "year", description: { bg: "Година", en: "Year" } },
    ],
    examples: [
      {
        bg: "Колко превежда държавата на общините?",
        en: "How much does the state transfer to municipalities?",
      },
      {
        bg: "Държавни трансфери към общините по вид",
        en: "State transfers to municipalities by type",
      },
    ],
    run: municipalTransfers,
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
    name: "mpAssetsByParty",
    domain: "people",
    description: {
      bg: "Декларирани активи на депутатите, обобщени по партия (средно на депутат).",
      en: "MP declared assets aggregated by party (average per MP).",
    },
    params: [],
    examples: [
      {
        bg: "Коя партия има най-богати депутати?",
        en: "Which party has the richest MPs?",
      },
    ],
    run: mpAssetsByParty,
  },
  {
    name: "mpConnectionsByParty",
    domain: "people",
    description: {
      bg: "Бизнес връзки на депутатите, обобщени по партия.",
      en: "MP business connections aggregated by party.",
    },
    params: [],
    examples: [
      {
        bg: "Кои партии имат най-много бизнес връзки?",
        en: "Which parties have the most business connections?",
      },
    ],
    run: mpConnectionsByParty,
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
  {
    name: "partyFinance",
    domain: "people",
    description: {
      bg: "Кампанийни приходи и разходи на конкретна партия за избори (дарения, собствени средства, медиен пакет; Сметна палата).",
      en: "Campaign income and expenses for a specific party in an election (donations, own funds, media package; Court of Audit).",
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
        description: { bg: "Избори", en: "Election" },
      },
    ],
    examples: [
      {
        bg: "Колко дарения получи ГЕРБ?",
        en: "How much did GERB raise from donations?",
      },
      {
        bg: "Колко похарчи ПП-ДБ за кампанията?",
        en: "How much did PP-DB spend on the campaign?",
      },
    ],
    run: partyFinance,
  },
  {
    name: "companyConnections",
    domain: "people",
    description: {
      bg: "Връзки на фирма (по ЕИК) с хора във властта — служители, които заемат публична длъжност или са на една фирмена стъпка от депутат/служител (търговски регистър).",
      en: "A company's connections (by EIK) to people in power — officers who hold public office or are one company-hop from an MP/official (Commerce Registry).",
    },
    params: [
      {
        name: "company",
        type: "person",
        required: true,
        description: { bg: "ЕИК на фирмата", en: "Company EIK" },
      },
    ],
    examples: [
      {
        bg: "Какви политически връзки има ЕИК 831646048?",
        en: "What political connections does EIK 831646048 have?",
      },
      {
        bg: "Свързана ли е тази фирма с депутати?",
        en: "Is this company connected to any MPs?",
      },
    ],
    run: companyConnections,
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
      {
        name: "year",
        type: "year",
        description: {
          bg: "Година (по подразбиране последната)",
          en: "Year (defaults to latest)",
        },
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
    name: "euComparison",
    domain: "indicators",
    description: {
      bg: "Сравнение на показател между България, ЕС-27 и съседи (Румъния, Гърция, Унгария, Хърватия) във времето.",
      en: "Compare an indicator across Bulgaria, the EU-27 and CEE peers (Romania, Greece, Hungary, Croatia) over time.",
    },
    params: [
      {
        name: "indicator",
        type: "indicator",
        required: true,
        description: { bg: "Показател", en: "Indicator" },
      },
    ],
    examples: [
      {
        bg: "Как е инфлацията в България спрямо ЕС?",
        en: "How does Bulgaria's inflation compare with the EU?",
      },
      {
        bg: "Сравни безработицата с останалите страни в ЕС",
        en: "Compare unemployment with the rest of the EU",
      },
    ],
    run: euComparison,
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
      {
        name: "year",
        type: "year",
        description: {
          bg: "Година (по подразбиране последната)",
          en: "Year (defaults to latest)",
        },
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
      {
        name: "year",
        type: "year",
        description: {
          bg: "Година (по подразбиране последната)",
          en: "Year (defaults to latest)",
        },
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
  // ---- prices (КЗП "Колко струва" euro-adoption monitoring) ------------------
  {
    name: "priceIndex",
    domain: "indicators",
    description: {
      bg: "Колко поскъпна потребителската кошница от въвеждането на еврото (национално или по област) — мониторингов индекс на КЗП + по категории. НЕ е официален ИПЦ.",
      en: "How much the consumer basket has risen since the euro (national or per oblast) — CPC monitoring index + by category. NOT official CPI.",
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
        bg: "Колко поскъпна кошницата от въвеждането на еврото?",
        en: "How much has the basket risen since the euro?",
      },
      {
        bg: "Поскъпнаха ли цените след еврото?",
        en: "Did prices rise after the euro?",
      },
    ],
    run: priceIndex,
  },
  {
    name: "settlementPrices",
    domain: "indicators",
    description: {
      bg: "Цени на дребно в едно населено място: промяна на кошницата от еврото, най-ниски цени на основни продукти и най-евтина верига. Може и за един продукт (напр. мляко).",
      en: "Retail prices in one place: basket change since the euro, lowest prices for staple products and the cheapest chain. Also a single product (e.g. milk).",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Населено място", en: "Settlement" },
      },
      {
        name: "product",
        type: "metric",
        description: {
          bg: "Конкретен продукт (по избор), напр. мляко, хляб",
          en: "A specific product (optional), e.g. milk, bread",
        },
      },
    ],
    examples: [
      {
        bg: "Какви са цените в Пловдив?",
        en: "What are the prices in Plovdiv?",
      },
      {
        bg: "Колко струва млякото в Пловдив?",
        en: "How much is milk in Plovdiv?",
      },
    ],
    run: settlementPrices,
  },
  {
    name: "cheapestChains",
    domain: "indicators",
    description: {
      bg: "Класация на търговските вериги по цена на кошницата (национално или в една община) — сравнени върху общата кошница.",
      en: "Retail chains ranked by basket cost (national or in one município) — compared on the shared basket.",
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
        bg: "Коя верига е най-евтина?",
        en: "Which retail chain is the cheapest?",
      },
      {
        bg: "Най-евтини магазини в Бургас",
        en: "Cheapest supermarkets in Burgas",
      },
    ],
    run: cheapestChains,
  },
  {
    name: "priceRanking",
    domain: "indicators",
    description: {
      bg: "Класация на местата по цени: най-евтини градове/области за кошницата или къде е поскъпнало най-много от еврото (списък + карта).",
      en: "Places ranked by prices: cheapest towns/oblasts for the basket, or where prices rose most since the euro (list + map).",
    },
    params: [
      {
        name: "metric",
        type: "metric",
        description: {
          bg: "Посока: най-евтини / най-голямо поскъпване; ниво: места / области",
          en: "Direction: cheapest / biggest rise; level: places / oblasts",
        },
      },
      { name: "n", type: "count", description: { bg: "Брой", en: "How many" } },
    ],
    examples: [
      {
        bg: "Кой град е най-евтин за пазаруване?",
        en: "Which town is cheapest to shop in?",
      },
      {
        bg: "Къде поскъпнаха цените най-много от еврото?",
        en: "Where did prices rise the most since the euro?",
      },
    ],
    run: priceRanking,
  },
  {
    name: "basketAffordability",
    domain: "indicators",
    description: {
      bg: "Достъпност на потребителската кошница спрямо доходите по области — цената на кошницата спрямо БВП на човек (Евростат). Национална класация + ранг на дадена област. БВП на човек е приблизителен измерител на дохода, не нетна заплата.",
      en: "Affordability of the consumer basket vs income by oblast — basket cost relative to GDP-per-capita (Eurostat). National ranking + a given oblast's rank. GDP-per-capita proxies income, not net wage.",
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
        bg: "Къде е най-достъпна кошницата спрямо доходите?",
        en: "Where is the basket most affordable relative to income?",
      },
      {
        bg: "Каква е покупателната способност по области?",
        en: "What is purchasing power by oblast?",
      },
    ],
    run: basketAffordability,
  },
  {
    name: "basketVsInflation",
    domain: "indicators",
    description: {
      bg: "Кошницата на КЗП (от въвеждането на еврото) спрямо официалната инфлация (ХИПЦ — храни, обща, енергия, базова, Евростат). Различни прозорци — контекст, не пряко сравнение.",
      en: "The CPC basket (since the euro) vs official inflation (HICP — food, overall, energy, core; Eurostat). Different windows — context, not a like-for-like comparison.",
    },
    params: [],
    examples: [
      {
        bg: "Изпреварва ли кошницата официалната инфлация?",
        en: "Is the basket outpacing official inflation?",
      },
      {
        bg: "Кошницата спрямо ХИПЦ инфлацията",
        en: "The basket vs HICP inflation",
      },
    ],
    run: basketVsInflation,
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
      {
        name: "year",
        type: "year",
        description: {
          bg: "Към коя година (по подразбиране последните данни)",
          en: "As-of year (defaults to latest data)",
        },
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
  // ---- election integrity & anomalies ---------------------------------------
  {
    name: "problemSections",
    domain: "elections",
    description: {
      bg: "Наблюдавани ромски квартали („контролиран вот“) — секции и водеща партия.",
      en: 'Tracked Roma neighbourhoods ("controlled voting") — sections and leading party.',
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
        bg: "Как гласуват ромските квартали?",
        en: "How do the Roma neighbourhoods vote?",
      },
      { bg: "Има ли контролиран вот?", en: "Is there controlled voting?" },
    ],
    run: problemSections,
  },
  {
    name: "romaVoteTrend",
    domain: "elections",
    description: {
      bg: "Кой печели ромския вот през годините — водеща партия в наблюдаваните квартали по избори.",
      en: "Who wins the Roma vote over time — leading party in the watched neighbourhoods, by election.",
    },
    params: [
      {
        name: "years",
        type: "count",
        description: {
          bg: "Прозорец в години (напр. 5)",
          en: "Window in years (e.g. 5)",
        },
      },
      {
        name: "n",
        type: "count",
        description: {
          bg: "Брой последни избори",
          en: "Number of recent elections",
        },
      },
    ],
    examples: [
      {
        bg: "Коя партия спечели ромските гласове последните 5 години?",
        en: "Which party won the Roma vote over the last 5 years?",
      },
      {
        bg: "Как се променя ромският вот през годините?",
        en: "How does the Roma vote change over time?",
      },
    ],
    run: romaVoteTrend,
  },
  {
    name: "riskIndex",
    domain: "elections",
    description: {
      bg: "Индекс на изборния риск — главната оценка 0–100 и 10-те компонента (изборен интегритет + контекст).",
      en: "Election risk index — the 0–100 headline score and its 10 components (process integrity + context).",
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
        bg: "Какъв е индексът на изборния риск?",
        en: "What is the election risk index?",
      },
      {
        bg: "Каква е оценката за изборния риск?",
        en: "What's the election risk score?",
      },
    ],
    run: riskIndex,
  },
  {
    name: "riskScore",
    domain: "elections",
    description: {
      bg: "Секционен скрининг на риска — секциите по нива (нисък/повишен/висок/критичен).",
      en: "Section risk screening — sections by band (low/elevated/high/critical).",
    },
    params: [
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      { bg: "Колко критични секции има?", en: "How many critical sections?" },
      {
        bg: "Покажи секциите по ниво на риск",
        en: "Show the sections by risk band",
      },
    ],
    run: riskScore,
  },
  {
    name: "riskClusters",
    domain: "elections",
    description: {
      bg: "Клъстери на риска — съседни флагнати секции с обща водеща партия.",
      en: "Risk clusters — adjacent flagged sections sharing a leading party.",
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
        bg: "Има ли клъстери на изборния риск?",
        en: "Are there election-risk clusters?",
      },
    ],
    run: riskClusters,
  },
  {
    name: "clusterPersistence",
    domain: "elections",
    description: {
      bg: "Устойчиви рискови огнища — места, чиито рискови клъстери се повтарят през изборите.",
      en: "Persistent risk loci — places whose risk clusters recur across elections.",
    },
    params: [],
    examples: [
      {
        bg: "Кои места са с устойчив изборен риск?",
        en: "Which places have persistent election risk?",
      },
    ],
    run: clusterPersistence,
  },
  {
    name: "benfordAnomalies",
    domain: "elections",
    description: {
      bg: "Тест на Бенфорд (първа цифра) по партия — отклонение в разпределението на цифрите.",
      en: "Benford's-law (first-digit) test per party — deviation in digit distribution.",
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
        bg: "Какво показва тестът на Бенфорд?",
        en: "What does the Benford test show?",
      },
    ],
    run: benfordAnomalies,
  },
  {
    name: "wastedVotes",
    domain: "elections",
    description: {
      bg: "Прахосани гласове — дял на гласовете за партии под прага, по области.",
      en: "Wasted votes — share of votes for below-threshold parties, by oblast.",
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
        bg: "Колко гласове са прахосани под прага?",
        en: "How many votes were wasted below the threshold?",
      },
    ],
    run: wastedVotes,
  },
  {
    name: "wastedVotesTrend",
    domain: "elections",
    description: {
      bg: "Тренд на прахосаните гласове — национален дял на гласовете под прага през изборите.",
      en: "Wasted-votes trend — national share of below-threshold votes across elections.",
    },
    params: [
      {
        name: "years",
        type: "count",
        description: {
          bg: "Брой години назад (времеви прозорец)",
          en: "Number of years back (date window)",
        },
      },
      {
        name: "n",
        type: "count",
        description: { bg: "Брой избори", en: "Number of elections" },
      },
    ],
    examples: [
      {
        bg: "Как се променят прахосаните гласове през годините?",
        en: "How have wasted votes changed over time?",
      },
      {
        bg: "Тренд на гласовете под прага",
        en: "Trend of votes below the threshold",
      },
    ],
    run: wastedVotesTrend,
  },
  {
    name: "suspiciousSettlements",
    domain: "elections",
    description: {
      bg: "Съмнителни населени места — концентриран вот, невалидни бюлетини, дописани избиратели.",
      en: "Suspicious settlements — concentrated vote, invalid ballots, additional voters.",
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
        bg: "Кои населени места са съмнителни?",
        en: "Which settlements are suspicious?",
      },
    ],
    run: suspiciousSettlements,
  },
  {
    name: "diasporaVote",
    domain: "elections",
    description: {
      bg: "Гласове в чужбина (МИР 32) — резултати по партия.",
      en: "Out-of-country vote (MIR 32) — results by party.",
    },
    params: [
      {
        name: "election",
        type: "election",
        description: { bg: "Дата на избора", en: "Election date" },
      },
    ],
    examples: [
      { bg: "Как гласува диаспората?", en: "How did the diaspora vote?" },
      { bg: "Резултати в чужбина", en: "Out-of-country results" },
    ],
    run: diasporaVote,
  },
  {
    name: "diasporaVoteTrend",
    domain: "elections",
    description: {
      bg: "Тренд на гласа в чужбина (МИР 32) — водещи партии през изборите (многолинейна графика).",
      en: "Diaspora vote (MIR 32) trend — leading parties across elections (multi-line chart).",
    },
    params: [
      {
        name: "years",
        type: "count",
        description: {
          bg: "Брой години назад (времеви прозорец)",
          en: "Number of years back (date window)",
        },
      },
      {
        name: "n",
        type: "count",
        description: { bg: "Брой избори", en: "Number of elections" },
      },
    ],
    examples: [
      {
        bg: "Кой печели гласа в чужбина последните години?",
        en: "Who wins the diaspora vote over recent years?",
      },
      {
        bg: "Как се променя гласът в чужбина през годините?",
        en: "How has the out-of-country vote changed over time?",
      },
    ],
    run: diasporaVoteTrend,
  },
  {
    name: "voterPersistence",
    domain: "elections",
    description: {
      bg: "Устойчивост на вота — дял на избирателите, останали при същата партия между два избора.",
      en: "Voter persistence — share of voters who stayed with the same party between two elections.",
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
        bg: "Колко избиратели запазиха своя вот?",
        en: "How many voters kept their vote?",
      },
    ],
    run: voterPersistence,
  },
  // ---- demographics (census correlations) -----------------------------------
  {
    name: "partyDemographics",
    domain: "elections",
    description: {
      bg: "Демографски корелации на една партия (Преброяване 2021): етнос, религия, образование, възраст.",
      en: "A party's demographic correlations (Census 2021): ethnicity, religion, education, age.",
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
      {
        bg: "Кой гласува за Възраждане?",
        en: "Who votes for Vazrazhdane?",
      },
      {
        bg: "Демографски профил на ДПС",
        en: "DPS demographic profile",
      },
    ],
    run: partyDemographics,
  },
  {
    name: "demographicCleavages",
    domain: "elections",
    description: {
      bg: "Демографски разделения — кои показатели най-силно разделят партиите.",
      en: "Demographic cleavages — which metrics most divide the parties.",
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
        bg: "Какво разделя гласоподавателите?",
        en: "What divides the electorate?",
      },
    ],
    run: demographicCleavages,
  },
  // ---- parliament roll-call -------------------------------------------------
  {
    name: "mpLoyalty",
    domain: "people",
    description: {
      bg: "Партийна лоялност на депутатите — дял на гласовете, съвпадащи с групата.",
      en: "MP party loyalty — share of votes cast with the MP's group.",
    },
    params: [],
    examples: [
      { bg: "Кои депутати са най-лоялни?", en: "Which MPs are most loyal?" },
      {
        bg: "Кои депутати гласуват против групата си?",
        en: "Which MPs vote against their group?",
      },
    ],
    run: mpLoyalty,
  },
  {
    name: "mpAttendance",
    domain: "people",
    description: {
      bg: "Присъствие на депутатите при гласуванията.",
      en: "MP attendance at roll-call votes.",
    },
    params: [],
    examples: [
      {
        bg: "Кои депутати отсъстват най-много?",
        en: "Which MPs are most absent?",
      },
    ],
    run: mpAttendance,
  },
  {
    name: "factionCohesion",
    domain: "people",
    description: {
      bg: "Сплотеност на парламентарните групи — колко единно гласуват.",
      en: "Faction cohesion — how uniformly the groups vote.",
    },
    params: [],
    examples: [
      {
        bg: "Коя група гласува най-единно?",
        en: "Which group votes most cohesively?",
      },
    ],
    run: factionCohesion,
  },
  {
    name: "mpVotingProfile",
    domain: "people",
    description: {
      bg: "Парламентарен профил на депутат по име: лоялност и присъствие.",
      en: "An MP's roll-call profile by name: loyalty and attendance.",
    },
    params: [
      {
        name: "name",
        type: "person",
        required: true,
        description: { bg: "Име на депутата", en: "MP name" },
      },
    ],
    examples: [
      {
        bg: "Как гласува Бойко Борисов в парламента?",
        en: "How does Boyko Borisov vote in parliament?",
      },
    ],
    run: mpVotingProfile,
  },
  {
    name: "mpSimilarity",
    domain: "people",
    description: {
      bg: "Кои депутати гласуват най-подобно на даден депутат.",
      en: "Which MPs vote most similarly to a given MP.",
    },
    params: [
      {
        name: "name",
        type: "person",
        required: true,
        description: { bg: "Име на депутата", en: "MP name" },
      },
    ],
    examples: [
      {
        bg: "Кой гласува като Асен Василев?",
        en: "Who votes like Asen Vasilev?",
      },
    ],
    run: mpSimilarity,
  },
  {
    name: "voteSearch",
    domain: "people",
    description: {
      bg: "Търсене на парламентарни гласувания по тема/дума — резултат и брой гласове.",
      en: "Search parliamentary votes by topic/keyword — outcome and tally.",
    },
    params: [
      {
        name: "query",
        type: "metric",
        description: { bg: "Тема или дума", en: "Topic or keyword" },
      },
    ],
    examples: [
      {
        bg: "Как гласува парламентът за бюджета?",
        en: "How did parliament vote on the budget?",
      },
      {
        bg: "Кои са най-оспорваните гласувания?",
        en: "What were the most contested votes?",
      },
    ],
    run: voteSearch,
  },
  {
    name: "partyMps",
    domain: "people",
    description: {
      bg: "Депутатите (народните представители) от една партия в действащото Народно събрание — поименно.",
      en: "The MPs (members) of one party in the sitting National Assembly — by name.",
    },
    params: [
      {
        name: "party",
        type: "party",
        required: true,
        description: {
          bg: "Партия / парламентарна група",
          en: "Party / parliamentary group",
        },
      },
    ],
    examples: [
      { bg: "Кои са депутатите от ПП?", en: "Who are the MPs from PP?" },
      { bg: "Депутатите на ГЕРБ", en: "GERB's MPs" },
    ],
    run: partyMps,
  },
  // ---- education ------------------------------------------------------------
  {
    name: "schoolScores",
    domain: "indicators",
    description: {
      bg: "Училища в община по среден успех на матурата (ДЗИ) / НВО.",
      en: "Schools in a município by average matura (DZI) / NVO exam score.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: { bg: "Община", en: "Municipality" },
      },
      {
        name: "subject",
        type: "indicator",
        description: {
          bg: "Предмет (БЕЛ/математика)",
          en: "Subject (Bulgarian/math)",
        },
      },
    ],
    examples: [
      {
        bg: "Кои са най-добрите училища в Пловдив?",
        en: "What are the best schools in Plovdiv?",
      },
      {
        bg: "Среден успех на матурите по училища във Варна",
        en: "Matura scores by school in Varna",
      },
    ],
    run: schoolScores,
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

// Same-name place collision -> a chooser envelope. The resolver raised with the
// original query (so we can find which arg held it) and the candidate set. Each
// option re-runs THIS tool with the matching arg replaced by a stable pin
// ("ekatte:…" / "obshtina:…"), so the pick resolves to exactly one place.
type PlaceCand = {
  name: string;
  nameEn: string;
  obshtina: string;
  ekatte: string;
  oblastName: { bg: string; en: string };
  tvm?: string;
};
const buildPlaceClarify = async (
  toolName: string,
  args: ToolArgs,
  ctx: ToolContext,
  err: AmbiguousPlaceError,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  // The tools pass the place name straight to the resolver, so the ambiguous
  // value equals one of the args verbatim. Find it (place / a / b / oblast …);
  // fall back to `place`, then the first arg.
  const argKey =
    Object.keys(args).find((k) => String(args[k]) === err.query) ??
    (args.place != null ? "place" : (Object.keys(args)[0] ?? "place"));
  const isSet = err.kind === "settlement";
  const munis = isSet ? await loadMunis() : [];
  const candidates = err.candidates as PlaceCand[];
  const options: ClarifyOption[] = candidates.map((c) => {
    const name = bg ? c.name : c.nameEn || c.name;
    const label = isSet && bg && c.tvm ? `${c.tvm} ${name}` : name;
    let sublabel: string;
    if (isSet) {
      const muni = munis.find((m) => m.obshtina === c.obshtina);
      const muniName = muni ? (bg ? muni.name : muni.nameEn) : "";
      sublabel = bg
        ? `общ. ${muniName} · обл. ${c.oblastName.bg}`
        : `${muniName} · ${c.oblastName.en}`;
    } else {
      sublabel = bg ? `обл. ${c.oblastName.bg}` : c.oblastName.en;
    }
    const pin = isSet ? settlementPin(c.ekatte) : municipalityPin(c.obshtina);
    return {
      label,
      sublabel,
      tool: toolName,
      args: { ...args, [argKey]: pin },
    };
  });
  const prompt = isSet
    ? bg
      ? `Кое населено място „${err.query}“ имате предвид?`
      : `Which "${err.query}" settlement do you mean?`
    : bg
      ? `Коя община „${err.query}“ имате предвид?`
      : `Which "${err.query}" municipality do you mean?`;
  return clarifyEnvelope(
    prompt,
    options,
    [isSet ? "settlements.json" : "municipalities.json"],
    TOOLS_BY_NAME[toolName]?.domain,
  );
};

export const runTool = async (
  name: string,
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const tool = TOOLS_BY_NAME[name];
  if (!tool) throw new Error(`unknown tool: ${name}`);
  // Multi-election year: a bare (monthless) year that held more than one
  // election (2021, 2024) fans the tool out over every ballot in the year and
  // merges the results into one comparison, instead of silently answering for
  // the newest. `yearScope` returns null for every other case (single-election
  // year, a month-pinned date, or a non-election tool), so this is a no-op then.
  const scope = yearScope(tool, args);
  try {
    const env = scope
      ? await combineByElection(tool, args, ctx, scope.year, scope.elections)
      : await tool.run(args, ctx);
    // Stamp the envelope's domain from the registry so it's always consistent
    // with the tool's group (individual tools no longer need to set it).
    env.domain = tool.domain;
    return env;
  } catch (e) {
    // An ambiguous place name (raised deep in the resolver) becomes an
    // ask-the-user chooser rather than a thrown error — works for the offline
    // router and the LLM path alike, since both land here.
    if (e instanceof AmbiguousPlaceError)
      return buildPlaceClarify(name, args, ctx, e);
    throw e;
  }
};
