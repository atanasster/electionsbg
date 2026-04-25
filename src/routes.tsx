import { FC, lazy, PropsWithChildren, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
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
const AboutScreen = lazy(() =>
  import("./screens/AboutScreen").then((m) => ({ default: m.AboutScreen })),
);
const SofiaScreen = lazy(() =>
  import("./screens/SofiaScreen").then((m) => ({ default: m.SofiaScreen })),
);
const PartiesFinancing = lazy(() =>
  import("./screens/PartiesFinancing").then((m) => ({
    default: m.PartiesFinancing,
  })),
);
const PartyScreen = lazy(() =>
  import("./screens/PartyScreen").then((m) => ({ default: m.PartyScreen })),
);
const CandidateScreen = lazy(() =>
  import("./screens/CandidateScreen").then((m) => ({
    default: m.CandidateScreen,
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

export const AuthRoutes = () => {
  return (
    <BrowserRouter>
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
          path="settlement/:id"
          element={
            <LayoutScreen>
              <SettlementsScreen />
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
          path="section/:id"
          element={
            <LayoutScreen>
              <SectionScreen />
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
          path="candidate/:id"
          element={
            <LayoutScreen>
              <CandidateScreen />
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
