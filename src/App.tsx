import "./i18n.ts"; // imports + initializes i18n
import { useEffect } from "react";

import "./App.css";
import { AuthRoutes } from "@/routes";

let gaInitialized = false;
const initAnalytics = () => {
  if (gaInitialized) return;
  gaInitialized = true;
  import("react-ga4").then(({ default: ReactGA }) => {
    ReactGA.initialize("G-NWEG367BN9");
  });
};

export const App = () => {
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
    };
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(initAnalytics);
    } else {
      setTimeout(initAnalytics, 2000);
    }
  }, []);
  return <AuthRoutes />;
};
