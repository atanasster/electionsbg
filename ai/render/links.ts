import {
  encodeProcurementQuery,
  validateProcurementQuery,
} from "../../src/lib/procurementQuery";
// Explicit subject destinations for chat answers. Prefer the resolved entity's
// page; only use a reviewed subject page when no deep link is available. Never
// infer a destination from the broad tool domain. IDs come from the answer.

import { answerElection } from "../tools/answerContext";
import {
  presidentialViewUrl,
  oblastGovernanceUrl,
} from "../../src/data/local/placeViews";
import { latestLocalCycle } from "../tools/localDataset";
import type { Envelope } from "../tools/types";
import { SITE_ORIGIN } from "@/lib/siteOrigin";

const SITE = SITE_ORIGIN;

export type SiteLink = { label: { bg: string; en: string }; href: string };

const url = (path: string): string => `${SITE}${path}`;

const fact = (env: Envelope, key: string): string | undefined =>
  env.facts?.[key] != null &&
  String(env.facts[key]).trim() &&
  env.facts[key] !== "—"
    ? String(env.facts[key])
    : undefined;

// Pages whose content ElectionContext scopes by `?elections=`. NB /candidate/ is
// listed, but an MP page (/candidate/mp-…) comes from a parliament-data answer
// whose provenance has no election prefix, so answerElection() returns undefined and
// nothing is appended — only the per-election candidate result gets the param.
const isElectionScopedPath = (path: string): boolean =>
  path === "/" ||
  path === "/parliamentary" ||
  path === "/parties" ||
  path === "/regions" ||
  /^\/sections?\//.test(path) || // /section/:id and /sections/:ekatte
  /^\/municipality\//.test(path) ||
  /^\/settlement\//.test(path) ||
  /^\/candidate\//.test(path) ||
  /^\/party\//.test(path);

// /party/:id is keyed by the party nickName (the app's own convention, see
// BubbleTimeline), which the party tools already expose as facts.party.
const partyLink = (env: Envelope, suffix = ""): SiteLink | null => {
  const party = fact(env, "party");
  if (!party) return null;
  return {
    label: { bg: `${party} — профил`, en: `${party} — profile` },
    href: url(`/party/${encodeURIComponent(party)}${suffix}`),
  };
};

// Stable section pages, each confirmed against src/routes.tsx.
const SECTION: Record<string, SiteLink> = {
  results: {
    label: { bg: "Резултати по партии", en: "Results by party" },
    href: url("/parties"),
  },
  regions: {
    label: { bg: "Резултати по области", en: "Results by region" },
    href: url("/regions"),
  },
  home: {
    label: { bg: "Резултати и активност", en: "Results & turnout" },
    href: url("/parliamentary"),
  },
  polls: {
    label: { bg: "Социологически проучвания", en: "Opinion polls" },
    href: url("/polls"),
  },
  governments: {
    label: { bg: "Правителства от 2005", en: "Governments since 2005" },
    href: url("/governments"),
  },
  assets: {
    label: { bg: "Активи на депутатите", en: "MP assets" },
    href: url("/mp-assets"),
  },
  connections: {
    label: { bg: "Бизнес връзки", en: "Business connections" },
    href: url("/connections"),
  },
  votes: {
    label: { bg: "Парламентарни гласувания", en: "Parliamentary votes" },
    href: url("/votes"),
  },
  administration: {
    label: { bg: "Държавна администрация", en: "State administration" },
    href: url("/sector/administration"),
  },
  regional: {
    label: { bg: "Регионално развитие", en: "Regional development" },
    href: url("/sector/regional"),
  },
  parliament: {
    label: { bg: "Народно събрание", en: "National Assembly" },
    href: url("/parliament"),
  },
  financing: {
    label: { bg: "Партийно финансиране", en: "Party financing" },
    href: url("/financing"),
  },
  budget: {
    label: { bg: "Държавен бюджет", en: "State budget" },
    href: url("/budget"),
  },
  procurement: {
    label: { bg: "Обществени поръчки", en: "Public procurement" },
    href: url("/procurement"),
  },
  procurementFlags: {
    label: {
      bg: "Сигнали за риск в поръчките",
      en: "Procurement red flags",
    },
    href: url("/procurement/flags"),
  },
  procurementContractors: {
    label: { bg: "Топ изпълнители", en: "Top contractors" },
    href: url("/procurement/contractors"),
  },
  procurementMps: {
    label: {
      bg: "Топ депутати по свързани поръчки",
      en: "Top MPs by connected procurement",
    },
    href: url("/procurement/mps"),
  },
  procurementMap: {
    label: { bg: "Поръчки по място", en: "Procurement by place" },
    href: url("/procurement/by-settlement"),
  },
  tenders: {
    label: { bg: "Обявени поръчки (търгове)", en: "Announced tenders" },
    href: url("/procurement/tenders"),
  },
  procurementAppeals: {
    label: { bg: "Жалби пред КЗК", en: "КЗК appeals" },
    href: url("/procurement/appeals"),
  },
  funds: {
    label: { bg: "Европейски средства", en: "EU funds" },
    href: url("/funds"),
  },
  nzok: {
    label: { bg: "Здравна каса (НЗОК)", en: "Health fund (NHIF)" },
    href: url("/awarder/121858220"),
  },
  fiscal: {
    label: { bg: "Фискални показатели", en: "Fiscal indicators" },
    href: url("/indicators/fiscal"),
  },
  indicators: {
    label: { bg: "Показатели", en: "Indicators" },
    href: url("/indicators"),
  },
  governance: {
    label: { bg: "Моето населено място", en: "My area" },
    href: url("/governance"),
  },
  riskScore: {
    label: { bg: "Индекс на изборния риск", en: "Election risk index" },
    href: url("/risk-score"),
  },
  riskAnalysis: {
    label: { bg: "Анализ на изборния риск", en: "Election risk analysis" },
    href: url("/risk-analysis"),
  },
};

