import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import { App } from "@/App.tsx";
import { themeLight } from "@/theme/utils.ts";
import { ThemeContextProvider } from "@/theme/ThemeContext.tsx";
import { LoadingContextProvider } from "@/ux/LoadingContext.tsx";
import { SettlementsContextProvider } from "@/data/SettlementsContext";
import { ElectionsContextProvider } from "@/data/ElectionsContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeContextProvider value={themeLight}>
      <LoadingContextProvider>
        <SettlementsContextProvider>
          <ElectionsContextProvider>
            <App />
          </ElectionsContextProvider>
        </SettlementsContextProvider>
      </LoadingContextProvider>
    </ThemeContextProvider>
  </React.StrictMode>,
);
