import type { RiskComponentId } from "@/data/riskScore/useRiskScore";

// Single source of truth for risk-signal colors. Used by RiskWaterfall
// (per-section detail) and RiskScoreScreen's SIGNALS column (overview
// table dots + their tooltips) so the same color always means the same
// signal everywhere the score surfaces.
export const SIGNAL_COLORS: Record<RiskComponentId, string> = {
  recount: "#a855f7", // purple — recount adjustments
  suemgMismatch: "#f97316", // orange — flash-memory delta
  invalidBallots: "#ef4444", // red — invalid ballots
  additionalVoters: "#eab308", // amber — list additions
  concentrated: "#06b6d4", // cyan — single-party dominance
  peerOutlier: "#8b5cf6", // violet — settlement outlier
};
