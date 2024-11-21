import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import { App } from "@/App.tsx";
import { themeLight } from "@/theme/utils.ts";
import { ThemeContextProvider } from "@/theme/ThemeContext.tsx";
import { LoadingContextProvider } from "@/ux/LoadingContext.tsx";
import { SettlementsContextProvider } from "@/data/SettlementsContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PartyContextProvider } from "./data/ElectionsContext";
import { AggregatedContextProvider } from "./data/AggregatedVotesHook";
import { SectionContextProvider } from "./data/SectionsContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeContextProvider value={themeLight}>
      <LoadingContextProvider>
        <AggregatedContextProvider>
          <SectionContextProvider>
            <PartyContextProvider>
              <SettlementsContextProvider>
                <TooltipProvider>
                  <App />
                </TooltipProvider>
              </SettlementsContextProvider>
            </PartyContextProvider>
          </SectionContextProvider>
        </AggregatedContextProvider>
      </LoadingContextProvider>
    </ThemeContextProvider>
  </React.StrictMode>,
);
