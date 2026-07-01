import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import { App } from "@/App.tsx";

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
