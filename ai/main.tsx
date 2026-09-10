import React from "react";
import ReactDOM from "react-dom/client";
// Reuse the main app's design system: tailwind base + fonts (index.css) and the
// HSL theme variables / light+dark palette (App.css).
import "@/index.css";
import "@/App.css";
import { ThemeContextProvider } from "@/theme/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
// This provider only imports TanStack Query; it does not load translated data hooks.
// eslint-disable-next-line no-restricted-imports
import { QueryProvider } from "@/data/QueryProvider";
import { App } from "./App";
import { EvalsScreen } from "./app/EvalsScreen";
import { LegacyTransition } from "./app/LegacyTransition";
import { isLegacyPage } from "./app/legacyRoutes";

// Keep this old-origin entry while browser-local conversations need export.
// Unknown page paths deliberately render a fallback rather than invent a redirect.
const pathname = window.location.pathname;
const screen = !isLegacyPage(pathname) ? (
  <main className="p-6">
    <h1>Няма такава страница / Page not found</h1>
    <a href="/legacy-export" className="underline">
      Възстанови разговор / Recover conversation
    </a>
  </main>
) : /^\/evals\/?$/.test(pathname) ? (
  <EvalsScreen />
) : (
  <App initialView={/^\/tools\/?$/.test(pathname) ? "tools" : "chat"} />
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeContextProvider>
      <QueryProvider>
        <TooltipProvider>
          <LegacyTransition>{screen}</LegacyTransition>
        </TooltipProvider>
      </QueryProvider>
    </ThemeContextProvider>
  </React.StrictMode>,
);

// Legacy analytics are retired: prompt URLs and recovered conversations must
// never be sent to the former standalone GA property. Main-site analytics owns
// the integrated screens and applies its prompt privacy guard.
