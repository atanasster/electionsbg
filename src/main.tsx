import React from "react";
import ReactDOM from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import "@/index.css";
import { App } from "@/App.tsx";
import { themeLight } from "@/theme/utils.ts";

import { ThemeContextProvider } from "@/theme/ThemeContext.tsx";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "./data/QueryProvider";
import { TouchProvider } from "./ux/TouchProvider";
import { DataViewContextProvider } from "./layout/dataview/DataViewContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HelmetProvider>
      <ThemeContextProvider value={themeLight}>
        <QueryProvider>
          <TouchProvider>
            <TooltipProvider>
              <DataViewContextProvider>
                <App />
              </DataViewContextProvider>
            </TooltipProvider>
          </TouchProvider>
        </QueryProvider>
      </ThemeContextProvider>
    </HelmetProvider>
  </React.StrictMode>,
);
