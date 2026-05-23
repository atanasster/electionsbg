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
