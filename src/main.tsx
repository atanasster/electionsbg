import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import { App } from "@/App.tsx";
import { initI18n, initI18nFallback } from "@/i18n";

import { ThemeContextProvider } from "@/theme/ThemeContext.tsx";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "./data/QueryProvider";
import { TouchProvider } from "./ux/TouchProvider";
import { OptionsContextProvider } from "./layout/dataview/OptionsContext";
import { ConsolidatedProvider } from "./data/ConsolidatedContext";

// Recover from stale lazy-chunk references after a deploy. Hashed chunks are
// immutable and get deleted on redeploy, so a tab left open across a deploy (or
// one holding a cached index.html) requests a chunk that no longer exists —
// Firebase then serves index.html in its place, triggering a MIME/preload
// error. Reload once to fetch the fresh index.html; guard against reload loops.
const reloadOnStaleChunk = (reason: unknown) => {
  const message = String(
    (reason as { message?: string })?.message ?? reason ?? "",
  );
  const isStaleChunk =
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|expected a javascript.*module script/i.test(
      message,
    );
  if (!isStaleChunk) return;
  const key = "stale-chunk-reloaded";
  if (sessionStorage.getItem(key)) return; // already tried once this session
  sessionStorage.setItem(key, "1");
  window.location.reload();
};

window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  reloadOnStaleChunk((e as unknown as { payload?: unknown }).payload);
});
window.addEventListener("unhandledrejection", (e) => {
  reloadOnStaleChunk(e.reason);
});

const render = () => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ThemeContextProvider>
        <QueryProvider>
          <TouchProvider>
            <TooltipProvider>
              <OptionsContextProvider>
                <ConsolidatedProvider>
                  <App />
                </ConsolidatedProvider>
              </OptionsContextProvider>
            </TooltipProvider>
          </TouchProvider>
        </QueryProvider>
      </ThemeContextProvider>
    </React.StrictMode>,
  );
};

// Await i18n before the first render. Only the active language's bundle is
// fetched (see i18n.ts), and react-i18next runs with useSuspense: false, so
// there is no boundary that would retry a render started without resources —
// rendering early would paint raw translation keys and then reflow the page.
//
// The failure path matters because the locale chunk is now a hard prerequisite
// for any UI at all: before this split the corpora shipped inside the entry, so
// a locale fetch could not fail on its own. Without the catch below, a failed
// fetch on a session that has already spent its one-shot stale-chunk reload
// leaves a permanently blank page — the entry loaded fine, so nothing else
// notices. Untranslated text is a navigable page; nothing is not.
initI18n().then(render, (err) => {
  console.error("i18n init failed — rendering without translations", err);
  reloadOnStaleChunk(err);
  void initI18nFallback().then(render, render);
});
