import React from "react";
import ReactDOM from "react-dom/client";
// Reuse the main app's design system: tailwind base + fonts (index.css) and the
// HSL theme variables / light+dark palette (App.css).
import "@/index.css";
import "@/App.css";
import { ThemeContextProvider } from "@/theme/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";
import { EvalsScreen } from "./app/EvalsScreen";

// One SPA bundle, three entry points. /evals renders the benchmark page; /tools
// opens the chat app on its Tools & data view; everything else is the chat. In
// prod the build emits static dist-ai/evals.html + tools.html (same bundle,
// per-page <head>) via vite.config.ai.ts → writeSeoFiles, and firebase.json
// rewrites /evals → /evals.html and /tools → /tools.html. In dev the SPA
// fallback serves index.html and these checks pick the screen/view.
const pathname = window.location.pathname;
const screen = /^\/evals\/?$/.test(pathname) ? (
  <EvalsScreen />
) : (
  <App initialView={/^\/tools\/?$/.test(pathname) ? "tools" : "chat"} />
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeContextProvider>
      <TooltipProvider>{screen}</TooltipProvider>
    </ThemeContextProvider>
  </React.StrictMode>,
);

// Google Analytics for the dedicated `electionsbg-ai` GA4 property. Wired here
// (not in App.tsx) so it covers both entry screens — the chat and /evals.
// Lazy-loaded after first paint to keep it off the critical path, and skipped
// in dev + for WebDriver-controlled browsers, mirroring the main site
// (src/App.tsx).
const initAnalytics = () => {
  if (import.meta.env.DEV) return;
  if (typeof navigator !== "undefined" && navigator.webdriver) return;
  void import("react-ga4").then(({ default: ReactGA }) => {
    ReactGA.initialize("G-B08ZG0J9LV");
  });
};
const w = window as Window & {
  requestIdleCallback?: (cb: () => void) => number;
};
if (typeof w.requestIdleCallback === "function") {
  w.requestIdleCallback(initAnalytics);
} else {
  setTimeout(initAnalytics, 2000);
}
