import { FC, lazy, PropsWithChildren, Suspense, useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { Layout } from "./layout/Layout";
import { ROADS_AWARDER_PATH } from "./screens/components/procurement/sectorPacks";
import { CabinetAnchorProvider } from "@/data/macro/cabinetAnchorContext";
import { AreaAnchorProvider } from "@/data/area/AreaAnchorProvider";

// Eagerly load the home screen so the landing page has no Suspense flash.
import { DashboardScreen } from "@/screens/DashboardScreen";

const GovernanceScreen = lazy(() =>
  import("@/screens/GovernanceScreen").then((m) => ({
    default: m.GovernanceScreen,
  })),
);

const MunicipalitiesScreen = lazy(() =>
  import("@/screens/MunicipalitiesScreen").then((m) => ({
    default: m.MunicipalitiesScreen,
  })),
);
const SettlementsScreen = lazy(() =>
  import("@/screens/SettlementsScreen").then((m) => ({
    default: m.SettlementsScreen,
  })),
);
const NotFound = lazy(() =>
  import("@/screens/NotFound").then((m) => ({ default: m.NotFound })),
);

// Public SQL browser (/db) — a Datasette-style read-only console over the open
// data. Backed by /api/sql/* (the Vite plugin in dev, the hardened `sql` Cloud
// Function in prod). Lazy-loaded so its CodeMirror deps stay in a separate chunk.
const SqlBrowserScreen = lazy(() =>
  import("@/screens/dev/SqlBrowserScreen").then((m) => ({
    default: m.SqlBrowserScreen,
  })),
);

// DB-backed person page (/person/:name) — served in prod by the `db` Cloud
// Function via the /api/db/** rewrite (dev: the Vite plugin), so it ships.
const PersonScreen = lazy(() =>
  import("@/screens/dev/PersonScreen").then((m) => ({
    default: m.PersonScreen,
  })),
);

// DB-backed company page (/db/company/:eik) — works for any TR company, incl. the
// ~1M with no procurement JSON shard. Same /api/db serving path.
const CompanyDbScreen = lazy(() =>
  import("@/screens/dev/CompanyDbScreen").then((m) => ({
    default: m.CompanyDbScreen,
  })),
);
// DB-driven contracts / annexes drill-downs (server-side paginated table).
const CompanyContractsDbScreen = lazy(() =>
  import("@/screens/dev/CompanyContractsDbScreen").then((m) => ({
    default: m.CompanyContractsDbScreen,
  })),
);
// DB-driven EU-funds (ИСУН) per-project drill-down (server-side paginated table).
const CompanyFundsDbScreen = lazy(() =>
  import("@/screens/dev/CompanyFundsDbScreen").then((m) => ({
    default: m.CompanyFundsDbScreen,
  })),
);
// DB-driven officers/partners drill-down (server-side paginated table).
const CompanyOfficersDbScreen = lazy(() =>
  import("@/screens/dev/CompanyOfficersDbScreen").then((m) => ({
    default: m.CompanyOfficersDbScreen,
  })),
);
const SectionsScreen = lazy(() =>
  import("./screens/SectionsScreen").then((m) => ({
    default: m.SectionsScreen,
  })),
);
const SectionScreen = lazy(() =>
  import("./screens/SectionScreen").then((m) => ({
    default: m.SectionScreen,
  })),
);
const SectionPartiesScreen = lazy(() =>
  import("./screens/SectionPartiesScreen").then((m) => ({
    default: m.SectionPartiesScreen,
  })),
);
const SectionPreferencesScreen = lazy(() =>
  import("./screens/SectionPreferencesScreen").then((m) => ({
    default: m.SectionPreferencesScreen,
  })),
);
const SectionFlashMemoryScreen = lazy(() =>
  import("./screens/SectionFlashMemoryScreen").then((m) => ({
    default: m.SectionFlashMemoryScreen,
  })),
);
const SectionRecountScreen = lazy(() =>
  import("./screens/SectionRecountScreen").then((m) => ({
    default: m.SectionRecountScreen,
  })),
);
const AboutScreen = lazy(() =>
  import("./screens/AboutScreen").then((m) => ({ default: m.AboutScreen })),
);
const DataMapScreen = lazy(() =>
  import("./screens/DataMapScreen").then((m) => ({
    default: m.DataMapScreen,
  })),
);
const DataSourcesScreen = lazy(() =>
  import("./screens/DataSourcesScreen").then((m) => ({
    default: m.DataSourcesScreen,
  })),
);
const DataUpdatesScreen = lazy(() =>
  import("./screens/DataUpdatesScreen").then((m) => ({
    default: m.DataUpdatesScreen,
  })),
);
const PricesScreen = lazy(() =>
  import("./screens/PricesScreen").then((m) => ({
    default: m.PricesScreen,
  })),
);
const JudiciaryScreen = lazy(() =>
  import("./screens/judiciary/JudiciaryScreen").then((m) => ({
    default: m.JudiciaryScreen,
  })),
);
const EducationScreen = lazy(() =>
  import("./screens/education/EducationScreen").then((m) => ({
    default: m.EducationScreen,
  })),
);
const SchoolScreen = lazy(() =>
  import("./screens/education/SchoolScreen").then((m) => ({
    default: m.SchoolScreen,
  })),
);
// Local-elections stub — step 1 placeholder. Hosts both the cycle
// overview (/local/:cycle) and the per-município full results
// (/local/:cycle/:obshtinaCode) until step 3 ships dedicated screens.
const LocalElectionScreen = lazy(() =>
  import("./screens/LocalElectionScreen").then((m) => ({
    default: m.LocalElectionScreen,
  })),
);
const LocalRaceScreen = lazy(() =>
  import("./screens/LocalElectionScreen").then((m) => ({
    default: m.LocalRaceScreen,
  })),
);
const SverkaScreen = lazy(() =>
  import("./screens/SverkaScreen").then((m) => ({
    default: m.SverkaScreen,
  })),
);
const ChmiFeedScreen = lazy(() =>
  import("./screens/ChmiFeedScreen").then((m) => ({
    default: m.ChmiFeedScreen,
  })),
);
const LocalRegionDashboardScreen = lazy(() =>
  import("./screens/LocalRegionDashboardScreen").then((m) => ({
    default: m.LocalRegionDashboardScreen,
  })),
);
const LocalAllRegionsScreen = lazy(() =>
  import("./screens/LocalAllRegionsScreen").then((m) => ({
    default: m.LocalAllRegionsScreen,
  })),
);
const LocalMunicipalityListScreen = lazy(() =>
  import("./screens/LocalMunicipalityListScreen").then((m) => ({
    default: m.LocalMunicipalityListScreen,
  })),
);
const LocalLeaderboardScreen = lazy(() =>
  import("./screens/LocalLeaderboardScreen").then((m) => ({
    default: m.LocalLeaderboardScreen,
  })),
);
const LocalRegionLeaderboardScreen = lazy(() =>
  import("./screens/LocalRegionLeaderboardScreen").then((m) => ({
    default: m.LocalRegionLeaderboardScreen,
  })),
);
const LocalSettlementDashboardScreen = lazy(() =>
  import("./screens/LocalSettlementDashboardScreen").then((m) => ({
    default: m.LocalSettlementDashboardScreen,
  })),
);
const LocalSectionScreen = lazy(() =>
  import("./screens/LocalSectionScreen").then((m) => ({
    default: m.LocalSectionScreen,
  })),
);
const LocalSectionsListScreen = lazy(() =>
  import("./screens/LocalSectionsListScreen").then((m) => ({
    default: m.LocalSectionsListScreen,
  })),
);
const SofiaScreen = lazy(() =>
  import("./screens/SofiaScreen").then((m) => ({ default: m.SofiaScreen })),
);
const SofiaPartiesScreen = lazy(() =>
  import("./screens/SofiaPartiesScreen").then((m) => ({
    default: m.SofiaPartiesScreen,
  })),
);
const SofiaPreferencesScreen = lazy(() =>
  import("./screens/SofiaPreferencesScreen").then((m) => ({
    default: m.SofiaPreferencesScreen,
  })),
);
const SofiaFlashMemoryScreen = lazy(() =>
  import("./screens/SofiaFlashMemoryScreen").then((m) => ({
    default: m.SofiaFlashMemoryScreen,
  })),
);
const SofiaRecountScreen = lazy(() =>
  import("./screens/SofiaRecountScreen").then((m) => ({
    default: m.SofiaRecountScreen,
  })),
);
const PartiesFinancing = lazy(() =>
  import("./screens/PartiesFinancing").then((m) => ({
    default: m.PartiesFinancing,
  })),
);
const PartyAnnualReportsScreen = lazy(() =>
  import("./screens/PartyAnnualReportsScreen").then((m) => ({
    default: m.PartyAnnualReportsScreen,
  })),
);
const PartyAnnualReportScreen = lazy(() =>
  import("./screens/PartyAnnualReportScreen").then((m) => ({
    default: m.PartyAnnualReportScreen,
  })),
);
const PartyScreen = lazy(() =>
  import("./screens/PartyScreen").then((m) => ({ default: m.PartyScreen })),
);
const PartyRegionsScreen = lazy(() =>
  import("./screens/PartyRegionsScreen").then((m) => ({
    default: m.PartyRegionsScreen,
  })),
);
const PartyMunicipalitiesScreen = lazy(() =>
  import("./screens/PartyMunicipalitiesScreen").then((m) => ({
    default: m.PartyMunicipalitiesScreen,
  })),
);
const PartySettlementsScreen = lazy(() =>
  import("./screens/PartySettlementsScreen").then((m) => ({
    default: m.PartySettlementsScreen,
  })),
);
const PartyPreferencesScreen = lazy(() =>
  import("./screens/PartyPreferencesScreen").then((m) => ({
    default: m.PartyPreferencesScreen,
  })),
);
const PartyDonorsScreen = lazy(() =>
  import("./screens/PartyDonorsScreen").then((m) => ({
    default: m.PartyDonorsScreen,
  })),
);
const PartyDonorsListScreen = lazy(() =>
  import("./screens/PartyDonorsListScreen").then((m) => ({
    default: m.PartyDonorsListScreen,
  })),
);
const PartyIncomeScreen = lazy(() =>
  import("./screens/PartyIncomeScreen").then((m) => ({
    default: m.PartyIncomeScreen,
  })),
);
const PartyExpensesScreen = lazy(() =>
  import("./screens/PartyExpensesScreen").then((m) => ({
    default: m.PartyExpensesScreen,
  })),
);
const CandidateScreen = lazy(() =>
  import("./screens/CandidateScreen").then((m) => ({
    default: m.CandidateScreen,
  })),
);
const CandidateRegionsScreen = lazy(() =>
  import("./screens/CandidateRegionsScreen").then((m) => ({
    default: m.CandidateRegionsScreen,
  })),
);
const CandidateMunicipalitiesScreen = lazy(() =>
  import("./screens/CandidateMunicipalitiesScreen").then((m) => ({
    default: m.CandidateMunicipalitiesScreen,
  })),
);
const CandidateSettlementsScreen = lazy(() =>
  import("./screens/CandidateSettlementsScreen").then((m) => ({
    default: m.CandidateSettlementsScreen,
  })),
);
const CandidateSectionsScreen = lazy(() =>
  import("./screens/CandidateSectionsScreen").then((m) => ({
    default: m.CandidateSectionsScreen,
  })),
);
const CandidateDonationsScreen = lazy(() =>
  import("./screens/CandidateDonationsScreen").then((m) => ({
    default: m.CandidateDonationsScreen,
  })),
);
const CandidateConnectionsScreen = lazy(() =>
  import("./screens/CandidateConnectionsScreen").then((m) => ({
    default: m.CandidateConnectionsScreen,
  })),
);
const CandidateAssetsScreen = lazy(() =>
  import("./screens/CandidateAssetsScreen").then((m) => ({
    default: m.CandidateAssetsScreen,
  })),
);
const CandidateProcurementScreen = lazy(() =>
  import("./screens/CandidateProcurementScreen").then((m) => ({
    default: m.CandidateProcurementScreen,
  })),
);
const ProcurementBySettlementScreen = lazy(() =>
  import("./screens/procurement/ProcurementBySettlementScreen").then((m) => ({
    default: m.ProcurementBySettlementScreen,
  })),
);
const ContractsBrowserDbScreen = lazy(() =>
  import("./screens/dev/ContractsBrowserDbScreen").then((m) => ({
    default: m.ContractsBrowserDbScreen,
  })),
);
const NgoBrowseDbScreen = lazy(() =>
  import("./screens/dev/NgoBrowseDbScreen").then((m) => ({
    default: m.NgoBrowseDbScreen,
  })),
);
const ProcurementSettlementDetailScreen = lazy(() =>
  import("./screens/procurement/ProcurementSettlementDetailScreen").then(
    (m) => ({
      default: m.ProcurementSettlementDetailScreen,
    }),
  ),
);
const ProcurementScreen = lazy(() =>
  import("./screens/ProcurementScreen").then((m) => ({
    default: m.ProcurementScreen,
  })),
);
const TendersBrowserDbScreen = lazy(() =>
  import("./screens/dev/TendersBrowserDbScreen").then((m) => ({
    default: m.TendersBrowserDbScreen,
  })),
);
const SubsidiesDashboardScreen = lazy(() =>
  import("./screens/SubsidiesDashboardScreen").then((m) => ({
    default: m.SubsidiesDashboardScreen,
  })),
);
const SubsidiesBrowserDbScreen = lazy(() =>
  import("./screens/dev/SubsidiesBrowserDbScreen").then((m) => ({
    default: m.SubsidiesBrowserDbScreen,
  })),
);
const FarmDetailScreen = lazy(() =>
  import("./screens/dev/FarmDetailScreen").then((m) => ({
    default: m.FarmDetailScreen,
  })),
);
const AppealsBrowserDbScreen = lazy(() =>
  import("./screens/dev/AppealsBrowserDbScreen").then((m) => ({
    default: m.AppealsBrowserDbScreen,
  })),
);
const TenderDetailScreen = lazy(() =>
  import("./screens/procurement/TenderDetailScreen").then((m) => ({
    default: m.TenderDetailScreen,
  })),
);
const ProcurementFlagsScreen = lazy(() =>
  import("./screens/ProcurementFlagsScreen").then((m) => ({
    default: m.ProcurementFlagsScreen,
  })),
);
const ProcurementWatchlistScreen = lazy(() =>
  import("./screens/ProcurementWatchlistScreen").then((m) => ({
    default: m.ProcurementWatchlistScreen,
  })),
);
const CandidateFundsScreen = lazy(() =>
  import("./screens/CandidateFundsScreen").then((m) => ({
    default: m.CandidateFundsScreen,
  })),
);
const FundsProgramScreen = lazy(() =>
  import("./screens/funds/FundsProgramScreen").then((m) => ({
    default: m.FundsProgramScreen,
  })),
);
const FundsContractScreen = lazy(() =>
  import("./screens/funds/FundsContractScreen").then((m) => ({
    default: m.FundsContractScreen,
  })),
);
const FundsScreen = lazy(() =>
  import("./screens/FundsScreen").then((m) => ({
    default: m.FundsScreen,
  })),
);
const FundsPoliticalScreen = lazy(() =>
  import("./screens/funds/FundsPoliticalScreen").then((m) => ({
    default: m.FundsPoliticalScreen,
  })),
);
const FundsIntegrityScreen = lazy(() =>
  import("./screens/funds/FundsIntegrityScreen").then((m) => ({
    default: m.FundsIntegrityScreen,
  })),
);
const FundsFocusScreen = lazy(() =>
  import("./screens/funds/FundsFocusScreen").then((m) => ({
    default: m.FundsFocusScreen,
  })),
);
const FundsRrfScreen = lazy(() =>
  import("./screens/funds/FundsRrfScreen").then((m) => ({
    default: m.FundsRrfScreen,
  })),
);
const TopContractorsScreen = lazy(() =>
  import("./screens/TopContractorsScreen").then((m) => ({
    default: m.TopContractorsScreen,
  })),
);
const TopAwardersScreen = lazy(() =>
  import("./screens/TopAwardersScreen").then((m) => ({
    default: m.TopAwardersScreen,
  })),
);
const TopMpsScreen = lazy(() =>
  import("./screens/TopMpsScreen").then((m) => ({
    default: m.TopMpsScreen,
  })),
);
const ProcurementSectorsScreen = lazy(() =>
  import("./screens/ProcurementSectorsScreen").then((m) => ({
    default: m.ProcurementSectorsScreen,
  })),
);
const AwarderContractorsScreen = lazy(() =>
  import("./screens/AwarderContractorsScreen").then((m) => ({
    default: m.AwarderContractorsScreen,
  })),
);
const CompanyAwardersScreen = lazy(() =>
  import("./screens/CompanyAwardersScreen").then((m) => ({
    default: m.CompanyAwardersScreen,
  })),
);
const ContractDetailScreen = lazy(() =>
  import("./screens/ContractDetailScreen").then((m) => ({
    default: m.ContractDetailScreen,
  })),
);
const BudgetScreen = lazy(() =>
  import("./screens/BudgetScreen").then((m) => ({
    default: m.BudgetScreen,
  })),
);
const BudgetMethodologyScreen = lazy(() =>
  import("./screens/BudgetMethodologyScreen").then((m) => ({
    default: m.BudgetMethodologyScreen,
  })),
);
const BudgetMinistryScreen = lazy(() =>
  import("./screens/BudgetMinistryScreen").then((m) => ({
    default: m.BudgetMinistryScreen,
  })),
);
const BudgetTaxCalculatorScreen = lazy(() =>
  import("./screens/BudgetTaxCalculatorScreen").then((m) => ({
    default: m.BudgetTaxCalculatorScreen,
  })),
);
const BudgetPolicySimulatorScreen = lazy(() =>
  import("./screens/BudgetPolicySimulatorScreen").then((m) => ({
    default: m.BudgetPolicySimulatorScreen,
  })),
);
const SessionsIndexScreen = lazy(() =>
  import("./screens/SessionsIndexScreen").then((m) => ({
    default: m.SessionsIndexScreen,
  })),
);
const SessionScreen = lazy(() =>
  import("./screens/SessionScreen").then((m) => ({
    default: m.SessionScreen,
  })),
);
const ParliamentCohesionScreen = lazy(() =>
  import("./screens/ParliamentCohesionScreen").then((m) => ({
    default: m.ParliamentCohesionScreen,
  })),
);
const ParliamentAttendanceScreen = lazy(() =>
  import("./screens/ParliamentAttendanceScreen").then((m) => ({
    default: m.ParliamentAttendanceScreen,
  })),
);
const MpSimilarityScreen = lazy(() =>
  import("./screens/MpSimilarityScreen").then((m) => ({
    default: m.MpSimilarityScreen,
  })),
);
const PartyPairBreaksScreen = lazy(() =>
  import("./screens/PartyPairBreaksScreen").then((m) => ({
    default: m.PartyPairBreaksScreen,
  })),
);
const ParliamentEmbeddingScreen = lazy(() =>
  import("./screens/ParliamentEmbeddingScreen").then((m) => ({
    default: m.ParliamentEmbeddingScreen,
  })),
);
const ParliamentHubScreen = lazy(() =>
  import("./screens/ParliamentHubScreen").then((m) => ({
    default: m.ParliamentHubScreen,
  })),
);
const MpCompanyScreen = lazy(() =>
  import("./screens/MpCompanyScreen").then((m) => ({
    default: m.MpCompanyScreen,
  })),
);
const ConnectionsScreen = lazy(() =>
  import("./screens/ConnectionsScreen").then((m) => ({
    default: m.ConnectionsScreen,
  })),
);
const AllMpCompaniesScreen = lazy(() =>
  import("./screens/AllMpCompaniesScreen").then((m) => ({
    default: m.AllMpCompaniesScreen,
  })),
);
const AllMpAssetsScreen = lazy(() =>
  import("./screens/AllMpAssetsScreen").then((m) => ({
    default: m.AllMpAssetsScreen,
  })),
);
const OfficialsAssetsScreen = lazy(() =>
  import("./screens/OfficialsAssetsScreen").then((m) => ({
    default: m.OfficialsAssetsScreen,
  })),
);
const OfficialProfileScreen = lazy(() =>
  import("./screens/OfficialProfileScreen").then((m) => ({
    default: m.OfficialProfileScreen,
  })),
);
const MpCarsScreen = lazy(() =>
  import("./screens/MpCarsScreen").then((m) => ({
    default: m.MpCarsScreen,
  })),
);
const SimulatorScreen = lazy(() =>
  import("./screens/SimulatorScreen").then((m) => ({
    default: m.SimulatorScreen,
  })),
);
const WastedVoteScreen = lazy(() =>
  import("./screens/WastedVoteScreen").then((m) => ({
    default: m.WastedVoteScreen,
  })),
);
const WastedVoteRegionsScreen = lazy(() =>
  import("./screens/WastedVoteRegionsScreen").then((m) => ({
    default: m.WastedVoteRegionsScreen,
  })),
);
const PersistenceScreen = lazy(() =>
  import("./screens/PersistenceScreen").then((m) => ({
    default: m.PersistenceScreen,
  })),
);
const BenfordScreen = lazy(() =>
  import("./screens/BenfordScreen").then((m) => ({
    default: m.BenfordScreen,
  })),
);
const BenfordDetailScreen = lazy(() =>
  import("./screens/BenfordScreen").then((m) => ({
    default: m.BenfordDetailScreen,
  })),
);
const RiskScoreScreen = lazy(() =>
  import("./screens/RiskScoreScreen").then((m) => ({
    default: m.RiskScoreScreen,
  })),
);
const RiskScoreMethodologyScreen = lazy(() =>
  import("./screens/RiskScoreMethodologyScreen").then((m) => ({
    default: m.RiskScoreMethodologyScreen,
  })),
);
const RiskAnalysisScreen = lazy(() =>
  import("./screens/RiskAnalysisScreen").then((m) => ({
    default: m.RiskAnalysisScreen,
  })),
);
const RiskAnalysisMethodologyScreen = lazy(() =>
  import("./screens/RiskAnalysisMethodologyScreen").then((m) => ({
    default: m.RiskAnalysisMethodologyScreen,
  })),
);
const RiskClusterScreen = lazy(() =>
  import("./screens/RiskClusterScreen").then((m) => ({
    default: m.RiskClusterScreen,
  })),
);
const SectionsWastedVote = lazy(() =>
  import("./screens/reports/sections/SectionsWastedVote").then((m) => ({
    default: m.SectionsWastedVote,
  })),
);
const SettlementsWastedVote = lazy(() =>
  import("./screens/reports/settlements/SettlementsWastedVote").then((m) => ({
    default: m.SettlementsWastedVote,
  })),
);
const MunicipalitiesWastedVote = lazy(() =>
  import("./screens/reports/municipalities/MunicipalitiesWastedVote").then(
    (m) => ({ default: m.MunicipalitiesWastedVote }),
  ),
);
const GovernmentsScreen = lazy(() =>
  import("./screens/GovernmentsScreen").then((m) => ({
    default: m.GovernmentsScreen,
  })),
);
const GovernmentDetailScreen = lazy(() =>
  import("./screens/GovernmentDetailScreen").then((m) => ({
    default: m.GovernmentDetailScreen,
  })),
);
const IndicatorsLandingScreen = lazy(() =>
  import("./screens/indicators/IndicatorsLandingScreen").then((m) => ({
    default: m.IndicatorsLandingScreen,
  })),
);
const IndicatorsEconomyScreen = lazy(() =>
  import("./screens/indicators/IndicatorsEconomyScreen").then((m) => ({
    default: m.IndicatorsEconomyScreen,
  })),
);
const IndicatorsFiscalScreen = lazy(() =>
  import("./screens/indicators/IndicatorsFiscalScreen").then((m) => ({
    default: m.IndicatorsFiscalScreen,
  })),
);
const IndicatorsGovernanceScreen = lazy(() =>
  import("./screens/indicators/IndicatorsGovernanceScreen").then((m) => ({
    default: m.IndicatorsGovernanceScreen,
  })),
);
const IndicatorsSocietyScreen = lazy(() =>
  import("./screens/indicators/IndicatorsSocietyScreen").then((m) => ({
    default: m.IndicatorsSocietyScreen,
  })),
);
const IndicatorsCabinetBudgetsScreen = lazy(() =>
  import("./screens/indicators/IndicatorsCabinetBudgetsScreen").then((m) => ({
    default: m.IndicatorsCabinetBudgetsScreen,
  })),
);
const IndicatorsCompareScreen = lazy(() =>
  import("./screens/indicators/IndicatorsCompareScreen").then((m) => ({
    default: m.IndicatorsCompareScreen,
  })),
);
const ObservationsScreen = lazy(() =>
  import("./screens/ObservationsScreen").then((m) => ({
    default: m.ObservationsScreen,
  })),
);
const DemographicsScreen = lazy(() =>
  import("./screens/DemographicsScreen").then((m) => ({
    default: m.DemographicsScreen,
  })),
);
const RegionsDemographicsScreen = lazy(() =>
  import("./screens/RegionsDemographicsScreen").then((m) => ({
    default: m.RegionsDemographicsScreen,
  })),
);
const MunicipalitiesDemographicsScreen = lazy(() =>
  import("./screens/MunicipalitiesDemographicsScreen").then((m) => ({
    default: m.MunicipalitiesDemographicsScreen,
  })),
);
const CompareScreen = lazy(() =>
  import("./screens/CompareScreen").then((m) => ({
    default: m.CompareScreen,
  })),
);
const VoteFlowMethodologyScreen = lazy(() =>
  import("./screens/VoteFlowMethodologyScreen").then((m) => ({
    default: m.VoteFlowMethodologyScreen,
  })),
);
const BenfordMethodologyScreen = lazy(() =>
  import("./screens/BenfordMethodologyScreen").then((m) => ({
    default: m.BenfordMethodologyScreen,
  })),
);
const AllPartiesScreen = lazy(() =>
  import("./screens/AllPartiesScreen").then((m) => ({
    default: m.AllPartiesScreen,
  })),
);
const AllPreferencesScreen = lazy(() =>
  import("./screens/AllPreferencesScreen").then((m) => ({
    default: m.AllPreferencesScreen,
  })),
);
const AllFlashMemoryScreen = lazy(() =>
  import("./screens/AllFlashMemoryScreen").then((m) => ({
    default: m.AllFlashMemoryScreen,
  })),
);
const AllRecountScreen = lazy(() =>
  import("./screens/AllRecountScreen").then((m) => ({
    default: m.AllRecountScreen,
  })),
);
const AllRegionsScreen = lazy(() =>
  import("./screens/AllRegionsScreen").then((m) => ({
    default: m.AllRegionsScreen,
  })),
);
const PollsScreen = lazy(() =>
  import("./screens/PollsScreen").then((m) => ({
    default: m.PollsScreen,
  })),
);
const PollsAgencyScreen = lazy(() =>
  import("./screens/PollsAgencyScreen").then((m) => ({
    default: m.PollsAgencyScreen,
  })),
);
const ElectionScreen = lazy(() =>
  import("./screens/ElectionScreen").then((m) => ({
    default: m.ElectionScreen,
  })),
);
const ArticlesScreen = lazy(() =>
  import("./screens/ArticlesScreen").then((m) => ({
    default: m.ArticlesScreen,
  })),
);
const ArticleScreen = lazy(() =>
  import("./screens/ArticleScreen").then((m) => ({
    default: m.ArticleScreen,
  })),
);
const RegionPartiesScreen = lazy(() =>
  import("./screens/RegionPartiesScreen").then((m) => ({
    default: m.RegionPartiesScreen,
  })),
);
const RegionPreferencesScreen = lazy(() =>
  import("./screens/RegionPreferencesScreen").then((m) => ({
    default: m.RegionPreferencesScreen,
  })),
);
const RegionFlashMemoryScreen = lazy(() =>
  import("./screens/RegionFlashMemoryScreen").then((m) => ({
    default: m.RegionFlashMemoryScreen,
  })),
);
const RegionMunicipalitiesScreen = lazy(() =>
  import("./screens/RegionMunicipalitiesScreen").then((m) => ({
    default: m.RegionMunicipalitiesScreen,
  })),
);
const RegionRecountScreen = lazy(() =>
  import("./screens/RegionRecountScreen").then((m) => ({
    default: m.RegionRecountScreen,
  })),
);
const MunicipalityPartiesScreen = lazy(() =>
  import("./screens/MunicipalityPartiesScreen").then((m) => ({
    default: m.MunicipalityPartiesScreen,
  })),
);
const MunicipalityPreferencesScreen = lazy(() =>
  import("./screens/MunicipalityPreferencesScreen").then((m) => ({
    default: m.MunicipalityPreferencesScreen,
  })),
);
const MunicipalityFlashMemoryScreen = lazy(() =>
  import("./screens/MunicipalityFlashMemoryScreen").then((m) => ({
    default: m.MunicipalityFlashMemoryScreen,
  })),
);
const MunicipalityRecountScreen = lazy(() =>
  import("./screens/MunicipalityRecountScreen").then((m) => ({
    default: m.MunicipalityRecountScreen,
  })),
);
const SettlementCompaniesScreen = lazy(() =>
  import("./screens/SettlementCompaniesScreen").then((m) => ({
    default: m.SettlementCompaniesScreen,
  })),
);
const MunicipalitySettlementsScreen = lazy(() =>
  import("./screens/MunicipalitySettlementsScreen").then((m) => ({
    default: m.MunicipalitySettlementsScreen,
  })),
);
const SettlementPartiesScreen = lazy(() =>
  import("./screens/SettlementPartiesScreen").then((m) => ({
    default: m.SettlementPartiesScreen,
  })),
);
const SettlementPreferencesScreen = lazy(() =>
  import("./screens/SettlementPreferencesScreen").then((m) => ({
    default: m.SettlementPreferencesScreen,
  })),
);
const SettlementFlashMemoryScreen = lazy(() =>
  import("./screens/SettlementFlashMemoryScreen").then((m) => ({
    default: m.SettlementFlashMemoryScreen,
  })),
);
const SettlementRecountScreen = lazy(() =>
  import("./screens/SettlementRecountScreen").then((m) => ({
    default: m.SettlementRecountScreen,
  })),
);
const SettlementSectionsListScreen = lazy(() =>
  import("./screens/SettlementSectionsListScreen").then((m) => ({
    default: m.SettlementSectionsListScreen,
  })),
);

// Reports — Municipalities
const MunicipalitiesTurnout = lazy(() =>
  import("./screens/reports/municipalities/MunicipalitiesTurnout").then(
    (m) => ({ default: m.MunicipalitiesTurnout }),
  ),
);
const MunicipalitiesConcentration = lazy(() =>
  import("./screens/reports/municipalities/MunicipalitiesConcentration").then(
    (m) => ({ default: m.MunicipalitiesConcentration }),
  ),
);
const MunicipalitiesAdditionalVoters = lazy(() =>
  import(
    "./screens/reports/municipalities/MunicipalitiesAdditionalVoters"
  ).then((m) => ({ default: m.MunicipalitiesAdditionalVoters })),
);
const MunicipalitiesInvalidBallots = lazy(() =>
  import("./screens/reports/municipalities/MunicipalitiesInvalidBallots").then(
    (m) => ({ default: m.MunicipalitiesInvalidBallots }),
  ),
);
const MunicipalitiesSupportsNoOne = lazy(() =>
  import("./screens/reports/municipalities/MunicipalitiesSupportsNoOne").then(
    (m) => ({ default: m.MunicipalitiesSupportsNoOne }),
  ),
);
const MunicipalitiesTopGainers = lazy(() =>
  import("./screens/reports/municipalities/MunicipalitiesTopGainers").then(
    (m) => ({ default: m.MunicipalitiesTopGainers }),
  ),
);
const MunicipalitiesTopLosers = lazy(() =>
  import("./screens/reports/municipalities/MunicipalitiesTopLosers").then(
    (m) => ({ default: m.MunicipalitiesTopLosers }),
  ),
);
const MunicipalitiesRecount = lazy(() =>
  import("./screens/reports/municipalities/MunicipalitiesRecount").then(
    (m) => ({ default: m.MunicipalitiesRecount }),
  ),
);
const MunicipalitiesSuemg = lazy(() =>
  import("./screens/reports/municipalities/MunicipalitiesSuemg").then((m) => ({
    default: m.MunicipalitiesSuemg,
  })),
);
const MunicipalitiesSuemgAdded = lazy(() =>
  import("./screens/reports/municipalities/MunicipalitiesSuemgAdded").then(
    (m) => ({ default: m.MunicipalitiesSuemgAdded }),
  ),
);
const MunicipalitiesSuemgRemoved = lazy(() =>
  import("./screens/reports/municipalities/MunicipalitiesSuemgRemoved").then(
    (m) => ({ default: m.MunicipalitiesSuemgRemoved }),
  ),
);
const MunicipalitiesMissingSuemg = lazy(() =>
  import("./screens/reports/municipalities/MunicipalitiesMissingSuemg").then(
    (m) => ({ default: m.MunicipalitiesMissingSuemg }),
  ),
);

// Reports — Settlements
const SettlementsConcentration = lazy(() =>
  import("./screens/reports/settlements/SettlementsConcentration").then(
    (m) => ({ default: m.SettlementsConcentration }),
  ),
);
const SettlementsTurnout = lazy(() =>
  import("./screens/reports/settlements/SettlementsTurnout").then((m) => ({
    default: m.SettlementsTurnout,
  })),
);
const SettlementsAdditionalVoters = lazy(() =>
  import("./screens/reports/settlements/SettlementsAdditionalVoters").then(
    (m) => ({ default: m.SettlementsAdditionalVoters }),
  ),
);
const SettlementsInvalidBallots = lazy(() =>
  import("./screens/reports/settlements/SettlementsInvalidBallots").then(
    (m) => ({ default: m.SettlementsInvalidBallots }),
  ),
);
const SettlementsSupportsNoOne = lazy(() =>
  import("./screens/reports/settlements/SettlementsSupportsNoOne").then(
    (m) => ({ default: m.SettlementsSupportsNoOne }),
  ),
);
const SettlementsTopGainers = lazy(() =>
  import("./screens/reports/settlements/SettlementsTopGainers").then((m) => ({
    default: m.SettlementsTopGainers,
  })),
);
const SettlementsTopLosers = lazy(() =>
  import("./screens/reports/settlements/SettlementsTopLosers").then((m) => ({
    default: m.SettlementsTopLosers,
  })),
);
const SettlementsRecount = lazy(() =>
  import("./screens/reports/settlements/SettlementsRecount").then((m) => ({
    default: m.SettlementsRecount,
  })),
);
const SettlementsSuemg = lazy(() =>
  import("./screens/reports/settlements/SettlementsSuemg").then((m) => ({
    default: m.SettlementsSuemg,
  })),
);
const SettlementsSuemgAdded = lazy(() =>
  import("./screens/reports/settlements/SettlementsSuemgAdded").then((m) => ({
    default: m.SettlementsSuemgAdded,
  })),
);
const SettlementsSuemgRemoved = lazy(() =>
  import("./screens/reports/settlements/SettlementsSuemgRemoved").then((m) => ({
    default: m.SettlementsSuemgRemoved,
  })),
);
const SettlementsMissingSuemg = lazy(() =>
  import("./screens/reports/settlements/SettlementsMissingSuemg").then((m) => ({
    default: m.SettlementsMissingSuemg,
  })),
);

// Reports — Sections
const SectionsAdditionalVoters = lazy(() =>
  import("./screens/reports/sections/SectionsAdditionalVoters").then((m) => ({
    default: m.SectionsAdditionalVoters,
  })),
);
const SectionsConcentration = lazy(() =>
  import("./screens/reports/sections/SectionsConcentration").then((m) => ({
    default: m.SectionsConcentration,
  })),
);
const SectionsInvalidBallots = lazy(() =>
  import("./screens/reports/sections/SectionsInvalidBallots").then((m) => ({
    default: m.SectionsInvalidBallots,
  })),
);
const SectionsSupportsNoOne = lazy(() =>
  import("./screens/reports/sections/SectionsSupportsNoOne").then((m) => ({
    default: m.SectionsSupportsNoOne,
  })),
);
const SectionsTurnout = lazy(() =>
  import("./screens/reports/sections/SectionsTurnout").then((m) => ({
    default: m.SectionsTurnout,
  })),
);
const SectionsTopGainers = lazy(() =>
  import("./screens/reports/sections/SectionsTopGainers").then((m) => ({
    default: m.SectionsTopGainers,
  })),
);
const SectionsTopLosers = lazy(() =>
  import("./screens/reports/sections/SectionsTopLosers").then((m) => ({
    default: m.SectionsTopLosers,
  })),
);
const SectionsRecount = lazy(() =>
  import("./screens/reports/sections/SectionsRecount").then((m) => ({
    default: m.SectionsRecount,
  })),
);
const SectionsRecountZeroVotes = lazy(() =>
  import("./screens/reports/sections/SectionsRecountZeroVotes").then((m) => ({
    default: m.SectionsRecountZeroVotes,
  })),
);
const SectionsSuemg = lazy(() =>
  import("./screens/reports/sections/SectionsSuemg").then((m) => ({
    default: m.SectionsSuemg,
  })),
);
const SectionsSuemgAdded = lazy(() =>
  import("./screens/reports/sections/SectionsSuemgAdded").then((m) => ({
    default: m.SectionsSuemgAdded,
  })),
);
const SectionsSuemgRemoved = lazy(() =>
  import("./screens/reports/sections/SectionsSuemgRemoved").then((m) => ({
    default: m.SectionsSuemgRemoved,
  })),
);
const SectionsMissingSuemg = lazy(() =>
  import("./screens/reports/sections/SectionsMissingSuemg").then((m) => ({
    default: m.SectionsMissingSuemg,
  })),
);
const ProblemSections = lazy(() =>
  import("./screens/reports/sections/ProblemSections").then((m) => ({
    default: m.ProblemSections,
  })),
);
const ProblemSectionDetail = lazy(() =>
  import("./screens/reports/sections/ProblemSectionDetail").then((m) => ({
    default: m.ProblemSectionDetail,
  })),
);
const ProblemSectionPartiesScreen = lazy(() =>
  import("./screens/reports/sections/ProblemSectionPartiesScreen").then(
    (m) => ({ default: m.ProblemSectionPartiesScreen }),
  ),
);
const ProblemSectionListScreen = lazy(() =>
  import("./screens/reports/sections/ProblemSectionListScreen").then((m) => ({
    default: m.ProblemSectionListScreen,
  })),
);
const ProblemSectionFlashMemoryScreen = lazy(() =>
  import("./screens/reports/sections/ProblemSectionFlashMemoryScreen").then(
    (m) => ({ default: m.ProblemSectionFlashMemoryScreen }),
  ),
);
const ProblemSectionRecountScreen = lazy(() =>
  import("./screens/reports/sections/ProblemSectionRecountScreen").then(
    (m) => ({ default: m.ProblemSectionRecountScreen }),
  ),
);

const MyAreaScreen = lazy(() =>
  import("./screens/myarea/MyAreaScreen").then((m) => ({
    default: m.MyAreaScreen,
  })),
);

const MyAreaEntryScreen = lazy(() =>
  import("./screens/myarea/MyAreaEntryScreen").then((m) => ({
    default: m.MyAreaEntryScreen,
  })),
);

const RegionGovernanceScreen = lazy(() =>
  import("./screens/RegionGovernanceScreen").then((m) => ({
    default: m.RegionGovernanceScreen,
  })),
);
const ConsumptionScreen = lazy(() =>
  import("./screens/ConsumptionScreen").then((m) => ({
    default: m.ConsumptionScreen,
  })),
);
const RegionConsumptionScreen = lazy(() =>
  import("./screens/RegionConsumptionScreen").then((m) => ({
    default: m.RegionConsumptionScreen,
  })),
);
const ConsumptionPlaceScreen = lazy(() =>
  import("./screens/ConsumptionPlaceScreen").then((m) => ({
    default: m.ConsumptionPlaceScreen,
  })),
);
const ProductsBrowserScreen = lazy(() =>
  import("./screens/consumption/ProductsBrowserScreen").then((m) => ({
    default: m.ProductsBrowserScreen,
  })),
);
const ProductScreen = lazy(() =>
  import("./screens/product/ProductScreen").then((m) => ({
    default: m.ProductScreen,
  })),
);

// Back-compat: the data map moved from /data/map to /data when it became the
// data hub's landing view. Keep ?node=/?view= deep links working.
const DataMapRedirect: FC = () => {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/data", search }} replace />;
};

// Back-compat: the place dashboards moved from /my-area/:id to /governance/:id
// (the possessive /my-area entry funnel stays). Redirect any stale id link.
const MyAreaIdRedirect: FC = () => {
  const { id } = useParams<{ id: string }>();
  const { search } = useLocation();
  return <Navigate to={{ pathname: `/governance/${id}`, search }} replace />;
};

// Back-compat: the DB entity dashboard was promoted from /db/company/:eik to the
// canonical /company/:eik (+ sub-pages). Redirect the old links.
const DbCompanyRedirect: FC<{ suffix?: string }> = ({ suffix = "" }) => {
  const { eik } = useParams<{ eik: string }>();
  const { search } = useLocation();
  return (
    <Navigate to={{ pathname: `/company/${eik}${suffix}`, search }} replace />
  );
};

const RouteFallback: FC = () => (
  <div className="flex items-center justify-center min-h-[40vh] w-full" />
);

const LayoutScreen: FC<PropsWithChildren> = ({ children }) => {
  return (
    <Layout>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </Layout>
  );
};

// Layout variant for the governments + indicators route group. Wraps the page
// in CabinetAnchorProvider so the ?cabinet=<id> URL param re-anchors every
// quarterly/annual snapshot via useElectionAsOf / useElectionYear without
// each screen having to opt in. The provider sits ABOVE Layout so the
// persistent header anchor pill (rendered by Header) can read the active
// anchor too — outside this route group useCabinetAnchor() returns null and
// the pill stays hidden.
const CabinetAnchoredLayoutScreen: FC<PropsWithChildren> = ({ children }) => {
  return (
    <CabinetAnchorProvider>
      <Layout>
        <Suspense fallback={<RouteFallback />}>{children}</Suspense>
      </Layout>
    </CabinetAnchorProvider>
  );
};

const ScrollToTop: FC = () => {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const id = hash.slice(1);
      let debounce: ReturnType<typeof setTimeout> | null = null;

      // Debounced scroll: fires 350ms after the last DOM mutation so the
      // layout has settled (sections above the target may expand as data loads).
      const scheduleScroll = () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          const el = document.getElementById(id);
          if (!el) return;
          const navH = document.querySelector("nav")?.offsetHeight ?? 0;
          const top =
            el.getBoundingClientRect().top + window.scrollY - navH - 8;
          window.scrollTo({ top, behavior: "smooth" });
        }, 350);
      };

      if (document.getElementById(id)) {
        scheduleScroll();
      } else {
        // Element not yet in DOM — wait for it, then debounce from there
        const observer = new MutationObserver(scheduleScroll);
        observer.observe(document.body, { childList: true, subtree: true });
        const stopTimer = setTimeout(() => observer.disconnect(), 5000);
        return () => {
          observer.disconnect();
          clearTimeout(stopTimer);
          if (debounce) clearTimeout(debounce);
        };
      }
      return () => {
        if (debounce) clearTimeout(debounce);
      };
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, hash]);
  return null;
};