const localSection = (): SiteLink => ({
  label: { bg: "Местни избори", en: "Local elections" },
  href: url(`/local/${latestLocalCycle()}`),
});

// One default per capability; tools sharing a subject page are grouped below.
const SUBJECT_PAGES: Record<string, SiteLink | undefined> = {
  administrationOverview: SECTION.administration,
  nationalResults: SECTION.results,
  regionWinners: SECTION.regions,
  municipalityWinners: SECTION.regions,
  settlementWinners: SECTION.regions,
  sectionWinners: SECTION.regions,
  parliamentSeats: SECTION.parliament,
  seatsHistory: SECTION.parliament,
  compareElections: SECTION.results,
  turnout: SECTION.home,
  turnoutSeries: SECTION.home,
  machineVoteShare: SECTION.home,
  machineVoteSeries: SECTION.home,
  machineVoteByParty: SECTION.home,
  voteTransitions: SECTION.home,
  voterPersistence: SECTION.home,
  electionAnomalies: SECTION.riskScore,
  riskIndex: SECTION.riskAnalysis,
  riskScore: SECTION.riskScore,
  riskClusters: SECTION.riskAnalysis,
  clusterPersistence: SECTION.riskAnalysis,
  benfordAnomalies: SECTION.riskAnalysis,
  wastedVotes: SECTION.riskAnalysis,
  wastedVotesByParty: SECTION.riskAnalysis,
  suspiciousSettlements: SECTION.riskAnalysis,
  problemSections: SECTION.riskAnalysis,
  romaVoteTrend: SECTION.riskAnalysis,
  pollAccuracy: SECTION.polls,
  agencyProfile: SECTION.polls,
  latestPolls: SECTION.polls,
  agencyPolls: SECTION.polls,
  agencyAccuracyHistory: SECTION.polls,
  accuracyTrend: SECTION.polls,
  governments: SECTION.governments,
  mpAssetsTop: SECTION.assets,
  mpAssetsByParty: SECTION.assets,
  mpConnectionsTop: SECTION.connections,
  mpConnectionsByParty: SECTION.connections,
  mpLoyalty: SECTION.votes,
  voteSearch: SECTION.votes,
  partyMps: SECTION.parliament,
  financingOverview: SECTION.financing,
  budgetOverview: SECTION.budget,
  simulateTaxChange: SECTION.budget,
  procurementTotals: SECTION.procurement,
  procurementRedFlags: SECTION.procurementFlags,
  procurementSingleBidSectors: SECTION.procurementFlags,
  procurementDebarred: SECTION.procurementFlags,
  topContractors: SECTION.procurementContractors,
  procurementAppeals: SECTION.procurementAppeals,
  mpProcurement: SECTION.procurementMps,
  procurementByOblast: SECTION.procurementMap,
  fundsOverview: SECTION.funds,
  nzokBudget: SECTION.nzok,
  nzokDrugs: SECTION.nzok,
  nzokDrugGrowth: SECTION.nzok,
  nzokHospitals: SECTION.nzok,
  nzokActivities: SECTION.nzok,
  nzokDrugMolecule: SECTION.nzok,
  nzokDrugSavings: SECTION.nzok,
  nzokHospitalScorecard: SECTION.nzok,
  nzokPathwayHospitals: SECTION.nzok,
  govDebt: SECTION.fiscal,
  mrrbSpending: SECTION.regional,
  cohesionAbsorption: SECTION.regional,
  regionalInvestment: SECTION.regional,
  macroIndicator: SECTION.indicators,
  macroOverview: SECTION.indicators,
  macroByCategory: SECTION.indicators,
  governanceProfile: SECTION.governance,
  comparePlaces: SECTION.governance,
  census: SECTION.governance,
  procurementBySettlement: SECTION.procurementMap,
  airQuality: SECTION.governance,
  graoPopulation: SECTION.governance,
};

