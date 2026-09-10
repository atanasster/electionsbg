// i18n is initialized in main.tsx, which awaits initI18n() before rendering —
// the active language's translation bundle is a dynamic import now, so a
// side-effect import here would let the first render run without resources.
import { useEffect } from "react";

import "./App.css";
import { AuthRoutes } from "@/routes";
import { GA_ID, installChatAnalyticsPrivacy } from "@/lib/chatAnalyticsPrivacy";

if (typeof window !== "undefined") installChatAnalyticsPrivacy();

let gaInitialized = false;
const initAnalytics = () => {
  if (gaInitialized) return;
  // Skip GA for automated browsers (Playwright, Selenium, headless crawlers).
  // navigator.webdriver is set to true by every WebDriver-controlled browser,
  // so this also blocks future automation tools without per-tool plumbing.
  if (import.meta.env.DEV) return;
  if (typeof navigator !== "undefined" && navigator.webdriver) return;
  gaInitialized = true;
  import("react-ga4").then(({ default: ReactGA }) => {
    ReactGA.initialize(GA_ID, {
      gtagOptions: {
        page_location: `${window.location.origin}${window.location.pathname}`,
        page_referrer: document.referrer
          ? new URL(document.referrer).origin
          : "",
      },
    });
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
