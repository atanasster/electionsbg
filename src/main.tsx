import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import { App } from "@/App.tsx";
import { themeLight } from "@/theme/utils.ts";
import { ThemeContextProvider } from "@/theme/ThemeContext.tsx";
import { LoadingContextProvider } from "@/ux/LoadingContext.tsx";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "./data/QueryProvider";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeContextProvider value={themeLight}>
      <LoadingContextProvider>
        <QueryProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </QueryProvider>
      </LoadingContextProvider>
    </ThemeContextProvider>
  </React.StrictMode>,
);
