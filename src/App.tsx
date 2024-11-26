import "./i18n.ts"; // imports + initializes i18n
import ReactGA from "react-ga4";

import "./App.css";
import { AuthRoutes } from "@/routes";

export const App = () => {
  ReactGA.initialize("G-NWEG367BN9");
  return <AuthRoutes />;
};
