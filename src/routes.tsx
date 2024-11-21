import { FC, PropsWithChildren } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { RegionsScreen } from "@/screens/Regions";
import { MunicipalitiesScreen } from "@/screens/Municipalities";
import { SettlementsScreen } from "@/screens/Settlements";

import { NotFound } from "@/screens/NotFound";
import { Layout } from "./layout/Layout";
import { SectionsScreen } from "./screens/Sections";
import { SettlementsConcentrationReport } from "./screens/reports/settlements/SettlementsConcentrationReport";
import { SettlementsTurnoutReport } from "./screens/reports/settlements/SettlementsTurnoutReport";
import { SettlementsInvalidBallotsReport } from "./screens/reports/settlements/SettlementsInvalidBallotsReport";
import { SettlementsAdditionalVotersReport } from "./screens/reports/settlements/SettlementsAdditionalVotersReport";
import { SettlementsSupportsNoOneReport } from "./screens/reports/settlements/SettlementsSupportsNoOneReport";
import { MunicipalitiesConcentrationReport } from "./screens/reports/municipalities/MunicipalitiesConcentrationReport";
import { MunicipalitiesTurnoutReport } from "./screens/reports/municipalities/MunicipalitiesTurnoutReport";
import { MunicipalitiesInvalidBallotsReport } from "./screens/reports/municipalities/MunicipalitiesInvalidBallotsReport";
import { MunicipalitiesAdditionalVotersReport } from "./screens/reports/municipalities/MunicipalitiesAdditionalVotersReport";
import { MunicipalitiesSupportsNoOneReport } from "./screens/reports/municipalities/MunicipalitiesSupportsNoOneReport";
import { SectionsConcentrationReport } from "./screens/reports/sections/SectionsConcentrationReport";
import { SectionsTurnoutReport } from "./screens/reports/sections/SectionsTurnoutReport";
import { SectionsInvalidBallotsReport } from "./screens/reports/sections/SectionsInvalidBallotsReport";
import { SectionsAdditionalVotersReport } from "./screens/reports/sections/SectionsAdditionalVotersReport";
import { SectionsSupportsNoOneReport } from "./screens/reports/sections/SectionsSupportsNoOneReport";
import { SectionScreen } from "./screens/Section";

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
          path="municipality"
          element={
            <LayoutScreen>
              <MunicipalitiesScreen />
            </LayoutScreen>
          }
        />
        <Route
          path="settlement"
          element={
            <LayoutScreen>
              <SettlementsScreen />
            </LayoutScreen>
          }
        />
        <Route
          path="sections"
          element={
            <LayoutScreen>
              <SectionsScreen />
            </LayoutScreen>
          }
        />
        <Route
          path="section"
          element={
            <LayoutScreen>
              <SectionScreen />
            </LayoutScreen>
          }
        />
        <Route path="reports">
          <Route path="settlement">
            <Route
              path="concentrated"
              element={
                <LayoutScreen>
                  <SettlementsConcentrationReport />
                </LayoutScreen>
              }
            />
            <Route
              path="turnout"
              element={
                <LayoutScreen>
                  <SettlementsTurnoutReport />
                </LayoutScreen>
              }
            />
            <Route
              path="invalid_ballots"
              element={
                <LayoutScreen>
                  <SettlementsInvalidBallotsReport />
                </LayoutScreen>
              }
            />
            <Route
              path="additional_voters"
              element={
                <LayoutScreen>
                  <SettlementsAdditionalVotersReport />
                </LayoutScreen>
              }
            />
            <Route
              path="supports_no_one"
              element={
                <LayoutScreen>
                  <SettlementsSupportsNoOneReport />
                </LayoutScreen>
              }
            />
          </Route>
          <Route path="municipality">
            <Route
              path="concentrated"
              element={
                <LayoutScreen>
                  <MunicipalitiesConcentrationReport />
                </LayoutScreen>
              }
            />
            <Route
              path="turnout"
              element={
                <LayoutScreen>
                  <MunicipalitiesTurnoutReport />
                </LayoutScreen>
              }
            />
            <Route
              path="invalid_ballots"
              element={
                <LayoutScreen>
                  <MunicipalitiesInvalidBallotsReport />
                </LayoutScreen>
              }
            />
            <Route
              path="additional_voters"
              element={
                <LayoutScreen>
                  <MunicipalitiesAdditionalVotersReport />
                </LayoutScreen>
              }
            />
            <Route
              path="supports_no_one"
              element={
                <LayoutScreen>
                  <MunicipalitiesSupportsNoOneReport />
                </LayoutScreen>
              }
            />
          </Route>
          <Route path="section">
            <Route
              path="concentrated"
              element={
                <LayoutScreen>
                  <SectionsConcentrationReport />
                </LayoutScreen>
              }
            />
            <Route
              path="turnout"
              element={
                <LayoutScreen>
                  <SectionsTurnoutReport />
                </LayoutScreen>
              }
            />
            <Route
              path="invalid_ballots"
              element={
                <LayoutScreen>
                  <SectionsInvalidBallotsReport />
                </LayoutScreen>
              }
            />
            <Route
              path="additional_voters"
              element={
                <LayoutScreen>
                  <SectionsAdditionalVotersReport />
                </LayoutScreen>
              }
            />
            <Route
              path="supports_no_one"
              element={
                <LayoutScreen>
                  <SectionsSupportsNoOneReport />
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
