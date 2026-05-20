import type { RiskBand } from "@/data/riskScore/useRiskScore";

// Hex color per risk band — the same hues as RiskBandBadge's Tailwind
// classes (emerald / amber / orange / red). Used where a raw color value
// is needed rather than a class: leaflet markers, inline-styled dots.
export const BAND_COLOR: Record<RiskBand, string> = {
  low: "#10b981",
  elevated: "#f59e0b",
  high: "#f97316",
  critical: "#ef4444",
};
