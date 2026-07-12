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
  institutionMaintenance,
  contractSearch,
  procurementAppeals,
  fundsOverview,
  awarderProcurement,
  roadsSpending,
  fundsProjects,
  mpProcurement,
  municipalTransfers,
  openTenders,
  procurementDebarred,
  procurementRedFlags,
  procurementSingleBidSectors,
  procurementTotals,
  revenueBreakdown,
  exciseRegister,
  tenderLookup,
  topContractors,
} from "./fiscal";
import {
  subsidiesOverview,
  subsidiesByScheme,
  subsidiesForEntity,
} from "./subsidies";
import {
  cultureOverview,
  topCultureGrantees,
  filmSubsidyForProducer,
  cultureGrantSuccess,
  cultureCommissions,
  cultureMunicipal,
} from "./culture";
import { schoolMatura } from "./education";
import {
  nzokBudget,
  nzokDrugs,
  nzokDrugGrowth,
  nzokHospitals,
  nzokActivities,
  nzokDrugSavings,
  nzokHospitalScorecard,
  nzokPathwayHospitals,
  nzokDrugMolecule,
} from "./nzok";
import {
  judiciaryBudget,
  judiciaryCaseload,
  judiciaryWorkload,
  judiciaryDeclarations,
} from "./judiciary";
import {
  defenseSpending,
  armsExports,
  defenseProgram,
  defenseReadiness,
  defensePeerCompare,
} from "./defense";
import { riverbedCleaning } from "./vik";
import { ngoOverview, ngoTopFunded, ngoConflictAwarders } from "./ngo";
import { governments } from "./govpeople";
import {
  localCouncilTrend,
  localCouncilVoteShare,
  localMayorsTrend,
  localMayorsWon,
  localMunicipality,
  localOblastMayors,
  localPlaceTrend,
  localPrevoteFlow,
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
  kfnFunds,
  noiPensionByOblast,
  noiPensionDistribution,
  noiPensionSeries,
} from "./pensions";
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
import { fdiFlows } from "./fdiFlows";
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
  myAreaAlerts,
  placeEuProjects,
  procurementByOblast,
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
  productPrice,
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
      bg: "Преливане на гласове между два последователни избора. Без партия — общата картина; с партия — откъде идват гласовете ѝ (или, при „къде отидоха“, накъде отиват), с дял в проценти.",
      en: "Vote transitions between two consecutive elections. With no party — the national overview; with a party — where its votes came from (or, for 'where did they go', where they went), each as a percentage.",
    },
    params: [
      {
        name: "party",
        type: "party",
        description: {
          bg: "Партия — показва откъде идват (или накъде отиват) гласовете ѝ",
          en: "Party — shows where its votes came from (or went to)",
        },
      },
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
      {
        bg: "От кои партии идват гласовете за Прогресивна България?",
        en: "Which parties did Progressive Bulgaria's votes come from?",
      },
      {
        bg: "Къде отидоха гласовете на ГЕРБ?",
        en: "Where did GERB's votes go?",
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
    name: "localPrevoteFlow",
    domain: "local",
    description: {
      bg: "Преливане на гласове от последния парламентарен вот преди местните избори към вота за общински съвет — къде отиват националните гласове на местните избори.",
      en: "Vote flow from the last parliamentary vote before the local election into the council ballot — where the national-election votes went locally.",
    },
    params: [],
    examples: [
      {
        bg: "Накъде отидоха парламентарните гласове на местните избори?",
        en: "Where did the parliamentary votes go in the local council vote?",
      },
      {
        bg: "Преливане парламент към общински съвет",
        en: "Parliament to municipal council vote flow",
      },
    ],
    run: localPrevoteFlow,
  },
  {
    name: "localPlaceTrend",
    domain: "local",
    description: {
      bg: "Тренд на гласовете за общинския съвет по партия в едно населено място или столичен район през местните цикли (+ кмет победител по цикъл).",
      en: "Council vote-share trend by party for one settlement or Sofia район across the local cycles (+ the winning mayor per cycle).",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: {
          bg: "Населено място или район",
          en: "Settlement or район",
        },
      },
    ],
    examples: [
      {
        bg: "Как гласува район Средец за общинския съвет през годините?",
        en: "How has район Sredets voted for the council over the cycles?",
      },
      {
        bg: "Тренд на вота за съвет в Банско",
        en: "Council vote trend in Bansko over time",
      },
    ],
    run: localPlaceTrend,
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
    name: "ngoOverview",
    domain: "fiscal",
    description: {
      bg: "Организации с нестопанска цел (ЮЛНЦ) — обзор: брой, публично и външно финансиране, видове.",
      en: "Non-profit organisations (NPOs) — overview: count, public + external funding, types.",
    },
    params: [],
    examples: [
      { bg: "Колко НПО има в България?", en: "How many NGOs are there?" },
      {
        bg: "Колко пари получават неправителствените организации?",
        en: "How much money do non-profits receive?",
      },
      { bg: "Обзор на ЮЛНЦ", en: "NGO sector overview" },
    ],
    run: ngoOverview,
  },
  {
    name: "ngoTopFunded",
    domain: "fiscal",
    description: {
      bg: "Най-финансираните НПО — организации с най-много външно финансиране (ЕС, държавни субсидии).",
      en: "Best-funded NGOs — organisations with the most external funding (EU, state subsidies).",
    },
    params: [],
    examples: [
      {
        bg: "Кои НПО получават най-много пари от ЕС?",
        en: "Which NGOs get the most EU money?",
      },
      {
        bg: "Най-финансираните неправителствени организации",
        en: "The best-funded non-profits",
      },
    ],
    run: ngoTopFunded,
  },
  {
    name: "ngoConflictAwarders",
    domain: "fiscal",
    description: {
      bg: "К-индекс: възложители, чиито поръчки най-много отиват към политически свързани изпълнители (вкл. чрез управата на НПО).",
      en: "K-Index: authorities whose contracts most flow to politically-linked suppliers (incl. via NGO boards).",
    },
    params: [],
    examples: [
      {
        bg: "Кои институции дават поръчки на свързани фирми?",
        en: "Which authorities award contracts to linked companies?",
      },
      {
        bg: "Конфликт на интереси в поръчките",
        en: "Procurement conflict of interest",
      },
    ],
    run: ngoConflictAwarders,
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
    name: "institutionMaintenance",
    domain: "fiscal",
    description: {
      bg: "Издръжка (оперативни разходи) по ведомства — текущи разходи без персонал, субсидии, лихви и трансфери, по години 2018–2026 (методът „Перо по перо“). С ведомство → неговата крива; без → най-голям ръст в проекта за 2026.",
      en: "Operating cost (издръжка) by institution — current spending less personnel, subsidies, interest and transfers, 2018–2026. With an institution → its trend; without → the biggest 2026-draft increases.",
    },
    params: [
      {
        name: "institution",
        type: "metric",
        description: {
          bg: "Ведомство (напр. „отбрана“, „МРРБ“, „министерски съвет“)",
          en: "Institution (e.g. defence, regional development, council of ministers)",
        },
      },
    ],
    examples: [
      {
        bg: "Издръжка на Министерството на отбраната по години",
        en: "Defence ministry operating costs over the years",
      },
      {
        bg: "Кое ведомство има най-голям ръст на издръжката в Бюджет 2026?",
        en: "Which institution has the biggest operating-cost increase in Budget 2026?",
      },
    ],
    run: institutionMaintenance,
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
    name: "nzokBudget",
    domain: "fiscal",
    description: {
      bg: "Бюджет на НЗОК (Здравната каса) по разходни пера — къде отиват ~5,5 млрд €: болнична помощ, лекарства, извънболнична, дентална и т.н.",
      en: "NHIF (health-fund) budget by expenditure line — where the ~€5.5bn goes: hospital care, drugs, outpatient, dental, etc.",
    },
    params: [
      {
        name: "year",
        type: "year",
        description: { bg: "Бюджетна година", en: "Fiscal year" },
      },
    ],
    examples: [
      {
        bg: "Къде отиват парите на НЗОК?",
        en: "Where does the NHIF money go?",
      },
      {
        bg: "Как е разпределен бюджетът на здравната каса?",
        en: "How is the health-fund budget split?",
      },
    ],
    run: nzokBudget,
  },
  {
    name: "judiciaryBudget",
    domain: "fiscal",
    description: {
      bg: "Бюджет на съдебната власт по органи — колко получават съдилищата, прокуратурата, ВКС, ВАС, ВСС и Инспекторатът, и каква част от разходите си съдебната власт покрива сама със съдебни такси.",
      en: "The judiciary's budget by spending body — what the courts, the prosecution, the supreme courts, the ВСС and the inspectorate get, and how much of its costs the judiciary self-funds from court fees.",
    },
    params: [
      {
        name: "year",
        type: "year",
        description: { bg: "Бюджетна година", en: "Fiscal year" },
      },
    ],
    examples: [
      {
        bg: "Какъв е бюджетът на съдебната власт?",
        en: "What is the judiciary's budget?",
      },
      {
        bg: "Колко получава прокуратурата от бюджета?",
        en: "How much does the prosecution get from the budget?",
      },
      {
        bg: "Колко от разходите си покриват съдилищата със съдебни такси?",
        en: "How much of its costs does the judiciary cover from court fees?",
      },
    ],
    run: judiciaryBudget,
  },
  {
    name: "judiciaryCaseload",
    domain: "indicators",
    description: {
      bg: "Движение на делата в българските съдилища — постъпили, свършени и висящи дела, приключваемост и дял решени в 3-месечния срок, по съдебен ред.",
      en: "The movement of cases through Bulgaria's courts — filed, resolved and pending, clearance rate and the share closed within the 3-month deadline, by court tier.",
    },
    params: [
      {
        name: "year",
        type: "year",
        description: { bg: "Година", en: "Year" },
      },
    ],
    examples: [
      {
        bg: "Колко дела постъпват в съдилищата?",
        en: "How many cases enter the courts?",
      },
      {
        bg: "Колко са висящите дела?",
        en: "How big is the court backlog?",
      },
    ],
    run: judiciaryCaseload,
  },
  {
    name: "riverbedCleaning",
    domain: "fiscal",
    description: {
      bg: "Обществените поръчки за почистване, корекция и укрепване на речни корита и дерета — по възложител (общини, областни управители, „Напоителни системи“), по години и най-големи договори.",
      en: "Public procurement for cleaning, regulating and reinforcing riverbeds and gullies — by awarder (municipalities, regional governors, Irrigation Systems), by year and largest contracts.",
    },
    params: [],
    examples: [
      {
        bg: "Колко се харчи за почистване на речните корита?",
        en: "How much is spent cleaning riverbeds?",
      },
      {
        bg: "Кой чисти реките и дерета?",
        en: "Who cleans the rivers and gullies?",
      },
    ],
    run: riverbedCleaning,
  },
  {
    name: "judiciaryWorkload",
    domain: "indicators",
    description: {
      bg: "Натовареност на съдиите по съдебен ред — и двата официални показателя: по щат (спрямо съдийските места) и действителна (спрямо отработените човекомесеци).",
      en: "Judges' workload by court tier — both official measures: per allocated post, and actual (per person-month worked).",
    },
    params: [
      {
        name: "year",
        type: "year",
        description: { bg: "Година", en: "Year" },
      },
    ],
    examples: [
      {
        bg: "Колко натоварени са съдиите?",
        en: "How heavily loaded are the judges?",
      },
      {
        bg: "Кои съдилища са най-натоварени?",
        en: "Which courts are the busiest?",
      },
    ],
    run: judiciaryWorkload,
  },
  {
    name: "judiciaryDeclarations",
    domain: "people",
    description: {
      bg: "Имуществените декларации на съдии, прокурори и следователи — индекс на регистъра на ИВСС (кой и кога е подал) и списъците на Инспектората за неподадени в срок декларации и установени несъответствия. Не съдържа съдържанието на декларациите.",
      en: "Magistrates' asset declarations — an index of the Inspectorate's register (who filed and when) plus its lists of late filers and unresolved discrepancies. Does not include the contents of the declarations.",
    },
    params: [],
    examples: [
      {
        bg: "Подават ли магистратите декларациите си навреме?",
        en: "Do magistrates file their asset declarations on time?",
      },
      {
        bg: "Кои магистрати не са подали декларация в срок?",
        en: "Which magistrates failed to file on time?",
      },
    ],
    run: judiciaryDeclarations,
  },
  {
    name: "defenseSpending",
    domain: "fiscal",
    description: {
      bg: "Разходите на България за отбрана като дял от БВП спрямо целите на НАТО (2% → 5% до 2035), плюс разпределението техника срещу личен състав.",
      en: "Bulgaria's defence spending as a share of GDP against the NATO targets (2% → 5% by 2035), plus the equipment-vs-personnel split.",
    },
    params: [],
    examples: [
      {
        bg: "Колко харчи България за отбрана?",
        en: "How much does Bulgaria spend on defence?",
      },
      {
        bg: "Достигнахме ли 2% от БВП за отбрана?",
        en: "Have we reached 2% of GDP on defence?",
      },
      {
        bg: "Какъв е делът за военна техника?",
        en: "What share goes to military equipment?",
      },
    ],
    run: defenseSpending,
  },
  {
    name: "armsExports",
    domain: "fiscal",
    description: {
      bg: "Износът на България на отбранителна продукция по години — рекордният ръст след 2022 г. и прекият износ за Украйна (по данни на Министерството на икономиката).",
      en: "Bulgaria's defence-product exports by year — the record post-2022 surge and direct exports to Ukraine (Ministry of Economy figures).",
    },
    params: [],
    examples: [
      {
        bg: "Колко оръжие изнася България?",
        en: "How much weaponry does Bulgaria export?",
      },
      {
        bg: "Колко оръжие продадохме на Украйна?",
        en: "How many arms did we sell to Ukraine?",
      },
    ],
    run: armsExports,
  },
  {
    name: "defenseProgram",
    domain: "fiscal",
    description: {
      bg: "Големите оръжейни програми на България (F-16, Stryker, патрулни кораби, барутен завод) — стойност, обем и състояние. Тези сделки са по US FMS и не са в регистъра на поръчките.",
      en: "Bulgaria's flagship defence programs (F-16, Stryker, patrol ships, ammunition plant) — value, scope and status. These deals are via US FMS and not in the procurement register.",
    },
    params: [],
    examples: [
      { bg: "Колко струват F-16?", en: "How much do the F-16s cost?" },
      {
        bg: "Кои са големите оръжейни поръчки?",
        en: "What are the big weapons purchases?",
      },
    ],
    run: defenseProgram,
  },
  {
    name: "defenseReadiness",
    domain: "indicators",
    description: {
      bg: "Готовността на Българската армия — незаетите щатни бройки, запълването на резерва и разпределението на бюджета между личен състав и техника.",
      en: "Bulgarian Army readiness — unfilled established posts, reserve fill and the personnel-vs-capital budget split.",
    },
    params: [],
    examples: [
      { bg: "Пълна ли е армията?", en: "Is the army fully manned?" },
      {
        bg: "Колко са незаетите места в армията?",
        en: "How many army posts are unfilled?",
      },
    ],
    run: defenseReadiness,
  },
  {
    name: "defensePeerCompare",
    domain: "indicators",
    description: {
      bg: "Разходите за отбрана като дял от БВП — България спрямо съседите (Румъния, Гърция), Унгария, Хърватия и средното за НАТО Европа. Отговаря на „2% много ли е“.",
      en: "Defence spending as a share of GDP — Bulgaria vs its neighbours (Romania, Greece), Hungary, Croatia and the NATO Europe average. Answers “is 2% a lot”.",
    },
    params: [],
    examples: [
      {
        bg: "Как се сравнява България със съседите по разходи за отбрана?",
        en: "How does Bulgaria compare to its neighbours on defence spending?",
      },
      {
        bg: "Кой харчи повече за отбрана — България или Румъния?",
        en: "Who spends more on defence — Bulgaria or Romania?",
      },
    ],
    run: defensePeerCompare,
  },
  {
    name: "nzokDrugs",
    domain: "fiscal",
    description: {
      bg: "За кои лекарства плаща най-много НЗОК — брутни разходи по активно вещество (INN); онкологията доминира.",
      en: "Which medicines the NHIF reimburses most — gross spend by active substance (INN); oncology dominates.",
    },
    params: [
      {
        name: "count",
        type: "count",
        description: { bg: "Брой лекарства", en: "Number of medicines" },
      },
    ],
    examples: [
      {
        bg: "За кои лекарства плаща най-много НЗОК?",
        en: "Which drugs does the NHIF reimburse most?",
      },
      {
        bg: "Топ реимбурсирани лекарства от здравната каса",
        en: "Top NHIF drug reimbursement",
      },
    ],
    run: nzokDrugs,
  },
  {
    name: "nzokDrugGrowth",
    domain: "fiscal",
    description: {
      bg: "Най-бързо растящи и новореимбурсирани лекарства на НЗОК — годишна промяна по активно вещество (двете завършени години).",
      en: "Fastest-rising and newly-reimbursed NHIF medicines — year-over-year change by active substance (two closed years).",
    },
    params: [],
    examples: [
      {
        bg: "Кои лекарства растат най-бързо в разходите на НЗОК?",
        en: "Which NHIF drugs are growing fastest in spend?",
      },
      {
        bg: "Кои нови лекарства започна да плаща здравната каса?",
        en: "Which newly-reimbursed medicines did the NHIF add?",
      },
    ],
    run: nzokDrugGrowth,
  },
  {
    name: "nzokHospitals",
    domain: "fiscal",
    description: {
      bg: "Кои болници получават най-много от НЗОК — плащания за болнична медицинска помощ (БМП), кумулативно от началото на годината.",
      en: "Which hospitals the NHIF pays most — inpatient-care (БМП) payments, cumulative year-to-date.",
    },
    params: [
      {
        name: "count",
        type: "count",
        description: { bg: "Брой болници", en: "Number of hospitals" },
      },
    ],
    examples: [
      {
        bg: "Кои болници получават най-много от НЗОК?",
        en: "Which hospitals are paid most by the NHIF?",
      },
      {
        bg: "Топ болници по плащания от здравната каса",
        en: "Top hospitals paid by the NHIF",
      },
    ],
    run: nzokHospitals,
  },
  {
    name: "nzokActivities",
    domain: "fiscal",
    description: {
      bg: "Най-чести дейности, платени от НЗОК — клинични пътеки, амбулаторни и клинични процедури по брой случаи (обем, не стойност).",
      en: "Most frequent NHIF-funded procedures — clinical pathways and ambulatory/clinical procedures by number of cases (volume, not value).",
    },
    params: [
      {
        name: "count",
        type: "count",
        description: { bg: "Брой процедури", en: "Number of procedures" },
      },
    ],
    examples: [
      {
        bg: "Кои клинични пътеки НЗОК плаща най-често?",
        en: "Which clinical pathways does the NHIF pay for most often?",
      },
      {
        bg: "Най-чести дейности по здравната каса",
        en: "Most frequent NHIF activities",
      },
    ],
    run: nzokActivities,
  },
  {
    name: "nzokDrugSavings",
    domain: "fiscal",
    description: {
      bg: "Колко пари може да спести НЗОК от лекарства, ако всяка болница плащаше медианната цена за същата опаковка — национална сума + класация на болниците с най-голямо надплащане над медианата.",
      en: "How much the NHIF could save on medicines if every hospital paid the median price for the same pack — the national figure plus a ranking of the hospitals overpaying most above the median.",
    },
    params: [
      {
        name: "count",
        type: "count",
        description: { bg: "Брой болници", en: "Number of hospitals" },
      },
    ],
    examples: [
      {
        bg: "Колко може да спести НЗОК от лекарства?",
        en: "How much could the NHIF save on medicines?",
      },
      {
        bg: "Кои болници надплащат най-много за лекарства спрямо медианата?",
        en: "Which hospitals overpay the most for medicines vs the median?",
      },
    ],
    run: nzokDrugSavings,
  },
  {
    name: "nzokHospitalScorecard",
    domain: "fiscal",
    description: {
      bg: "Как се представя една болница спрямо останалите — финансовите ѝ показатели (използваемост, среден престой, разход на пациент, просрочени задължения…) над / около / под националната медиана, плюс дали е платена повече или по-малко от очакваното за нейния case-mix. Посочи болница (напр. Пирогов, Свети Георги Пловдив).",
      en: "How one hospital compares to its peers — its financial indicators (occupancy, length of stay, cost per patient, overdue liabilities…) above / around / below the national median, plus whether it is paid more or less than its case-mix predicts. Name a hospital (e.g. Pirogov, Sveti Georgi Plovdiv).",
    },
    params: [
      {
        name: "hospital",
        type: "text",
        description: {
          bg: "Име на болница, напр. Свети Георги Пловдив",
          en: "Hospital name, e.g. Sveti Georgi Plovdiv",
        },
      },
    ],
    examples: [
      {
        bg: "Как се представя Пирогов спрямо другите болници?",
        en: "How does Pirogov compare to other hospitals?",
      },
      {
        bg: "Финансови показатели на Свети Георги Пловдив",
        en: "Financial indicators for Sveti Georgi Plovdiv",
      },
    ],
    run: nzokHospitalScorecard,
  },
  {
    name: "nzokPathwayHospitals",
    domain: "fiscal",
    description: {
      bg: "Кои болници отчитат дадена клинична пътека и колко случая всяка — например хемодиализа, раждане, инсулт. Посочи пътека по име или код; показва и стойността (случаи × цена по НРД), когато цените са заредени.",
      en: "Which hospitals bill a given clinical pathway and how many cases each — e.g. haemodialysis, childbirth, stroke. Name a pathway by name or code; also shows value (cases × НРД list price) when tariffs are loaded.",
    },
    params: [
      {
        name: "procedure",
        type: "text",
        description: {
          bg: "Клинична пътека по име или код, напр. хемодиализа / A01.1",
          en: "Clinical pathway by name or code, e.g. haemodialysis / A01.1",
        },
      },
      {
        name: "count",
        type: "count",
        description: { bg: "Брой болници", en: "Number of hospitals" },
      },
    ],
    examples: [
      {
        bg: "Кои болници правят най-много хемодиализи?",
        en: "Which hospitals do the most haemodialyses?",
      },
      {
        bg: "Кои лечебни заведения отчитат клинична пътека за раждане?",
        en: "Which facilities bill the childbirth clinical pathway?",
      },
    ],
    run: nzokPathwayHospitals,
  },
  {
    name: "nzokDrugMolecule",
    domain: "fiscal",
    description: {
      bg: "Кои болници плащат над медианната цена за едно и също лекарство (опаковка) — надплащане по молекула (INN) спрямо другите болници. Посочи молекула (напр. BEVACIZUMAB) за разбивка по болници, или без — за най-надплащаните лекарства.",
      en: "Which hospitals pay above the median price for the same medicine (pack) — per-molecule (INN) overpay versus peers. Name a molecule (e.g. BEVACIZUMAB) for the per-hospital breakdown, or omit for the most-overpaid medicines.",
    },
    params: [
      {
        name: "inn",
        type: "text",
        description: {
          bg: "Молекула / активно вещество (INN), напр. BEVACIZUMAB",
          en: "Molecule / active substance (INN), e.g. BEVACIZUMAB",
        },
      },
      {
        name: "count",
        type: "count",
        description: { bg: "Брой лекарства", en: "Number of medicines" },
      },
    ],
    examples: [
      {
        bg: "Кои болници надплащат за BEVACIZUMAB?",
        en: "Which hospitals overpay for BEVACIZUMAB?",
      },
      {
        bg: "За кои лекарства болниците плащат над медианната цена?",
        en: "Which medicines do hospitals pay above the median price for?",
      },
    ],
    run: nzokDrugMolecule,
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
    name: "procurementAppeals",
    domain: "fiscal",
    description: {
      bg: "Жалби пред КЗК срещу обществени поръчки — общ брой, колко са уважени/отхвърлени и кои възложители се обжалват най-често. „Уважена“ = отменено решение на възложителя.",
      en: "КЗК appeals against public procurement — how many, how many upheld/rejected, and which buyers get appealed most. “Upheld” = the buyer's decision was annulled.",
    },
    params: [
      {
        name: "count",
        type: "count",
        description: { bg: "Брой възложители", en: "How many buyers" },
      },
      {
        name: "awarder",
        type: "metric",
        description: {
          bg: "Възложител (име) — за жалбите на един възложител",
          en: "Buyer (name) — for one buyer's appeals",
        },
      },
    ],
    examples: [
      {
        bg: "Колко обществени поръчки са обжалвани пред КЗК?",
        en: "How many procurement appeals were there at КЗК?",
      },
      {
        bg: "Кои възложители се обжалват най-често?",
        en: "Which buyers get appealed most often?",
      },
      {
        // Intentionally NOT a translation pair: each half is a different buyer so
        // the EN example also exercises transliteration matching (Kozloduy →
        // КОЗЛОДУЙ) against the Cyrillic-only summary.
        bg: "Обжалваните поръчки на Столична община",
        en: "How many procurement appeals against AEC Kozloduy?",
      },
    ],
    run: procurementAppeals,
  },
  {
    name: "contractSearch",
    domain: "fiscal",
    description: {
      bg: "Договорите на конкретна фирма-изпълнител по обществени поръчки — списък със стойност, възложител, брой оферти и връзка към всеки договор. Приема име на фирма или ЕИК и по избор година.",
      en: "A specific contractor's public-procurement contracts — value, awarder, bid count and a link to each contract. Takes a company name or EIK, optionally a year.",
    },
    params: [
      {
        name: "company",
        type: "person",
        description: { bg: "Име на фирма или ЕИК", en: "Company name or EIK" },
      },
      {
        name: "year",
        type: "year",
        description: { bg: "Година (по избор)", en: "Year (optional)" },
      },
    ],
    examples: [
      {
        bg: "Покажи договорите на Софарма трейдинг",
        en: "Show the contracts won by Sofarma Trading",
      },
      {
        bg: "Какви поръчки е спечелила Главболгарстрой?",
        en: "What contracts has Glavbolgarstroy won?",
      },
    ],
    run: contractSearch,
  },
  {
    name: "procurementRedFlags",
    domain: "fiscal",
    description: {
      bg: "Сигнали за риск в обществените поръчки: концентрация на разход върху един изпълнител и изпълнители в черен списък (АОП).",
      en: "Public-procurement red flags: single-supplier spend concentration and debarred suppliers (AOP).",
    },
    params: [],
    examples: [
      {
        bg: "Покажи сигналите за риск в обществените поръчки",
        en: "Show the procurement red flags",
      },
      {
        bg: "Кои възложители са концентрирани върху един изпълнител?",
        en: "Which buyers are concentrated on a single supplier?",
      },
    ],
    run: procurementRedFlags,
  },
  {
    name: "procurementDebarred",
    domain: "fiscal",
    description: {
      bg: "Изпълнители в черния списък — стопански субекти с влязла в сила забрана да участват в обществени поръчки (регистър на АОП „Стопански субекти с нарушения“).",
      en: 'Debarred suppliers — companies currently barred from public procurement (АОП "Стопански субекти с нарушения" register).',
    },
    params: [],
    examples: [
      {
        bg: "Кои фирми са в черния списък на АОП?",
        en: "Which companies are on the АОП debarment register?",
      },
      {
        bg: "Покажи отстранените изпълнители от обществени поръчки",
        en: "Show the debarred public-procurement suppliers",
      },
    ],
    run: procurementDebarred,
  },
  {
    name: "procurementSingleBidSectors",
    domain: "fiscal",
    description: {
      bg: "Сектори (раздели по CPV), в които един участник е обичайното положение и затова сигналът „един участник“ се потиска.",
      en: "Sectors (CPV divisions) where a single bidder is the market norm, so the single-bidder red flag is suppressed.",
    },
    params: [],
    examples: [
      {
        bg: "В кои сектори един участник е нормално?",
        en: "In which sectors is a single bidder normal?",
      },
      {
        bg: "Кои раздели по CPV са структурно с един участник?",
        en: "Which CPV divisions are structurally single-bid?",
      },
    ],
    run: procurementSingleBidSectors,
  },
  {
    name: "mpProcurement",
    domain: "fiscal",
    description: {
      bg: "Обществени поръчки към фирми, свързани с политическата класа — депутати, както и кметове, общински съветници, министри, областни управители; за конкретно лице — по години.",
      en: "Public procurement going to companies tied to the political class — MPs plus mayors, councillors, ministers and regional governors; for a named person, broken down by year.",
    },
    params: [
      {
        name: "person",
        type: "person",
        description: {
          bg: "Депутат или служител (по избор)",
          en: "MP or official (optional)",
        },
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
    name: "roadsSpending",
    domain: "fiscal",
    description: {
      bg: 'Разходи на Агенция "Пътна инфраструктура" (АПИ) по обществени поръчки за пътища и магистрали — по вид работа (тунели, мостове, маркировка, ограничителни системи…) с дял „една оферта“, най-големи коридори, цена на километър, по години и най-големи изпълнители.',
      en: "Road Infrastructure Agency (АПИ) procurement spending on roads and motorways — by kind of work (tunnels, bridges, markings, safety barriers…) with single-bid share, largest corridors, cost per kilometre, by year and largest contractors.",
    },
    params: [],
    examples: [
      {
        bg: "Колко харчи АПИ за магистрали и по какво?",
        en: "How much does АПИ spend on motorways and on what?",
      },
      {
        bg: "Кои пътни коридори са най-скъпи и има ли конкуренция?",
        en: "Which road corridors cost the most and is there competition?",
      },
    ],
    run: roadsSpending,
  },
  {
    name: "openTenders",
    domain: "fiscal",
    description: {
      bg: "Обявени обществени поръчки (процедури, ОЧАКВАНА/прогнозна стойност — преди подписан договор). Търси в ЦЕЛИЯ корпус по ключова дума/тема И по година — отговаря на „покажи всички търгове за X през ГОДИНА“ (напр. мантинели/пътни предпазни съоръжения, асфалт). Без филтри връща най-големите текущи поръчки; по избор за един възложител. Показва прогнозна стойност, брой обособени позиции, статус (обявена/прекратена).",
      en: "Announced public-procurement tenders (PROCEDURES, estimated/forecast value — before any signed contract). Searches the WHOLE corpus by keyword/topic AND by year — answers 'show all tenders for X in YEAR' (e.g. road guardrails, asphalt). With no filters returns the biggest live tenders; optionally for one buyer. Shows estimated value, lot count, status (announced/cancelled).",
    },
    params: [
      {
        name: "query",
        type: "metric",
        description: {
          bg: "Ключова дума/тема за предмета (напр. „мантинели“, „асфалт“) — по избор",
          en: "Subject keyword/topic (e.g. 'guardrails', 'asphalt') — optional",
        },
      },
      {
        name: "year",
        type: "year",
        description: {
          bg: "Година на обявяване (напр. 2025) — по избор",
          en: "Announcement year (e.g. 2025) — optional",
        },
      },
      {
        name: "org",
        type: "metric",
        description: {
          bg: "Възложител (име или ЕИК) — по избор",
          en: "Buyer (name or EIK) — optional",
        },
      },
    ],
    examples: [
      {
        bg: "Покажи ми всички търгове за пътни предпазни съоръжения през 2025",
        en: "Show me all road-guardrail tenders in 2025",
      },
      {
        bg: "Обявени поръчки за асфалт през 2024",
        en: "Announced asphalt tenders in 2024",
      },
      {
        bg: "Коя е най-голямата обявена поръчка на АПИ?",
        en: "What is the biggest announced tender by the Road Infrastructure Agency?",
      },
    ],
    run: openTenders,
  },
  {
    name: "tenderLookup",
    domain: "fiscal",
    description: {
      bg: "Детайли за една обявена поръчка (процедура) по уникален номер (УНП, напр. 00044-2025-0125) или по ключова дума: прогнозна стойност, обособени позиции, статус и връзка към подписания договор. Прогнозната стойност е ОЧАКВАНА, не похарчена.",
      en: "Details of one announced tender (procedure) by its unique number (УНП, e.g. 00044-2025-0125) or by keyword: estimated value, lots, status and the lineage to a signed contract. The estimated value is a FORECAST, not money spent.",
    },
    params: [
      {
        name: "unp",
        type: "metric",
        description: {
          bg: "УНП (00000-0000-0000) или ключова дума",
          en: "УНП (00000-0000-0000) or a keyword",
        },
      },
    ],
    examples: [
      {
        bg: "Покажи поръчката 00044-2025-0125",
        en: "Show tender 00044-2025-0125",
      },
      {
        bg: "Каква е прогнозната стойност на поръчка T482767?",
        en: "What is the estimated value of tender T482767?",
      },
    ],
    run: tenderLookup,
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
    name: "subsidiesOverview",
    domain: "fiscal",
    description: {
      bg: "Земеделски субсидии (ДФ „Земеделие“, ОСП) — общо изплатено, брой получатели, концентрация и топ получатели по финансова година.",
      en: "Farm subsidies (State Fund Agriculture, CAP) — total paid, recipient count, concentration and top recipients by financial year.",
    },
    params: [
      {
        name: "year",
        type: "year",
        description: {
          bg: "Финансова година (по подразбиране: всички години)",
          en: "Financial year (default: all years)",
        },
      },
    ],
    examples: [
      {
        bg: "Кой получава най-много земеделски субсидии?",
        en: "Who gets the most farm subsidies?",
      },
      {
        bg: "Колко субсидии раздава ДФ Земеделие?",
        en: "How much does the State Fund Agriculture pay in subsidies?",
      },
    ],
    run: subsidiesOverview,
  },
  {
    name: "subsidiesByScheme",
    domain: "fiscal",
    description: {
      bg: "Земеделски субсидии по схема/интервенция (директни плащания, пазарни мерки, развитие на селските райони) — сума и дял.",
      en: "Farm subsidies by scheme/intervention (direct payments, market measures, rural development) — amount and share.",
    },
    params: [
      {
        name: "year",
        type: "year",
        description: {
          bg: "Финансова година (по подразбиране: всички години)",
          en: "Financial year (default: all years)",
        },
      },
    ],
    examples: [
      {
        bg: "Земеделски субсидии по схема",
        en: "Farm subsidies by scheme",
      },
      {
        bg: "Коя мярка раздава най-много пари на земеделците?",
        en: "Which scheme pays farmers the most?",
      },
    ],
    run: subsidiesByScheme,
  },
  {
    name: "subsidiesForEntity",
    domain: "fiscal",
    description: {
      bg: "Земеделски субсидии за конкретна фирма/получател — общо получено, по година и по схема (само юридически лица с ЕИК).",
      en: "Farm subsidies for a specific company/recipient — total received, by year and by scheme (legal entities with an EIK only).",
    },
    params: [
      {
        name: "company",
        type: "person",
        description: {
          bg: "Име или ЕИК на получателя",
          en: "Recipient name or EIK",
        },
      },
    ],
    examples: [
      {
        bg: "Колко субсидии е получила Златия Агро?",
        en: "How much in subsidies did Zlatia Agro receive?",
      },
      {
        bg: "Земеделски субсидии за фирма по ЕИК",
        en: "Farm subsidies for a company by EIK",
      },
    ],
    run: subsidiesForEntity,
  },
  {
    name: "cultureOverview",
    domain: "fiscal",
    description: {
      bg: "Държавна субсидия за кино (Национален филмов център) — общо, брой проекти, концентрация и разбивка по вид (игрално/документално/анимационно), 2014–2025.",
      en: "State film subsidy (National Film Center) — total, project count, concentration and split by discipline (feature/documentary/animation), 2014–2025.",
    },
    params: [],
    examples: [
      {
        bg: "Колко пари дава държавата за кино?",
        en: "How much does the state give for film?",
      },
      {
        bg: "Как се разпределя субсидията за кино по вид?",
        en: "How is the film subsidy split by type?",
      },
    ],
    run: cultureOverview,
  },
  {
    name: "topCultureGrantees",
    domain: "fiscal",
    description: {
      bg: "Най-финансираните продуценти от Националния филмов център — кой печели най-много държавна субсидия за кино.",
      en: "Top-funded producers from the National Film Center — who wins the most state film subsidy.",
    },
    params: [],
    examples: [
      {
        bg: "Кои продуценти получават най-много субсидии за филми?",
        en: "Which producers get the most film subsidies?",
      },
    ],
    run: topCultureGrantees,
  },
  {
    name: "filmSubsidyForProducer",
    domain: "fiscal",
    description: {
      bg: "Държавна филмова субсидия за конкретен продуцент — обща сума и филми по НФЦ.",
      en: "State film subsidy for a specific producer — total and films from the НФЦ register.",
    },
    params: [
      {
        name: "company",
        type: "metric",
        required: true,
        description: {
          bg: "Продуцент (име на дружество)",
          en: "Producer (company name)",
        },
      },
    ],
    examples: [
      {
        bg: "Колко субсидии е получил Гала филм за кино?",
        en: "How much film subsidy did Gala Film receive?",
      },
    ],
    run: filmSubsidyForProducer,
  },
  {
    name: "cultureGrantSuccess",
    domain: "fiscal",
    description: {
      bg: "Успеваемост на грантовете на Национален фонд „Култура“ — колко от кандидатствалите проекти са финансирани, по област на изкуство.",
      en: "National Culture Fund grant success rate — how many applications get funded, by art field.",
    },
    params: [],
    examples: [
      {
        bg: "Каква е успеваемостта на грантовете за култура?",
        en: "What's the success rate for culture grants?",
      },
      {
        bg: "Колко проекта одобрява НФК?",
        en: "How many projects does the culture fund approve?",
      },
    ],
    run: cultureGrantSuccess,
  },
  {
    name: "cultureCommissions",
    domain: "fiscal",
    description: {
      bg: "Съставите на националните художествени комисии на НФЦ — кой решава кои филмови проекти получават държавна субсидия (игрално, документално, анимационно кино).",
      en: "The НФЦ national artistic-commission compositions — who decides which film projects get a state subsidy (feature, documentary, animation).",
    },
    params: [],
    examples: [
      {
        bg: "Кой решава за филмовите субсидии?",
        en: "Who decides the film subsidies?",
      },
      {
        bg: "Кои са членовете на художествената комисия за игрално кино?",
        en: "Who sits on the feature-film artistic commission?",
      },
    ],
    run: cultureCommissions,
  },
  {
    name: "cultureMunicipal",
    domain: "fiscal",
    description: {
      bg: "Общинска и читалищна култура — Столична програма „Култура“ (финансирани проекти по направления) и националната субсидия за народните читалища.",
      en: "Municipal & community-centre culture — Sofia's „Култура“ programme (funded projects by direction) and the national subsidy for community centres (читалища).",
    },
    params: [],
    examples: [
      {
        bg: "Колко дава Столична програма „Култура“?",
        en: "How much does Sofia's culture programme fund?",
      },
      {
        bg: "Каква е държавната субсидия за читалищата?",
        en: "What's the state subsidy for community centres?",
      },
    ],
    run: cultureMunicipal,
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
    name: "exciseRegister",
    domain: "fiscal",
    description: {
      bg: "Лицензирани акцизни складодържатели (Агенция „Митници“) — кой има лиценз да държи горива, тютюн или алкохол под отложено плащане на акциз, подредени по обществени поръчки.",
      en: "Licensed excise warehouse keepers (Customs Agency) — who is licensed to hold fuels, tobacco or alcohol under duty suspension, ranked by public procurement.",
    },
    params: [
      {
        name: "category",
        type: "metric",
        description: {
          bg: "Категория (горива / тютюн / алкохол)",
          en: "Category (fuels / tobacco / alcohol)",
        },
      },
    ],
    examples: [
      {
        bg: "Кои фирми имат лиценз за акцизни складове за горива?",
        en: "Which companies have licensed fuel excise warehouses?",
      },
      {
        bg: "Лицензирани складодържатели на тютюн",
        en: "Licensed tobacco warehouse keepers",
      },
    ],
    run: exciseRegister,
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
    name: "noiPensionDistribution",
    domain: "fiscal",
    description: {
      bg: "Разпределение на пенсиите по размер — колко пенсионери взимат минималната пенсия или по-малко, колко са на тавана и над него, и къде е линията на бедност. Показва защо средната пенсия описва почти никого.",
      en: "The pension-size distribution — how many pensioners get the minimum pension or less, how many sit at or above the cap, and where the poverty line falls. Shows why the average pension describes almost no one.",
    },
    params: [],
    examples: [
      {
        bg: "Колко пенсионери взимат минимална пенсия?",
        en: "How many pensioners get the minimum pension?",
      },
      {
        bg: "Как се разпределят пенсиите по размер?",
        en: "How are pensions distributed by size?",
      },
    ],
    run: noiPensionDistribution,
  },
  {
    name: "noiPensionByOblast",
    domain: "fiscal",
    description: {
      bg: "Средна пенсия по област — най-високите и най-ниските области, разликата между тях и делът на пенсиите, изплащани в брой (а не по банков път).",
      en: "Average pension by oblast — the highest- and lowest-paying regions, the spread between them, and the share of pensions still drawn in cash rather than paid to a bank.",
    },
    // No params: the tool returns the national top/bottom overview and does not
    // filter by a single oblast (removing the advertised param so the contract
    // matches behaviour — the router calls it with args: {}).
    params: [],
    examples: [
      {
        bg: "Средна пенсия по област",
        en: "Average pension by region",
      },
      {
        bg: "Къде пенсиите се взимат най-много в брой?",
        en: "Where are pensions drawn most in cash?",
      },
    ],
    run: noiPensionByOblast,
  },
  {
    name: "noiPensionSeries",
    domain: "fiscal",
    description: {
      bg: "Средна заплата, осигурителен доход и пенсия през годините, с коефициента на заместване (пенсия спрямо заплата). Как расте пенсията спрямо доходите.",
      en: "Average wage, insurable income and pension over the years, with the replacement ratio (pension relative to wage). How the pension tracks incomes over time.",
    },
    params: [],
    examples: [
      {
        bg: "Каква е средната пенсия спрямо заплатата?",
        en: "How does the average pension compare to the wage?",
      },
      {
        bg: "Как се променя средната пенсия през годините?",
        en: "How has the average pension changed over the years?",
      },
    ],
    run: noiPensionSeries,
  },
  {
    name: "kfnFunds",
    domain: "fiscal",
    description: {
      bg: "Частни пенсионни фондове (втори и трети стълб, КФН) — общо нетни активи и осигурени лица, разбивка по стълб (УПФ/ППФ/ДПФ/ДПФПС) и най-големите дружества по активи (Доверие, Алианц, ДСК и др.).",
      en: "Private pension funds (pillars 2 & 3, KFN) — total net assets and insured persons, a per-pillar split (universal/professional/voluntary/voluntary-occupational) and the biggest companies by assets (Doverie, Allianz, DSK, etc.).",
    },
    params: [
      {
        name: "count",
        type: "count",
        description: { bg: "Брой фондове", en: "Number of funds" },
      },
    ],
    examples: [
      {
        bg: "Кои са най-големите частни пенсионни фондове?",
        en: "Which are the biggest private pension funds?",
      },
      {
        bg: "Колко активи има УПФ Доверие?",
        en: "How much in assets does the UPF Doverie fund hold?",
      },
    ],
    run: kfnFunds,
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
    name: "fdiFlows",
    domain: "indicators",
    description: {
      bg: "Преки чуждестранни инвестиции в България (БНБ, месечни потоци по платежния баланс — общо, дялов капитал, реинвестирана печалба, дълг + натрупано от началото на годината).",
      en: "Foreign direct investment in Bulgaria (BNB monthly balance-of-payments flows — total, equity, reinvested earnings, debt + year-to-date).",
    },
    params: [],
    examples: [
      {
        bg: "Колко чужди инвестиции привлече България тази година?",
        en: "How much FDI did Bulgaria attract this year?",
      },
      {
        bg: "Колко са преките чуждестранни инвестиции?",
        en: "What are Bulgaria's foreign direct investment flows?",
      },
    ],
    run: fdiFlows,
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
    name: "schoolMatura",
    domain: "indicators",
    description: {
      bg: "Успех на конкретно училище на държавната матура (ДЗИ) по БЕЛ — среден успех, брой зрелостници, класация и социално-икономическа среда.",
      en: "A specific school's state-matura (ДЗИ) Bulgarian-language average — score, graduates, national rank and socioeconomic context.",
    },
    params: [
      {
        name: "school",
        type: "person",
        required: true,
        description: {
          bg: "Име на училище (напр. СМГ, Първа езикова Варна)",
          en: "School name (e.g. SMG, First Language School Varna)",
        },
      },
    ],
    examples: [
      {
        bg: "Как се справя Софийската математическа гимназия на матурата?",
        en: "How does Sofia Math Gymnasium do on the matura?",
      },
      { bg: "Успех на матурата на 91 НЕГ", en: "Matura score of 91 NEG" },
    ],
    run: schoolMatura,
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
    name: "productPrice",
    domain: "indicators",
    description: {
      bg: "Цена на конкретен продукт по вериги в цялата страна — намира точния продукт по име (напр. кафе Лаваца, олио Бисер, мляко Верея) и показва в кои вериги е най-евтин и как се е променил от еврото.",
      en: "Price of a specific product across chains nationwide — resolves the exact product by name (e.g. Lavazza coffee, Bisser sunflower oil, Vereya milk) and shows which chains are cheapest and how it moved since the euro.",
    },
    params: [
      {
        name: "product",
        type: "metric",
        required: true,
        description: {
          bg: "Продукт по име, напр. кафе Лаваца, олио, мляко Верея",
          en: "A product by name, e.g. Lavazza coffee, sunflower oil, Vereya milk",
        },
      },
    ],
    examples: [
      {
        bg: "Колко струва кафе Лаваца?",
        en: "How much is Lavazza coffee?",
      },
      {
        bg: "Къде е най-евтино олио Бисер?",
        en: "Where is Bisser sunflower oil cheapest?",
      },
    ],
    run: productPrice,
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
    name: "myAreaAlerts",
    domain: "place",
    description: {
      bg: "Скорошна активност в едно място — обявени/възложени поръчки и анекси, нови и променени проекти от еврофондове, решения на общинския съвет, местни избори.",
      en: "Recent activity in one place — announced/awarded procurement + amendments, new and changed EU-funds projects, council resolutions, local elections.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: {
          bg: "Населено място или община",
          en: "Place or município",
        },
      },
    ],
    examples: [
      { bg: "Какво ново в община Бургас?", en: "What's new in Burgas?" },
      {
        bg: "Скорошна активност в Пловдив",
        en: "Recent activity in Plovdiv",
      },
    ],
    run: myAreaAlerts,
  },
  {
    name: "placeEuProjects",
    domain: "place",
    description: {
      bg: "Проекти от еврофондове в едно място — общо договорено, изплатено, топ проекти и нови/променени договори от последното обновяване.",
      en: "EU-funds projects in one place — total contracted, paid, top projects, and new/changed contracts from the latest update.",
    },
    params: [
      {
        name: "place",
        type: "place",
        required: true,
        description: {
          bg: "Населено място или община",
          en: "Place or município",
        },
      },
    ],
    examples: [
      {
        bg: "Европейски проекти в община Варна",
        en: "EU projects in Varna município",
      },
      { bg: "Нови европроекти в Габрово", en: "New EU projects in Gabrovo" },
    ],
    run: placeEuProjects,
  },
  {
    name: "procurementByOblast",
    domain: "place",
    description: {
      bg: "Местни обществени поръчки, обобщени за една област — обща сума, на жител, среден договор, брой възложители и водещи населени места (АОП; без националните министерства).",
      en: "Local public procurement rolled up to one oblast — total, per resident, average contract, buyer count and top settlements (AOP; national ministries excluded).",
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
        bg: "Колко обществени поръчки има в област Пловдив?",
        en: "How much public procurement in Plovdiv province?",
      },
      { bg: "Поръчки по области — Варна", en: "Procurement in Varna oblast" },
    ],
    run: procurementByOblast,
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