// Reviewed destinations are explicit: registry domains are too broad to infer a page.
const page = (path: string, bg: string, en: string): SiteLink => ({
  href: url(path),
  label: { bg, en },
});
const pages = (tools: string[], path: string, bg: string, en: string) => {
  for (const tool of tools) SUBJECT_PAGES[tool] = page(path, bg, en);
};
pages(
  ["priceIndex", "basketVsInflation"],
  "/consumption/overview",
  "Цени и инфлация",
  "Prices and inflation",
);
pages(["productPrice"], "/consumption/products", "Продукти", "Products");
pages(
  ["settlementPrices", "priceRanking", "basketAffordability"],
  "/consumption",
  "Потребление по място",
  "Consumption by place",
);
pages(["localDeals"], "/consumption/deals", "Промоции", "Deals");
pages(
  ["cheapestChains", "chainProfile"],
  "/consumption/chains",
  "Търговски вериги",
  "Retail chains",
);
pages(["euFoodPriceLevels"], "/consumption/eu", "Цени в ЕС", "EU prices");
pages(["fuelPrices"], "/consumption/fuel", "Горива", "Fuel");
pages(
  ["electricityPrices"],
  "/consumption/electricity",
  "Електроенергия",
  "Electricity",
);
pages(["gasPrices"], "/consumption/gas", "Природен газ", "Natural gas");
pages(
  [
    "ngoOverview",
    "ngoTopFunded",
    "ngoConflictAwarders",
    "ngoRiskSignals",
    "ngoBySignal",
  ],
  "/procurement/ngos",
  "Финансиране на НПО",
  "NGO funding",
);
pages(["budgetTrend"], "/budget", "Държавен бюджет", "State budget");
pages(
  ["institutionMaintenance", "ministryBudget"],
  "/budget/ministries",
  "Бюджети на институциите",
  "Institution budgets",
);
pages(
  ["budgetByFunction", "budgetFunction"],
  "/budget/functional",
  "Бюджет по функции",
  "Budget by function",
);
pages(
  ["budgetExecution"],
  "/budget/execution",
  "Изпълнение на бюджета",
  "Budget execution",
);
pages(
  ["investmentProjects"],
  "/budget/investments",
  "Инвестиционни проекти",
  "Investment projects",
);
pages(["revenueBreakdown"], "/budget/revenue", "Приходи", "Revenue");
pages(
  ["municipalTransfers"],
  "/budget/municipal",
  "Общински бюджети",
  "Municipal budgets",
);
pages(
  ["municipalFiscalRanking"],
  "/governance/municipal-finance",
  "Общински финанси",
  "Municipal finances",
);
pages(
  [
    "judiciaryBudget",
    "judiciaryCaseload",
    "judiciaryWorkload",
    "judiciaryCourtLoad",
  ],
  "/judiciary",
  "Съдебна власт",
  "Judiciary",
);
pages(
  ["judiciaryDeclarations"],
  "/judiciary/magistrates",
  "Магистрати",
  "Magistrates",
);
pages(
  [
    "defenseSpending",
    "armsExports",
    "defenseProgram",
    "defenseReadiness",
    "defensePeerCompare",
  ],
  "/defense",
  "Отбрана",
  "Defense",
);
pages(["securityRoadSafety"], "/sector/security", "Сигурност", "Security");
pages(
  ["transportSpending", "transportEuFunds", "railSubsidy"],
  "/sector/transport",
  "Транспорт",
  "Transport",
);
pages(
  ["socialSpending", "socialBenefits", "socialPovertyImpact"],
  "/sector/social",
  "Социална политика",
  "Social policy",
);
pages(
  ["environmentSpending", "environmentFunds", "wasteRecycling"],
  "/sector/environment",
  "Околна среда",
  "Environment",
);
pages(["riverbedCleaning"], "/water", "Води", "Water");
pages(
  ["generationMix", "powerPlants"],
  "/sector/energy",
  "Енергетика",
  "Energy",
);
pages(
  ["nzokPublicPrivate", "nzokPrivateHospitals"],
  "/awarder/121858220",
  "НЗОК — болници",
  "NHIF — hospitals",
);
pages(
  ["awarderProcurement"],
  "/procurement/awarders",
  "Възложители",
  "Contracting authorities",
);
pages(
  ["procurementNormalcy"],
  "/procurement/flags",
  "Риск в поръчките",
  "Procurement risk",
);
pages(
  ["roadsSpending"],
  "/procurement/roads",
  "Пътно строителство",
  "Road construction",
);
pages(["openCalls"], "/funds/calls", "Отворени приеми", "Open calls");
pages(["fundsProjects"], "/funds", "Европейски средства", "EU funds");
pages(
  ["placeEuProjects"],
  "/funds/places",
  "Европейски средства по място",
  "EU funds by place",
);
pages(
  ["subsidiesOverview"],
  "/subsidies",
  "Земеделски субсидии",
  "Farm subsidies",
);
pages(
  ["subsidiesByScheme"],
  "/subsidies/schemes",
  "Схеми за субсидии",
  "Subsidy schemes",
);
pages(
  ["subsidiesForEntity"],
  "/subsidies/recipients",
  "Получатели на субсидии",
  "Subsidy recipients",
);
pages(
  [
    "cultureOverview",
    "cultureGrantSuccess",
    "cultureCommissions",
    "cultureMunicipal",
  ],
  "/culture",
  "Култура",
  "Culture",
);
pages(
  ["topCultureGrantees", "filmSubsidyForProducer"],
  "/culture/films",
  "Филмови субсидии",
  "Film subsidies",
);
pages(
  ["exciseRegister", "exciseWarehouses"],
  "/customs/warehouses",
  "Акцизни складове",
  "Excise warehouses",
);
pages(
  [
    "noiFunds",
    "noiPensionDistribution",
    "noiPensionByOblast",
    "noiPensionSeries",
    "kfnFunds",
  ],
  "/pensions",
  "Пенсии",
  "Pensions",
);
pages(
  ["personConnections"],
  "/connections",
  "Връзки между лица",
  "Connections between people",
);
pages(
  ["personWealth", "officialsAssetsTop"],
  "/governance/declarations",
  "Имуществени декларации",
  "Asset declarations",
);
pages(
  ["partyFinance"],
  "/financing",
  "Партийно финансиране",
  "Party financing",
);
pages(["fdiFlows"], "/indicators/economy", "Икономика", "Economy");
pages(
  ["euComparison"],
  "/indicators/compare",
  "Сравнение с ЕС",
  "EU comparison",
);
pages(["schoolScores"], "/education", "Образование", "Education");
pages(
  ["digitalSkills"],
  "/sector/administration",
  "Дигитални умения",
  "Digital skills",
);
pages(
  ["tourismSeasonality", "tourismSourceMarkets"],
  "/sector/tourism",
  "Туризъм",
  "Tourism",
);
pages(
  ["latestPresidentialPoll"],
  "/polls",
  "Президентски проучвания",
  "Presidential polls",
);
pages(
  ["regionHistory"],
  "/regions",
  "Резултати по области",
  "Results by region",
);
pages(
  ["wastedVotesTrend"],
  "/reports/settlement/wasted-votes",
  "Изгубени гласове",
  "Wasted votes",
);
pages(
  ["diasporaVote", "diasporaVoteTrend"],
  "/municipality/32",
  "Вот в чужбина",
  "Votes abroad",
);
pages(["flashMemoryByParty"], "/flash-memory", "Флаш памети", "Flash memory");
pages(["recountByParty"], "/recount", "Повторно преброяване", "Recount");
pages(
  ["demographicCleavages", "partyDemographics"],
  "/party-demographics",
  "Демография на вота",
  "Voting demographics",
);
pages(
  ["mpAttendance"],
  "/parliament/attendance",
  "Присъствие на депутатите",
  "MP attendance",
);
pages(
  ["factionCohesion"],
  "/parliament/cohesion",
  "Сплотеност на групите",
  "Faction cohesion",
);
pages(["myAreaAlerts"], "/governance", "Моето населено място", "My area");
pages(["contractSearch"], "/procurement/contracts", "Договори", "Contracts");

