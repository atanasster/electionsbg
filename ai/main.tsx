import React from "react";
import ReactDOM from "react-dom/client";
// Reuse the main app's design system: tailwind base + fonts (index.css) and the
// HSL theme variables / light+dark palette (App.css).
import "@/index.css";
import "@/App.css";
import { ThemeContextProvider } from "@/theme/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeContextProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ThemeContextProvider>
  </React.StrictMode>,
);
