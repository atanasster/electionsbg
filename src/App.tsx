// i18n is initialized in main.tsx, which awaits initI18n() before rendering —
// the active language's translation bundle is a dynamic import now, so a
// side-effect import here would let the first render run without resources.
import { useEffect } from "react";

import "./App.css";
import { AuthRoutes } from "@/routes";
import { installAnalytics } from "@/lib/analytics";

export const App = () => {
  // Cookieless, first-party analytics — loads after idle, never in DEV or under
  // automation. See src/lib/analytics.ts for why this needs no consent banner.
  useEffect(installAnalytics, []);
  return <AuthRoutes />;
};