// When the URL starts with `/en` we mount the router under that prefix so all
// existing routes work unchanged at /en/* — see i18n.ts which mirrors this
// detection to switch the UI language to English at boot.
const isEnglishUrl =
  typeof window !== "undefined" && /^\/en(\/|$)/.test(window.location.pathname);
const ROUTER_BASENAME = isEnglishUrl ? "/en" : "/";

export const AuthRoutes = () => {
  return (
    <BrowserRouter basename={ROUTER_BASENAME}>
      <ScrollToTop />
      {/* AreaAnchorProvider is mounted globally so the persistent header
          pill (rendered by Header) can read the user's chosen "My Area"
          on every route — not only under /my-area. Sits inside BrowserRouter
          because it depends on useSearchParams. */}
      <AreaAnchorProvider>
        <Routes>
          <Route
            index
            element={
              <LayoutScreen>
                <DashboardScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="governance"
            element={
              <LayoutScreen>
                <GovernanceScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="sofia"
            element={
              <LayoutScreen>
                <SofiaScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="sofia/parties"
            element={
              <LayoutScreen>
                <SofiaPartiesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="sofia/preferences"
            element={
              <LayoutScreen>
                <SofiaPreferencesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="sofia/flash-memory"
            element={
              <LayoutScreen>
                <SofiaFlashMemoryScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="sofia/recount"
            element={
              <LayoutScreen>
                <SofiaRecountScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="sofia/companies"
            element={
              <LayoutScreen>
                <SettlementCompaniesScreen sofia />
              </LayoutScreen>
            }
          />
          <Route
            path="about"
            element={
              <LayoutScreen>
                <AboutScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="data"
            element={
              <LayoutScreen>
                <DataMapScreen />
              </LayoutScreen>
            }
          />
          <Route path="data/map" element={<DataMapRedirect />} />
          <Route
            path="data/sources"
            element={
              <LayoutScreen>
                <DataSourcesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="data/updates"
            element={
              <LayoutScreen>
                <DataUpdatesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="prices"
            element={
              <LayoutScreen>
                <PricesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="judiciary"
            element={
              <LayoutScreen>
                <JudiciaryScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="education"
            element={
              <LayoutScreen>
                <EducationScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="school/:id"
            element={
              <LayoutScreen>
                <SchoolScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="data-changes"
            element={<Navigate to="/data/updates" replace />}
          />
          <Route
            path="local/:cycle"
            element={
              <LayoutScreen>
                <LocalElectionScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/regions"
            element={
              <LayoutScreen>
                <LocalAllRegionsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/mayors-by-party"
            element={
              <LayoutScreen>
                <LocalLeaderboardScreen view="mayors-by-party" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/council-votes"
            element={
              <LayoutScreen>
                <LocalLeaderboardScreen view="council-votes" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/strongest-mandates"
            element={
              <LayoutScreen>
                <LocalLeaderboardScreen view="strongest-mandates" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/closest-races"
            element={
              <LayoutScreen>
                <LocalLeaderboardScreen view="closest-races" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/swing"
            element={
              <LayoutScreen>
                <LocalLeaderboardScreen view="swing" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/municipalities"
            element={
              <LayoutScreen>
                <LocalMunicipalityListScreen list="all" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/runoffs"
            element={
              <LayoutScreen>
                <LocalMunicipalityListScreen list="runoffs" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/split-control"
            element={
              <LayoutScreen>
                <LocalMunicipalityListScreen list="split" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/independents"
            element={
              <LayoutScreen>
                <LocalMunicipalityListScreen list="independents" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/region/:oblast"
            element={
              <LayoutScreen>
                <LocalRegionDashboardScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/region/:oblast/mayors-by-party"
            element={
              <LayoutScreen>
                <LocalRegionLeaderboardScreen view="mayors-by-party" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/region/:oblast/council-seats"
            element={
              <LayoutScreen>
                <LocalRegionLeaderboardScreen view="council-seats" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/region/:oblast/municipalities"
            element={
              <LayoutScreen>
                <LocalMunicipalityListScreen list="all" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/region/:oblast/runoffs"
            element={
              <LayoutScreen>
                <LocalMunicipalityListScreen list="runoffs" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/region/:oblast/split-control"
            element={
              <LayoutScreen>
                <LocalMunicipalityListScreen list="split" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/settlement/:ekatte"
            element={
              <LayoutScreen>
                <LocalSettlementDashboardScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/:obshtinaCode/section/:sectionCode"
            element={
              <LayoutScreen>
                <LocalSectionScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/:obshtinaCode/mayor"
            element={
              <LayoutScreen>
                <LocalRaceScreen race="mayor" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/:obshtinaCode/council"
            element={
              <LayoutScreen>
                <LocalRaceScreen race="council" />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/:obshtinaCode/sections"
            element={
              <LayoutScreen>
                <LocalSectionsListScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="local/:cycle/:obshtinaCode"
            element={
              <LayoutScreen>
                <LocalElectionScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="sverka"
            element={
              <LayoutScreen>
                <SverkaScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="local/chmi"
            element={
              <LayoutScreen>
                <ChmiFeedScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="municipality/:id"
            element={
              <LayoutScreen>
                <MunicipalitiesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="municipality/:id/parties"
            element={
              <LayoutScreen>
                <RegionPartiesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="municipality/:id/preferences"
            element={
              <LayoutScreen>
                <RegionPreferencesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="municipality/:id/flash-memory"
            element={
              <LayoutScreen>
                <RegionFlashMemoryScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="municipality/:id/municipalities"
            element={
              <LayoutScreen>
                <RegionMunicipalitiesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="municipality/:id/recount"
            element={
              <LayoutScreen>
                <RegionRecountScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="settlement/:id"
            element={
              <LayoutScreen>
                <SettlementsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="settlement/:id/parties"
            element={
              <LayoutScreen>
                <MunicipalityPartiesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="settlement/:id/preferences"
            element={
              <LayoutScreen>
                <MunicipalityPreferencesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="settlement/:id/flash-memory"
            element={
              <LayoutScreen>
                <MunicipalityFlashMemoryScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="settlement/:id/recount"
            element={
              <LayoutScreen>
                <MunicipalityRecountScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="settlement/:id/settlements"
            element={
              <LayoutScreen>
                <MunicipalitySettlementsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="settlement/:id/companies"
            element={
              <LayoutScreen>
                <SettlementCompaniesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="sections/:id"
            element={
              <LayoutScreen>
                <SectionsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="sections/:id/parties"
            element={
              <LayoutScreen>
                <SettlementPartiesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="sections/:id/preferences"
            element={
              <LayoutScreen>
                <SettlementPreferencesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="sections/:id/flash-memory"
            element={
              <LayoutScreen>
                <SettlementFlashMemoryScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="sections/:id/recount"
            element={
              <LayoutScreen>
                <SettlementRecountScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="sections/:id/list"
            element={
              <LayoutScreen>
                <SettlementSectionsListScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="section/:id"
            element={
              <LayoutScreen>
                <SectionScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="section/:id/parties"
            element={
              <LayoutScreen>
                <SectionPartiesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="section/:id/preferences"
            element={
              <LayoutScreen>
                <SectionPreferencesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="section/:id/flash-memory"
            element={
              <LayoutScreen>
                <SectionFlashMemoryScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="section/:id/recount"
            element={
              <LayoutScreen>
                <SectionRecountScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="financing"
            element={
              <LayoutScreen>
                <PartiesFinancing />
              </LayoutScreen>
            }
          />
          <Route
            path="financing/annual-reports"
            element={
              <LayoutScreen>
                <PartyAnnualReportsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="financing/annual-reports/:slug"
            element={
              <LayoutScreen>
                <PartyAnnualReportScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="party/:id"
            element={
              <LayoutScreen>
                <PartyScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="party/:id/regions"
            element={
              <LayoutScreen>
                <PartyRegionsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="party/:id/municipalities"
            element={
              <LayoutScreen>
                <PartyMunicipalitiesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="party/:id/settlements"
            element={
              <LayoutScreen>
                <PartySettlementsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="party/:id/preferences"
            element={
              <LayoutScreen>
                <PartyPreferencesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="party/:id/donors"
            element={
              <LayoutScreen>
                <PartyDonorsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="party/:id/donors/list"
            element={
              <LayoutScreen>
                <PartyDonorsListScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="party/:id/income"
            element={
              <LayoutScreen>
                <PartyIncomeScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="party/:id/expenses"
            element={
              <LayoutScreen>
                <PartyExpensesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="candidate/:id"
            element={
              <LayoutScreen>
                <CandidateScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="candidate/:id/regions"
            element={
              <LayoutScreen>
                <CandidateRegionsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="candidate/:id/municipalities"
            element={
              <LayoutScreen>
                <CandidateMunicipalitiesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="candidate/:id/settlements"
            element={
              <LayoutScreen>
                <CandidateSettlementsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="candidate/:id/sections"
            element={
              <LayoutScreen>
                <CandidateSectionsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="candidate/:id/donations"
            element={
              <LayoutScreen>
                <CandidateDonationsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="candidate/:id/connections"
            element={
              <LayoutScreen>
                <CandidateConnectionsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="candidate/:id/assets"
            element={
              <LayoutScreen>
                <CandidateAssetsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="candidate/:id/procurement"
            element={
              <LayoutScreen>
                <CandidateProcurementScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="procurement"
            element={
              <LayoutScreen>
                <ProcurementScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="subsidies"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <SubsidiesDashboardScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="subsidies/browse"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <SubsidiesBrowserDbScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="farm/:eik"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <FarmDetailScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="procurement/tenders"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <TendersBrowserDbScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="procurement/appeals"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <AppealsBrowserDbScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="tenders/:unp"
            element={
              <LayoutScreen>
                <TenderDetailScreen />
              </LayoutScreen>
            }
          />
          {/* АПИ road-spending dashboard — retired into the generic awarder
              page, where it renders as the roads sector pack (map, construction
              categories, cost/km …) below the buy-side KPIs. Redirect keeps old
              links + the nav pill working. See components/procurement/roads/
              RoadsPack + sectorPacks. */}
          <Route
            path="procurement/roads"
            element={<Navigate to={ROADS_AWARDER_PATH} replace />}
          />
          <Route
            path="procurement/flags"
            element={
              <LayoutScreen>
                <ProcurementFlagsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="procurement/watchlist"
            element={
              <LayoutScreen>
                <ProcurementWatchlistScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="procurement/by-settlement"
            element={
              <LayoutScreen>
                <ProcurementBySettlementScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="procurement/contracts"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <ContractsBrowserDbScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="procurement/ngos"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <NgoBrowseDbScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="procurement/settlement/:ekatte"
            element={
              <LayoutScreen>
                <ProcurementSettlementDetailScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="candidate/:id/funds"
            element={
              <LayoutScreen>
                <CandidateFundsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="funds"
            element={
              <LayoutScreen>
                <FundsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="funds/political"
            element={
              <LayoutScreen>
                <FundsPoliticalScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="funds/integrity"
            element={
              <LayoutScreen>
                <FundsIntegrityScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="funds/focus/:slug"
            element={
              <LayoutScreen>
                <FundsFocusScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="funds/rrf"
            element={
              <LayoutScreen>
                <FundsRrfScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="funds/programme/:code"
            element={
              <LayoutScreen>
                <FundsProgramScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="funds/contract/:number"
            element={
              <LayoutScreen>
                <FundsContractScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="procurement/contractors"
            element={
              <LayoutScreen>
                <TopContractorsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="procurement/awarders"
            element={
              <LayoutScreen>
                <TopAwardersScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="procurement/mps"
            element={
              <LayoutScreen>
                <TopMpsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="procurement/sectors"
            element={
              <LayoutScreen>
                <ProcurementSectorsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="procurement/contract/:id"
            element={
              <LayoutScreen>
                <ContractDetailScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="company/:eik"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <CompanyDbScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="company/:eik/contracts"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <CompanyContractsDbScreen tag="contract" />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="company/:eik/annexes"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <CompanyContractsDbScreen tag="contractAmendment" />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="company/:eik/funds"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <CompanyFundsDbScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="company/:eik/officers"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <CompanyOfficersDbScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="company/:eik/awarders"
            element={
              <LayoutScreen>
                <CompanyAwardersScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="awarder/:eik"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <CompanyDbScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="awarder/:eik/contracts"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <CompanyContractsDbScreen tag="contract" side="awarder" />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="awarder/:eik/contractors"
            element={
              <LayoutScreen>
                <AwarderContractorsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="budget"
            element={
              <LayoutScreen>
                <BudgetScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="budget/methodology"
            element={
              <LayoutScreen>
                <BudgetMethodologyScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="budget/tax-calculator"
            element={
              <LayoutScreen>
                <BudgetTaxCalculatorScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="budget/simulator"
            element={
              <LayoutScreen>
                <BudgetPolicySimulatorScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="budget/ministry/:id"
            element={
              <LayoutScreen>
                <BudgetMinistryScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="votes"
            element={
              <LayoutScreen>
                <SessionsIndexScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="votes/:date"
            element={
              <LayoutScreen>
                <SessionScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="votes/:date/:slug"
            element={
              <LayoutScreen>
                <SessionScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="votes/between/:pair"
            element={
              <LayoutScreen>
                <PartyPairBreaksScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="parliament/cohesion"
            element={
              <LayoutScreen>
                <ParliamentCohesionScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="parliament/attendance"
            element={
              <LayoutScreen>
                <ParliamentAttendanceScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="parliament/similarity/:mpId"
            element={
              <LayoutScreen>
                <MpSimilarityScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="parliament/embedding"
            element={
              <LayoutScreen>
                <ParliamentEmbeddingScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="parliament"
            element={
              <LayoutScreen>
                <ParliamentHubScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="mp/companies"
            element={
              <LayoutScreen>
                <AllMpCompaniesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="mp-assets"
            element={
              <LayoutScreen>
                <AllMpAssetsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="officials/assets"
            element={
              <LayoutScreen>
                <OfficialsAssetsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="officials/:slug"
            element={
              <LayoutScreen>
                <OfficialProfileScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="mp-cars"
            element={
              <LayoutScreen>
                <MpCarsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="mp/company/:slug"
            element={
              <LayoutScreen>
                <MpCompanyScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="connections"
            element={
              <LayoutScreen>
                <ConnectionsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="simulator"
            element={
              <LayoutScreen>
                <SimulatorScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="wasted-vote"
            element={
              <LayoutScreen>
                <WastedVoteScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="wasted-vote/regions"
            element={
              <LayoutScreen>
                <WastedVoteRegionsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="persistence"
            element={
              <LayoutScreen>
                <PersistenceScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="benford"
            element={
              <LayoutScreen>
                <BenfordScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="benford/methodology"
            element={
              <LayoutScreen>
                <BenfordMethodologyScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="benford/:partyNum"
            element={
              <LayoutScreen>
                <BenfordDetailScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="risk-analysis"
            element={
              <LayoutScreen>
                <RiskAnalysisScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="risk-analysis/methodology"
            element={
              <LayoutScreen>
                <RiskAnalysisMethodologyScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="risk-analysis/cluster/:id"
            element={
              <LayoutScreen>
                <RiskClusterScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="risk-score"
            element={
              <LayoutScreen>
                <RiskScoreScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="risk-score/methodology"
            element={
              <LayoutScreen>
                <RiskScoreMethodologyScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="governments"
            element={
              <CabinetAnchoredLayoutScreen>
                <GovernmentsScreen />
              </CabinetAnchoredLayoutScreen>
            }
          />
          <Route
            path="governments/:slug"
            element={
              <CabinetAnchoredLayoutScreen>
                <GovernmentDetailScreen />
              </CabinetAnchoredLayoutScreen>
            }
          />
          <Route
            path="indicators"
            element={
              <CabinetAnchoredLayoutScreen>
                <IndicatorsLandingScreen />
              </CabinetAnchoredLayoutScreen>
            }
          />
          <Route
            path="indicators/economy"
            element={
              <CabinetAnchoredLayoutScreen>
                <IndicatorsEconomyScreen />
              </CabinetAnchoredLayoutScreen>
            }
          />
          <Route
            path="indicators/fiscal"
            element={
              <CabinetAnchoredLayoutScreen>
                <IndicatorsFiscalScreen />
              </CabinetAnchoredLayoutScreen>
            }
          />
          <Route
            path="indicators/budgets"
            element={
              <CabinetAnchoredLayoutScreen>
                <IndicatorsCabinetBudgetsScreen />
              </CabinetAnchoredLayoutScreen>
            }
          />
          <Route
            path="indicators/governance"
            element={
              <CabinetAnchoredLayoutScreen>
                <IndicatorsGovernanceScreen />
              </CabinetAnchoredLayoutScreen>
            }
          />
          <Route
            path="indicators/society"
            element={
              <CabinetAnchoredLayoutScreen>
                <IndicatorsSocietyScreen />
              </CabinetAnchoredLayoutScreen>
            }
          />
          <Route
            path="indicators/compare"
            element={
              <CabinetAnchoredLayoutScreen>
                <IndicatorsCompareScreen />
              </CabinetAnchoredLayoutScreen>
            }
          />
          <Route
            path="observations"
            element={
              <LayoutScreen>
                <ObservationsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="demographics"
            element={
              <LayoutScreen>
                <DemographicsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="demographics/regions"
            element={
              <LayoutScreen>
                <RegionsDemographicsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="demographics/municipalities"
            element={
              <LayoutScreen>
                <MunicipalitiesDemographicsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="compare"
            element={
              <LayoutScreen>
                <CompareScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="where-did-votes-go/methodology"
            element={
              <LayoutScreen>
                <VoteFlowMethodologyScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="parties"
            element={
              <LayoutScreen>
                <AllPartiesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="preferences"
            element={
              <LayoutScreen>
                <AllPreferencesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="flash-memory"
            element={
              <LayoutScreen>
                <AllFlashMemoryScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="recount"
            element={
              <LayoutScreen>
                <AllRecountScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="regions"
            element={
              <LayoutScreen>
                <AllRegionsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="polls"
            element={
              <LayoutScreen>
                <PollsScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="polls/:agencyId"
            element={
              <LayoutScreen>
                <PollsAgencyScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="elections/:date"
            element={
              <LayoutScreen>
                <ElectionScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="articles"
            element={
              <LayoutScreen>
                <ArticlesScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="articles/:slug"
            element={
              <LayoutScreen>
                <ArticleScreen />
              </LayoutScreen>
            }
          />

          <Route path="reports">
            <Route path="settlement">
              <Route
                path="wasted-votes"
                element={
                  <LayoutScreen>
                    <SettlementsWastedVote />
                  </LayoutScreen>
                }
              />
              <Route
                path="concentrated"
                element={
                  <LayoutScreen>
                    <SettlementsConcentration />
                  </LayoutScreen>
                }
              />
              <Route
                path="top_gainers"
                element={
                  <LayoutScreen>
                    <SettlementsTopGainers />
                  </LayoutScreen>
                }
              />
              <Route
                path="top_losers"
                element={
                  <LayoutScreen>
                    <SettlementsTopLosers />
                  </LayoutScreen>
                }
              />
              <Route
                path="turnout"
                element={
                  <LayoutScreen>
                    <SettlementsTurnout />
                  </LayoutScreen>
                }
              />
              <Route
                path="invalid_ballots"
                element={
                  <LayoutScreen>
                    <SettlementsInvalidBallots />
                  </LayoutScreen>
                }
              />
              <Route
                path="additional_voters"
                element={
                  <LayoutScreen>
                    <SettlementsAdditionalVoters />
                  </LayoutScreen>
                }
              />
              <Route
                path="supports_no_one"
                element={
                  <LayoutScreen>
                    <SettlementsSupportsNoOne />
                  </LayoutScreen>
                }
              />
              <Route
                path="recount"
                element={
                  <LayoutScreen>
                    <SettlementsRecount />
                  </LayoutScreen>
                }
              />
              <Route
                path="flash_memory"
                element={
                  <LayoutScreen>
                    <SettlementsSuemg />
                  </LayoutScreen>
                }
              />
              <Route
                path="flash_memory_added"
                element={
                  <LayoutScreen>
                    <SettlementsSuemgAdded />
                  </LayoutScreen>
                }
              />
              <Route
                path="flash_memory_removed"
                element={
                  <LayoutScreen>
                    <SettlementsSuemgRemoved />
                  </LayoutScreen>
                }
              />
              <Route
                path="missing_flash_memory"
                element={
                  <LayoutScreen>
                    <SettlementsMissingSuemg />
                  </LayoutScreen>
                }
              />
            </Route>
            <Route path="municipality">
              <Route
                path="wasted-votes"
                element={
                  <LayoutScreen>
                    <MunicipalitiesWastedVote />
                  </LayoutScreen>
                }
              />
              <Route
                path="concentrated"
                element={
                  <LayoutScreen>
                    <MunicipalitiesConcentration />
                  </LayoutScreen>
                }
              />
              <Route
                path="top_gainers"
                element={
                  <LayoutScreen>
                    <MunicipalitiesTopGainers />
                  </LayoutScreen>
                }
              />
              <Route
                path="top_losers"
                element={
                  <LayoutScreen>
                    <MunicipalitiesTopLosers />
                  </LayoutScreen>
                }
              />
              <Route
                path="turnout"
                element={
                  <LayoutScreen>
                    <MunicipalitiesTurnout />
                  </LayoutScreen>
                }
              />
              <Route
                path="invalid_ballots"
                element={
                  <LayoutScreen>
                    <MunicipalitiesInvalidBallots />
                  </LayoutScreen>
                }
              />
              <Route
                path="additional_voters"
                element={
                  <LayoutScreen>
                    <MunicipalitiesAdditionalVoters />
                  </LayoutScreen>
                }
              />
              <Route
                path="supports_no_one"
                element={
                  <LayoutScreen>
                    <MunicipalitiesSupportsNoOne />
                  </LayoutScreen>
                }
              />
              <Route
                path="recount"
                element={
                  <LayoutScreen>
                    <MunicipalitiesRecount />
                  </LayoutScreen>
                }
              />
              <Route
                path="flash_memory"
                element={
                  <LayoutScreen>
                    <MunicipalitiesSuemg />
                  </LayoutScreen>
                }
              />
              <Route
                path="flash_memory_added"
                element={
                  <LayoutScreen>
                    <MunicipalitiesSuemgAdded />
                  </LayoutScreen>
                }
              />
              <Route
                path="flash_memory_removed"
                element={
                  <LayoutScreen>
                    <MunicipalitiesSuemgRemoved />
                  </LayoutScreen>
                }
              />
              <Route
                path="missing_flash_memory"
                element={
                  <LayoutScreen>
                    <MunicipalitiesMissingSuemg />
                  </LayoutScreen>
                }
              />
            </Route>
            <Route path="section">
              <Route
                path="wasted-votes"
                element={
                  <LayoutScreen>
                    <SectionsWastedVote />
                  </LayoutScreen>
                }
              />
              <Route
                path="concentrated"
                element={
                  <LayoutScreen>
                    <SectionsConcentration />
                  </LayoutScreen>
                }
              />
              <Route
                path="top_gainers"
                element={
                  <LayoutScreen>
                    <SectionsTopGainers />
                  </LayoutScreen>
                }
              />
              <Route
                path="top_losers"
                element={
                  <LayoutScreen>
                    <SectionsTopLosers />
                  </LayoutScreen>
                }
              />
              <Route
                path="turnout"
                element={
                  <LayoutScreen>
                    <SectionsTurnout />
                  </LayoutScreen>
                }
              />
              <Route
                path="invalid_ballots"
                element={
                  <LayoutScreen>
                    <SectionsInvalidBallots />
                  </LayoutScreen>
                }
              />
              <Route
                path="additional_voters"
                element={
                  <LayoutScreen>
                    <SectionsAdditionalVoters />
                  </LayoutScreen>
                }
              />
              <Route
                path="supports_no_one"
                element={
                  <LayoutScreen>
                    <SectionsSupportsNoOne />
                  </LayoutScreen>
                }
              />
              <Route
                path="recount"
                element={
                  <LayoutScreen>
                    <SectionsRecount />
                  </LayoutScreen>
                }
              />
              <Route
                path="recount_zero_votes"
                element={
                  <LayoutScreen>
                    <SectionsRecountZeroVotes />
                  </LayoutScreen>
                }
              />
              <Route
                path="flash_memory"
                element={
                  <LayoutScreen>
                    <SectionsSuemg />
                  </LayoutScreen>
                }
              />
              <Route
                path="flash_memory_added"
                element={
                  <LayoutScreen>
                    <SectionsSuemgAdded />
                  </LayoutScreen>
                }
              />
              <Route
                path="flash_memory_removed"
                element={
                  <LayoutScreen>
                    <SectionsSuemgRemoved />
                  </LayoutScreen>
                }
              />
              <Route
                path="missing_flash_memory"
                element={
                  <LayoutScreen>
                    <SectionsMissingSuemg />
                  </LayoutScreen>
                }
              />
              <Route
                path="problem_sections"
                element={
                  <LayoutScreen>
                    <ProblemSections />
                  </LayoutScreen>
                }
              />
              <Route
                path="problem_sections/:id"
                element={
                  <LayoutScreen>
                    <ProblemSectionDetail />
                  </LayoutScreen>
                }
              />
              <Route
                path="problem_sections/:id/list"
                element={
                  <LayoutScreen>
                    <ProblemSectionListScreen />
                  </LayoutScreen>
                }
              />
              <Route
                path="problem_sections/:id/parties"
                element={
                  <LayoutScreen>
                    <ProblemSectionPartiesScreen />
                  </LayoutScreen>
                }
              />
              <Route
                path="problem_sections/:id/flash-memory"
                element={
                  <LayoutScreen>
                    <ProblemSectionFlashMemoryScreen />
                  </LayoutScreen>
                }
              />
              <Route
                path="problem_sections/:id/recount"
                element={
                  <LayoutScreen>
                    <ProblemSectionRecountScreen />
                  </LayoutScreen>
                }
              />
            </Route>
          </Route>
          {/* /my-area is the possessive geolocate ENTRY funnel — it resolves a
              user into /governance/:id (the place node of the Governance view). */}
          <Route
            path="my-area"
            element={
              <LayoutScreen>
                <MyAreaEntryScreen />
              </LayoutScreen>
            }
          />
          <Route path="my-area/:id" element={<MyAreaIdRedirect />} />
          {/* Region (oblast) node of the Governance view — the regional money +
              representation picture, minus the elected-local-government block. */}
          <Route
            path="governance/region/:oblast"
            element={
              <LayoutScreen>
                <RegionGovernanceScreen />
              </LayoutScreen>
            }
          />
          {/* Município / settlement node — the renamed My-Area dashboard. */}
          <Route
            path="governance/:id"
            element={
              <LayoutScreen>
                <MyAreaScreen />
              </LayoutScreen>
            }
          />
          {/* Consumption (Потребление) view — the cost-of-living dashboard at
              every place tier (country / region / município / settlement),
              mirroring the Governance route family. Built on the КЗП "Колко
              струва" basket data already shipped. */}
          <Route
            path="consumption"
            element={
              <LayoutScreen>
                <ConsumptionScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="consumption/region/:oblast"
            element={
              <LayoutScreen>
                <RegionConsumptionScreen />
              </LayoutScreen>
            }
          />
          {/* Static segment must precede consumption/:id so "products" is not
              swallowed by the settlement resolver. */}
          <Route
            path="consumption/products"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <ProductsBrowserScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="consumption/:id"
            element={
              <LayoutScreen>
                <ConsumptionPlaceScreen />
              </LayoutScreen>
            }
          />
          <Route
            path="product/:slug"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <ProductScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="db"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <SqlBrowserScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          <Route
            path="person/:name"
            element={
              <LayoutScreen>
                <Suspense fallback={<RouteFallback />}>
                  <PersonScreen />
                </Suspense>
              </LayoutScreen>
            }
          />
          {/* Canonicalised to /company/:eik (+ sub-pages) — redirect old links. */}
          <Route path="db/company/:eik" element={<DbCompanyRedirect />} />
          <Route
            path="db/company/:eik/contracts"
            element={<DbCompanyRedirect suffix="/contracts" />}
          />
          <Route
            path="db/company/:eik/annexes"
            element={<DbCompanyRedirect suffix="/annexes" />}
          />
          <Route
            path="db/company/:eik/funds"
            element={<DbCompanyRedirect suffix="/funds" />}
          />
          <Route
            path="db/company/:eik/officers"
            element={<DbCompanyRedirect suffix="/officers" />}
          />
          <Route
            path="*"
            element={
              <LayoutScreen>
                <NotFound />
              </LayoutScreen>
            }
          />
        </Routes>
      </AreaAnchorProvider>
    </BrowserRouter>
  );
};
