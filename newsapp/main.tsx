import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// Reuse the main app's design system: tailwind base + fonts (index.css) and the
// HSL theme variables / light+dark palette (App.css).
import "@/index.css";
import "@/App.css";
import "./news.css";
import { ThemeContextProvider } from "@/theme/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";

// Firebase rewrites every path to index.html, so BrowserRouter deep-links work
// in prod; the vite dev server falls back to index.html natively.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeContextProvider>
      <TooltipProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TooltipProvider>
    </ThemeContextProvider>
  </React.StrictMode>,
);