pages(
  ["budgetVariance"],
  "/budget/deviations",
  "Отклонения от бюджета",
  "Budget deviations",
);
pages(
  ["budgetPersonnel", "budgetPersonnelByMinistry"],
  "/budget/personnel",
  "Персонал",
  "Personnel",
);
pages(["budgetDocuments"], "/budget/law", "Бюджетни закони", "Budget laws");
pages(["budgetMinistries"], "/budget/ministries", "Министерства", "Ministries");
pages(
  ["budgetMunicipalTransfers"],
  "/budget/municipal",
  "Общински трансфери",
  "Municipal transfers",
);
pages(
  ["budgetCapitalByMunicipality"],
  "/budget/municipal/capital",
  "Капиталови проекти",
  "Capital projects",
);
pages(
  ["budgetInvestmentPayments"],
  "/budget/municipal/investments",
  "Инвестиционна програма",
  "Investment programme",
);
pages(["waterServices"], "/water", "Води", "Water");
pages(["landUse"], "/sector/environment", "Земеползване", "Land use");
pages(
  ["localTaxes", "transparencyScore"],
  "/governance",
  "Общински показатели",
  "Municipal indicators",
);

pages(
  ["projectLifecycle"],
  "/procurement/projects",
  "Проектни досиета",
  "Project dossiers",
);
pages(
  ["subnationalIndicator", "rankPlaces", "regionIndicator"],
  "/governance",
  "Показатели по място",
  "Indicators by place",
);

