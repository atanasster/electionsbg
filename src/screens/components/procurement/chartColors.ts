// Theme-aware colors for the procurement flow visualisations (Sankey, entity
// flow tile, legends). The light palette is the codebase-standard entity
// language (slate = awarder, terracotta = contractor, blue = MP, teal =
// official). The dark palette brightens each to the -400 step so the node
// fills clear WCAG 1.4.11 non-text contrast (≥3:1) against the navy dark-mode
// background — slate-600 (#475569) sat at ~2:1 there.

import { useContext } from "react";
import { ThemeContext } from "@/theme/ThemeContext";
import { themeDark } from "@/theme/utils";

export const useIsDark = (): boolean =>
  useContext(ThemeContext).theme === themeDark;

export type FlowEntityType = "awarder" | "contractor" | "mp" | "official";

const FLOW_LIGHT: Record<FlowEntityType, string> = {
  awarder: "#475569", // slate-600
  contractor: "#d97706", // amber-600
  mp: "#2563eb", // blue-600
  official: "#0d9488", // teal-600
};

const FLOW_DARK: Record<FlowEntityType, string> = {
  awarder: "#94a3b8", // slate-400
  contractor: "#fbbf24", // amber-400
  mp: "#60a5fa", // blue-400
  official: "#2dd4bf", // teal-400
};

/** Active entity-type palette for the current theme. Call inside a component. */
export const useFlowColors = (): Record<FlowEntityType, string> =>
  useIsDark() ? FLOW_DARK : FLOW_LIGHT;

// Two-series by-year charts: an amount bar + a contract-count line. The dark
// variants brighten to the -400 step so the blue count line/dots clear contrast
// against the navy background (blue-600 sat ~2.5:1 there).
const SERIES_LIGHT = { amount: "#d97706", count: "#2563eb" };
const SERIES_DARK = { amount: "#fbbf24", count: "#60a5fa" };

export const useSeriesColors = (): { amount: string; count: string } =>
  useIsDark() ? SERIES_DARK : SERIES_LIGHT;
