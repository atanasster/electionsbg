import { FC, PropsWithChildren } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { RegionsScreen } from "@/screens/Regions";
import { MunicipalitiesScreen } from "@/screens/Municipalities";
import { SettlementsScreen } from "@/screens/Settlements";

import { NotFound } from "@/screens/NotFound";
import { Layout } from "./layout/Layout";

const AuthorizedRoute: FC<PropsWithChildren> = ({ children }) => {
  return <Layout>{children}</Layout>;
};

export const AuthRoutes = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          index
          element={
            <AuthorizedRoute>
              <RegionsScreen />
            </AuthorizedRoute>
          }
        />
        <Route
          path="municipality"
          element={
            <AuthorizedRoute>
              <MunicipalitiesScreen />
            </AuthorizedRoute>
          }
        />
        <Route
          path="settlement"
          element={
            <AuthorizedRoute>
              <SettlementsScreen />
            </AuthorizedRoute>
          }
        />
        <Route
          path="*"
          element={
            <Layout>
              <NotFound />
            </Layout>
          }
        />
      </Routes>
    </BrowserRouter>
  );
};
