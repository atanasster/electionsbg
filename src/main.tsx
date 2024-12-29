import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import { App } from "@/App.tsx";
import { themeLight } from "@/theme/utils.ts";

import { ThemeContextProvider } from "@/theme/ThemeContext.tsx";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "./data/QueryProvider";
import { TouchProvider } from "./ux/TouchProvider";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeContextProvider value={themeLight}>
      <QueryProvider>
        <TouchProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </TouchProvider>
      </QueryProvider>
    </ThemeContextProvider>
  </React.StrictMode>,
);
