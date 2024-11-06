import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Dashboard } from "@/screens/Dashboard";
import { NotFound } from "@/screens/NotFound";
import { Layout } from "./layout/Layout";
import { FC, PropsWithChildren } from "react";

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
              <Dashboard />
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
