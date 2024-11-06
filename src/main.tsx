import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import { App } from "@/App.tsx";
import { NotificationsContextProvider } from "@/layout/NotificationsContext.tsx";
import { themeLight } from "@/theme/utils.ts";
import { ThemeContextProvider } from "@/theme/ThemeContext.tsx";
import { LoadingContextProvider } from "@/ux/LoadingContext.tsx";
import { RegionContextProvider } from "./contexts/RegionContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeContextProvider value={themeLight}>
      <RegionContextProvider>
        <NotificationsContextProvider>
          <LoadingContextProvider>
            <App />
          </LoadingContextProvider>
        </NotificationsContextProvider>
      </RegionContextProvider>
    </ThemeContextProvider>
  </React.StrictMode>,
);
