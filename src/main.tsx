import React from "react";
import ReactDOM from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import "@/index.css";
import { App } from "@/App.tsx";
import { themeLight } from "@/theme/utils.ts";

import { ThemeContextProvider } from "@/theme/ThemeContext.tsx";
import { LoadingContextProvider } from "@/ux/LoadingContext.tsx";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "./data/QueryProvider";
import { TouchProvider } from "./ux/TouchProvider";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HelmetProvider>
      <ThemeContextProvider value={themeLight}>
        <LoadingContextProvider>
          <QueryProvider>
            <TouchProvider>
              <TooltipProvider>
                <App />
              </TooltipProvider>
            </TouchProvider>
          </QueryProvider>
        </LoadingContextProvider>
      </ThemeContextProvider>
    </HelmetProvider>
  </React.StrictMode>,
);