export const siteLinks = (env: Envelope): SiteLink[] => {
  if (env.clarify) return [];
  if (env.procurementBundle)
    return env.procurementBundle.flatMap((item, i) =>
      siteLinks({
        ...env,
        procurementBundle: undefined,
        procurement: item,
      }).map((link) => ({
        ...link,
        label: { bg: `Справка ${i + 1}`, en: `Query ${i + 1}` },
      })),
    );
  if (env.procurement) {
    const parsed = validateProcurementQuery(env.procurement.query);
    if (!parsed.ok) return [];
    const params = new URLSearchParams({
      query: encodeProcurementQuery(parsed.query),
      revision: JSON.stringify(env.procurement.result.revision || {}),
    });
    return [
      {
        label: {
          bg: "Същата справка и записи",
          en: "This query and its records",
        },
        href: url("/procurement/query?" + params.toString()),
      },
    ];
  }
  const out: SiteLink[] = [];

  // Party-scoped tools get a deep link to the party's own page first.
  switch (env.tool) {
    case "projectLifecycle": {
      const path = fact(env, "url");
      if (path && /^\/procurement\/project\/[^/?#]+$/.test(path))
        out.push(page(path, "Проектно досие", "Project dossier"));
      break;
    }
    case "subnationalIndicator":
    case "regionIndicator":
    case "transparencyScore":
    case "localTaxes":
    case "landUse":
    case "governanceProfile":
    case "census":
    case "airQuality":
    case "graoPopulation":
    case "myAreaAlerts":
    case "placeEuProjects": {
      const g = env.geo;
      if (g?.mode !== "locator") break;
      const sofia =
        g.focus?.length === 3 &&
        ["S23", "S24", "S25"].every((c) => g.focus?.includes(c));
      const code = sofia
        ? "SOF00"
        : g.areas?.length === 1
          ? g.areas[0].code
          : undefined;
      if (code)
        out.push(
          page(
            g.level === "oblast" && !sofia
              ? (oblastGovernanceUrl(code) ?? "/governance")
              : `/governance/${encodeURIComponent(code)}`,
            "Показатели за мястото",
            "This place's indicators",
          ),
        );
      break;
    }
    case "productPrice": {
      const slug = fact(env, "slug");
      if (slug)
        out.push(
          page(
            `/product/${encodeURIComponent(slug)}`,
            "Продукт — цени по вериги",
            "Product — prices by chain",
          ),
        );
      break;
    }
    case "chainProfile": {
      const eik = fact(env, "eik");
      const chain = fact(env, "chain");
      if (eik)
        out.push(
          page(
            `/consumption/chain/${encodeURIComponent(eik)}`,
            `${chain || "Верига"} — пълен профил`,
            `${chain || "Chain"} — full profile`,
          ),
        );
      break;
    }
    case "settlementPrices": {
      const code = env.geo?.mode === "locator" ? env.geo.focus?.[0] : undefined;
      if (code)
        out.push(
          page(
            `/consumption/${encodeURIComponent(code)}`,
            "Цени в населеното място",
            "Prices in this place",
          ),
        );
      break;
    }
    case "subsidiesForEntity": {
      const eik = fact(env, "eik");
      if (eik)
        out.push(
          page(
            `/farm/${encodeURIComponent(eik)}`,
            "Получател — субсидии",
            "Recipient — subsidies",
          ),
        );
      break;
    }
    case "presidentialResults": {
      const cycle = env.provenance
        ?.map((p) => p.match(/^(\d{4}_\d{2}_\d{2}_pvr)\//)?.[1])
        .find(Boolean);
      if (cycle) {
        const obshtina = fact(env, "obshtina_id");
        const oblast = fact(env, "oblast_id");
        const path = presidentialViewUrl(
          obshtina
            ? { level: "municipality", obshtina }
            : oblast
              ? { level: "region", oblast }
              : { level: "country" },
          cycle,
        );
        if (path)
          out.push(page(path, "Президентски избори", "Presidential election"));
      }
      break;
    }
    case "partyTimeline":
    case "partyResult":
    case "partyDemographics": {
      const l = partyLink(env);
      if (l) out.push(l);
      break;
    }
    case "municipalityBreakdown":
    case "settlementBreakdown":
    case "regionBreakdown": {
      const suffix =
        env.tool === "municipalityBreakdown"
          ? "/municipalities"
          : env.tool === "settlementBreakdown"
            ? "/settlements"
            : "/regions";
      const l = partyLink(env, suffix);
      if (l) out.push(l);
      break;
    }
    // Single-section answers deep-link to that station's own page (/section/:id),
    // built from facts.section — the id the section tools always expose.
    case "sectionResults":
    case "sectionHistory":
    case "sectionRiskHistory": {
      const sec = fact(env, "section");
      if (sec)
        out.push({
          label: { bg: "Секция — пълни данни", en: "Section — full data" },
          href: url(`/section/${encodeURIComponent(sec)}`),
        });
      break;
    }
    // "Results by section in a place" is settlement- or município-scoped, so it
    // deep-links to that place's own page (where the per-section breakdown
    // lives), read from the hidden _id facts the tool exposes.
    case "sectionWinners": {
      const ekatte = fact(env, "ekatte_id");
      const ob = fact(env, "obshtina_id");
      if (ekatte)
        out.push({
          label: {
            bg: "Населено място — по секции",
            en: "Settlement — by section",
          },
          href: url(`/sections/${encodeURIComponent(ekatte)}`),
        });
      else if (ob)
        out.push({
          label: { bg: "Община — пълни данни", en: "Municipality — full data" },
          href: url(`/settlement/${encodeURIComponent(ob)}`),
        });
      break;
    }
    // Single-settlement answers deep-link to that place's own dashboard
    // (/sections/:ekatte). The EKATTE is read from the locator overlay these
    // tools always attach, so it never enters facts (the model's narration
    // input) as an opaque code.
    case "settlementResults":
    case "settlementHistory": {
      const ekatte = env.geo?.focus?.[0] ?? env.geo?.areas?.[0]?.code;
      if (ekatte)
        out.push({
          label: {
            bg: "Населено място — пълни данни",
            en: "Settlement — full data",
          },
          href: url(`/sections/${encodeURIComponent(ekatte)}`),
        });
      break;
    }
    // A contractor's contracts deep-link to the firm's own page (the full,
    // filterable contracts list) and to its single biggest contract — the
    // by-id shard store now resolves /procurement/contract/:key for every row.
    case "contractSearch": {
      const eik = fact(env, "eik_id");
      if (eik)
        out.push({
          label: { bg: "Фирма — пълни данни", en: "Company — full profile" },
          href: url(`/company/${encodeURIComponent(eik)}`),
        });
      const key = fact(env, "contract_id");
      if (key)
        out.push({
          label: { bg: "Най-голям договор", en: "Largest contract" },
          href: url(`/procurement/contract/${encodeURIComponent(key)}`),
        });
      break;
    }
    case "companyProfile":
    case "companyConnections": {
      const eik = fact(env, "eik_id");
      if (eik)
        out.push({
          label: { bg: "Фирма — пълни данни", en: "Company — full profile" },
          href: url(`/company/${encodeURIComponent(eik)}`),
        });
      break;
    }
    case "awarderProcurement": {
      const eik = fact(env, "eik");
      if (eik)
        out.push(
          page(
            `/awarder/${encodeURIComponent(eik)}`,
            "Възложител — пълен профил",
            "Buyer — full profile",
          ),
        );
      break;
    }
    case "ministryBudget": {
      const id = env.provenance
        ?.map((p) => p.match(/^budget\/ministries\/([^/]+)\.json$/)?.[1])
        .find(Boolean);
      if (id)
        out.push(
          page(
            `/budget/ministry/${encodeURIComponent(id)}`,
            "Институция — бюджет",
            "Institution — budget",
          ),
        );
      break;
    }
    case "personConnections":
    case "personWealth":
    case "personProfile": {
      const person = fact(env, "person_id");
      if (person)
        out.push({
          label: { bg: "Лице — пълен профил", en: "Person — full profile" },
          href: url(`/person/${encodeURIComponent(person)}`),
        });
      break;
    }
    case "schoolMatura": {
      const school = fact(env, "school_id");
      if (school)
        out.push({
          label: {
            bg: "Училище — пълен профил",
            en: "School — full profile",
          },
          href: url(`/school/${encodeURIComponent(school)}`),
        });
      break;
    }
    // Keep the ranking's aggregate page; the leading hospital is a drilldown.
    case "nzokHospitals": {
      out.push(SECTION.nzok);
      const eik = fact(env, "eik_id");
      if (eik)
        out.push({
          label: {
            bg: "Най-голяма болница — профил",
            en: "Largest hospital — profile",
          },
          href: url(`/company/${encodeURIComponent(eik)}`),
        });
      break;
    }
    // A hospital scorecard → that hospital's own /company/:eik page, where the
    // full report card + decile fan + reporting-coverage live.
    case "nzokHospitalScorecard": {
      const eik = fact(env, "eik_id");
      if (eik)
        out.push({
          label: { bg: "Болница — профил", en: "Hospital — profile" },
          href: url(`/company/${encodeURIComponent(eik)}`),
        });
      break;
    }
    // A per-molecule drug-price answer → that molecule's own /molecule/:inn page
    // (which hospitals overpay + the month-by-month price trend).
    case "nzokDrugMolecule": {
      const inn = fact(env, "inn_id");
      if (inn)
        out.push({
          label: { bg: "Лекарство — профил", en: "Molecule — profile" },
          href: url(`/molecule/${encodeURIComponent(inn)}`),
        });
      break;
    }
    // Tender-stage answers → the /procurement/tenders search, pre-filtered to
    // the same topic / keyword + year (hidden link facts), so the reader lands
    // on the exact result set the answer summarised.
    case "openTenders": {
      const params = new URLSearchParams();
      const slug = fact(env, "link_topic");
      const q = fact(env, "link_q");
      if (slug) params.set("topic", slug);
      else if (q) params.set("q", q);
      const yr = fact(env, "year");
      if (yr) params.set("pscope", `y:${yr}`);
      const qs = params.toString();
      out.push({
        label: { bg: "Обявени поръчки", en: "Announced tenders" },
        href: url(`/procurement/tenders${qs ? `?${qs}` : ""}`),
      });
      break;
    }
    // A single procedure → its detail page (/tenders/:unp).
    case "tenderLookup": {
      const unp = fact(env, "unp");
      out.push(
        unp
          ? {
              label: { bg: "Поръчката (процедура)", en: "The tender" },
              href: url(`/tenders/${encodeURIComponent(unp)}`),
            }
          : SECTION.tenders,
      );
      break;
    }
    // Per-agency profile / poll / accuracy answers deep-link to that agency's
    // own page (/polls/:agencyId), built from facts.agency_id.
    case "agencyProfile":
    case "agencyPolls":
    case "agencyAccuracyHistory": {
      const id = fact(env, "agency_id");
      if (id)
        out.push({
          label: { bg: "Агенция — пълен профил", en: "Agency — full profile" },
          href: url(`/polls/${encodeURIComponent(id)}`),
        });
      break;
    }
    // Single-candidate answers deep-link to that person's own page, built from
    // facts.candidate_id (the unambiguous c-{partyNum}-{slug} form the tool
    // emits). The _id fact is hidden from the scalar UI (see AnswerView).
    case "candidateResult": {
      const id = fact(env, "candidate_id");
      if (id)
        out.push({
          label: { bg: "Кандидат — профил", en: "Candidate — profile" },
          href: url(`/candidate/${encodeURIComponent(id)}`),
        });
      break;
    }
    // Single-MP answers deep-link to that MP's own page — the voting profile to
    // the full MP dashboard, "who votes like X" to the similarity ranking. Both
    // read facts.mp_id (hidden from the scalar UI).
    case "mpVotingProfile": {
      const id = fact(env, "mp_id");
      if (id)
        out.push({
          label: { bg: "Депутат — профил", en: "MP — profile" },
          href: url(`/candidate/mp-${encodeURIComponent(id)}`),
        });
      break;
    }
    case "mpSimilarity": {
      const id = fact(env, "mp_id");
      if (id)
        out.push({
          label: { bg: "Кой гласува като…", en: "Voting peers" },
          href: url(`/parliament/similarity/${encodeURIComponent(id)}`),
        });
      break;
    }
    // Single-region / single-municipality answers deep-link to that place's own
    // dashboard, read from the locator overlay (no facts pollution). Sofia-city
    // is summed from 3 МИР and has no single page, so it keeps the regions
    // overview: its region locator then carries 3 focus codes (not 1) and its
    // municipality locator falls back to the oblast level — both detected here.
    case "regionResults":
    case "regionResultsTrend": {
      const g = env.geo;
      if (g && g.focus?.length === 1)
        out.push({
          label: { bg: "Област — пълни данни", en: "Region — full data" },
          href: url(`/municipality/${encodeURIComponent(g.focus[0])}`),
        });
      else out.push(SECTION.regions);
      break;
    }
    case "municipalityResults":
    case "municipalityHistory": {
      const g = env.geo;
      const ob = g?.level === "municipality" ? g.areas?.[0]?.code : undefined;
      if (ob)
        out.push({
          label: {
            bg: "Община — пълни данни",
            en: "Municipality — full data",
          },
          href: url(`/settlement/${encodeURIComponent(ob)}`),
        });
      else out.push(SECTION.regions);
      break;
    }
    // Single-município LOCAL answers deep-link to that município's local page
    // (overview / mayor race / council / sub-mayors / mayor history). The
    // município code + cycle come from hidden _id facts the tools expose — NOT
    // the geo locator, whose Sofia fallback (oblast level) would otherwise drop
    // the synthetic "SOF" bundle. localMayorHistory is cross-cycle, so its
    // cycle_id pins the latest cycle.
    case "localMunicipality":
    case "localMayorRace":
    case "localMayorSections":
    case "localCouncil":
    case "localSubMayors":
    case "localMayorHistory": {
      const ob = fact(env, "obshtina_id");
      const cycle = fact(env, "cycle_id");
      if (ob && cycle) {
        const suffix = ["localMayorRace", "localMayorSections"].includes(
          env.tool,
        )
          ? "/mayor"
          : env.tool === "localCouncil"
            ? "/council"
            : "";
        out.push({
          label: {
            bg: "Община — местни избори",
            en: "Municipality — local elections",
          },
          href: url(`/local/${cycle}/${encodeURIComponent(ob)}${suffix}`),
        });
      }
      break;
    }
    // Extraordinary (partial + new) local elections -> the dedicated feed page,
    // not the cycle landing. The chat can filter the feed to one município, but
    // the site has a single chronological page for all of them.
    case "chmiEvents": {
      out.push({
        label: {
          bg: "Извънредни местни избори",
          en: "Extraordinary local elections",
        },
        href: url("/local/chmi"),
      });
      break;
    }
    // A scored tax-policy what-if deep-links to the simulator with the exact
    // scenario pre-set (facts.scenario_id carries the simulator's own query
    // string, e.g. "dds=22"; empty = current law, plain page).
    case "simulateTaxChange": {
      const qs = fact(env, "scenario_id");
      out.push({
        label: {
          bg: "Отвори в бюджетния симулатор",
          en: "Open in the budget simulator",
        },
        href: url(`/budget/simulator${qs ? `?${qs}` : ""}`),
      });
      break;
    }
    // Single-settlement procurement -> that place's own procurement page
    // (/procurement/settlement/:ekatte), read from the locator overlay (focus = ekatte).
    case "procurementBySettlement": {
      const ekatte = env.geo?.focus?.[0] ?? env.geo?.areas?.[0]?.code;
      if (ekatte)
        out.push({
          label: {
            bg: "Поръчки в населеното място",
            en: "Procurement in this place",
          },
          href: url(`/procurement/settlement/${encodeURIComponent(ekatte)}`),
        });
      break;
    }
    // Council resolutions open the same municipality's dedicated council page.
    case "councilResolutions": {
      const ob = fact(env, "obshtina_id");
      if (ob)
        out.push({
          label: { bg: "Общински съвет", en: "Municipal council" },
          href: url(`/council/${encodeURIComponent(ob)}`),
        });
      else out.push(page("/council", "Общински съвети", "Municipal councils"));
      break;
    }
  }

  const localTools = new Set([
    "localCouncilVoteShare",
    "localMayorsWon",
    "localCouncilTrend",
    "localVoteFlows",
    "localPrevoteFlow",
    "localPlaceTrend",
    "localMayorsTrend",
    "localOblastMayors",
    "localMunicipality",
    "localMayorRace",
    "localMayorSections",
    "localMayorHistory",
    "localSubMayors",
    "localCouncil",
  ]);
  if (out.length === 0) {
    if (localTools.has(env.tool)) {
      const cycles = new Set(
        (env.provenance ?? []).flatMap((p) => {
          const cycle = p.match(/^(\d{4}_\d{2}_\d{2}_mi)\//)?.[1];
          return cycle ? [cycle] : [];
        }),
      );
      const cycle =
        fact(env, "cycle_id") ??
        (cycles.size === 1 ? [...cycles][0] : latestLocalCycle());
      out.push({ ...localSection(), href: url(`/local/${cycle}`) });
    } else {
      const section = SUBJECT_PAGES[env.tool];
      if (section) out.push(section);
    }
  }

  // No domain fallback: an absent destination is better than an unrelated page.

  // De-dupe by href (a party tool may share a section with its deep link), then
  // pin the election on parliamentary pages so the link opens on the same
  // election the answer is about (not the site's latest-election default).
  const election = answerElection(env);
  const seen = new Set<string>();
  return out
    .filter((l) => (seen.has(l.href) ? false : (seen.add(l.href), true)))
    .map((l) => {
      const target = new URL(l.href);
      if (election && isElectionScopedPath(target.pathname))
        target.searchParams.set("elections", election);
      const fiscalYear = fact(env, "fiscalYear") ?? fact(env, "year");
      if (
        [
          "/budget/deviations",
          "/budget/law",
          "/budget/ministries",
          "/budget/municipal",
          "/budget/municipal/capital",
          "/budget/execution",
          "/budget/functional",
          "/budget/revenue",
        ].includes(target.pathname) &&
        fiscalYear &&
        /^20\d{2}$/.test(fiscalYear)
      )
        target.searchParams.set("fy", fiscalYear);
      return { ...l, href: target.toString() };
    });
};
