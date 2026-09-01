import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// Reuse the main app's design system: tailwind base + fonts (index.css) and the
// HSL theme variables / light+dark palette (App.css).
import "@/index.css";
import "@/App.css";
import "./news.css";
import { ThemeContextProvider } from "@/theme/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";
import {
  isEnglishNewsPath,
  readNewsLanguagePreference,
  type NewsLanguage,
} from "./app/i18n";

const pathname = window.location.pathname;
const storedLanguage = readNewsLanguagePreference();

// Keep the same preference the main site owns, while making the URL the
// canonical language signal. A saved English preference arriving on an
// unprefixed deep link is redirected once; the BG switch writes "bg" before
// following its unprefixed href, so an explicit choice never loops.
if (!isEnglishNewsPath(pathname) && storedLanguage === "en") {
  const target = `/en${pathname === "/" ? "" : pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(target);
} else {
  const language: NewsLanguage = isEnglishNewsPath(pathname) ? "en" : "bg";
  const basename = language === "en" ? "/en" : undefined;

  // Firebase rewrites every path to index.html, so BrowserRouter deep-links work
  // in prod; the vite dev server falls back to index.html natively.
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ThemeContextProvider>
        <TooltipProvider>
          <BrowserRouter basename={basename}>
            <App language={language} />
          </BrowserRouter>
        </TooltipProvider>
      </ThemeContextProvider>
    </React.StrictMode>,
  );
}
