import { FC, lazy, PropsWithChildren, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./layout/Layout";

// Eagerly load the home screen so the landing page has no Suspense flash.
import { DashboardScreen } from "@/screens/DashboardScreen";

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
const SectionTimelineScreen = lazy(() =>
  import("./screens/SectionTimelineScreen").then((m) => ({
    default: m.SectionTimelineScreen,
  })),
);
const AboutScreen = lazy(() =>
  import("./screens/AboutScreen").then((m) => ({ default: m.AboutScreen })),
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
const SofiaTimelineScreen = lazy(() =>
  import("./screens/SofiaTimelineScreen").then((m) => ({
    default: m.SofiaTimelineScreen,
  })),
);
const PartiesFinancing = lazy(() =>
  import("./screens/PartiesFinancing").then((m) => ({
    default: m.PartiesFinancing,
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
const CompareScreen = lazy(() =>
  import("./screens/CompareScreen").then((m) => ({
    default: m.CompareScreen,
  })),
);
const PartyTimelineScreen = lazy(() =>
  import("./screens/PartyTimelineScreen").then((m) => ({
    default: m.PartyTimelineScreen,
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
const RegionTimelineScreen = lazy(() =>
  import("./screens/RegionTimelineScreen").then((m) => ({
    default: m.RegionTimelineScreen,
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
const MunicipalitySettlementsScreen = lazy(() =>
  import("./screens/MunicipalitySettlementsScreen").then((m) => ({
    default: m.MunicipalitySettlementsScreen,
  })),
);
const MunicipalityTimelineScreen = lazy(() =>
  import("./screens/MunicipalityTimelineScreen").then((m) => ({
    default: m.MunicipalityTimelineScreen,
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
const SettlementTimelineScreen = lazy(() =>
  import("./screens/SettlementTimelineScreen").then((m) => ({
    default: m.SettlementTimelineScreen,
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
const ProblemSectionTimelineScreen = lazy(() =>
  import("./screens/reports/sections/ProblemSectionTimelineScreen").then(
    (m) => ({ default: m.ProblemSectionTimelineScreen }),
  ),
);

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

const ScrollToTop: FC = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);
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
          path="sofia/timeline"
          element={
            <LayoutScreen>
              <SofiaTimelineScreen />
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
          path="municipality/:id/timeline"
          element={
            <LayoutScreen>
              <RegionTimelineScreen />
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
          path="settlement/:id/timeline"
          element={
            <LayoutScreen>
              <MunicipalityTimelineScreen />
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
          path="sections/:id/timeline"
          element={
            <LayoutScreen>
              <SettlementTimelineScreen />
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
          path="section/:id/timeline"
          element={
            <LayoutScreen>
              <SectionTimelineScreen />
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
          path="compare"
          element={
            <LayoutScreen>
              <CompareScreen />
            </LayoutScreen>
          }
        />
        <Route
          path="timeline"
          element={
            <LayoutScreen>
              <PartyTimelineScreen />
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
            <Route
              path="problem_sections/:id/timeline"
              element={
                <LayoutScreen>
                  <ProblemSectionTimelineScreen />
                </LayoutScreen>
              }
            />
          </Route>
        </Route>
        <Route
          path="*"
          element={
            <LayoutScreen>
              <NotFound />
            </LayoutScreen>
          }
        />
      </Routes>
    </BrowserRouter>
  );
};
