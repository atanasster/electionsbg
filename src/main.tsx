import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import { App } from "@/App.tsx";
import { themeLight } from "@/theme/utils.ts";
import { ThemeContextProvider } from "@/theme/ThemeContext.tsx";
import { LoadingContextProvider } from "@/ux/LoadingContext.tsx";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "./data/QueryProvider";
import { ElectionContextProvider } from "./data/ElectionContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeContextProvider value={themeLight}>
      <LoadingContextProvider>
        <QueryProvider>
          <ElectionContextProvider>
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </ElectionContextProvider>
        </QueryProvider>
      </LoadingContextProvider>
    </ThemeContextProvider>
  </React.StrictMode>,
);
