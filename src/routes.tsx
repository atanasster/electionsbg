import { FC, PropsWithChildren } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { RegionsScreen } from "@/screens/RegionsScreen";
import { MunicipalitiesScreen } from "@/screens/MunicipalitiesScreen";
import { SettlementsScreen } from "@/screens/SettlementsScreen";
import { NotFound } from "@/screens/NotFound";
import { Layout } from "./layout/Layout";
import { SectionsScreen } from "./screens/SectionsScreen";
import { SectionScreen } from "./screens/SectionScreen";
import { AboutScreen } from "./screens/AboutScreen";
import { MunicipalitiesTurnout } from "./screens/reports/municipalities/MunicipalitiesTurnout";
import { MunicipalitiesConcentration } from "./screens/reports/municipalities/MunicipalitiesConcentration";
import { MunicipalitiesAdditionalVoters } from "./screens/reports/municipalities/MunicipalitiesAdditionalVoters";
import { MunicipalitiesInvalidBallots } from "./screens/reports/municipalities/MunicipalitiesInvalidBallots";
import { MunicipalitiesSupportsNoOne } from "./screens/reports/municipalities/MunicipalitiesSupportsNoOne";
import { SettlementsConcentration } from "./screens/reports/settlements/SettlementsConcentration";
import { SettlementsTurnout } from "./screens/reports/settlements/SettlementsTurnout";
import { SettlementsAdditionalVoters } from "./screens/reports/settlements/SettlementsAdditionalVoters";
import { SettlementsInvalidBallots } from "./screens/reports/settlements/SettlementsInvalidBallots";
import { SettlementsSupportsNoOne } from "./screens/reports/settlements/SettlementsSupportsNoOne";
import { SectionsAdditionalVoters } from "./screens/reports/sections/SectionsAdditionalVoters";
import { SectionsConcentration } from "./screens/reports/sections/SectionsConcentration";
import { SectionsInvalidBallots } from "./screens/reports/sections/SectionsInvalidBallots";
import { SectionsSupportsNoOne } from "./screens/reports/sections/SectionsSupportsNoOne";
import { SectionsTurnout } from "./screens/reports/sections/SectionsTurnout";
import { MunicipalitiesTopGainers } from "./screens/reports/municipalities/MunicipalitiesTopGainers";
import { SettlementsTopGainers } from "./screens/reports/settlements/SettlementsTopGainers";
import { SectionsTopGainers } from "./screens/reports/sections/SectionsTopGainers";
import { MunicipalitiesTopLosers } from "./screens/reports/municipalities/MunicipalitiesTopLosers";
import { SectionsTopLosers } from "./screens/reports/sections/SectionsTopLosers";
import { SettlementsTopLosers } from "./screens/reports/settlements/SettlementsTopLosers";
import { SofiaScreen } from "./screens/SofiaScreen";
import { PartiesFinancing } from "./screens/PartiesFinancing";
import { PartyScreen } from "./screens/PartyScreen";
import { CandidateScreen } from "./screens/CandidateScreen";
import { SettlementsRecount } from "./screens/reports/settlements/SettlementsRecount";
import { MunicipalitiesRecount } from "./screens/reports/municipalities/MunicipalitiesRecount";
import { SectionsRecount } from "./screens/reports/sections/SectionsRecount";
import { SectionsRecountZeroVotes } from "./screens/reports/sections/SectionsRecountZeroVotes";

const LayoutScreen: FC<PropsWithChildren> = ({ children }) => {
  return <Layout>{children}</Layout>;
};

export const AuthRoutes = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          index
          element={
            <LayoutScreen>
              <RegionsScreen />
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
