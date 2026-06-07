import React from "react";
import ReactDOM from "react-dom/client";
// Reuse the main app's design system: tailwind base + fonts (index.css) and the
// HSL theme variables / light+dark palette (App.css).
import "@/index.css";
import "@/App.css";
import { ThemeContextProvider } from "@/theme/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";
import { EvalsScreen } from "./app/EvalsScreen";

// One SPA bundle, two screens. /evals renders the benchmark page; everything
// else is the chat. In prod the build emits a static dist-ai/evals.html (same
// bundle, eval-specific <head>) via vite.config.ai.ts → writeSeoFiles, and
// firebase.json rewrites /evals → /evals.html. In dev the SPA fallback serves
// index.html for /evals and this branch picks the screen.
const isEvals = /^\/evals\/?$/.test(window.location.pathname);
const Root = isEvals ? EvalsScreen : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeContextProvider>
      <TooltipProvider>
        <Root />
      </TooltipProvider>
    </ThemeContextProvider>
  </React.StrictMode>,
);
