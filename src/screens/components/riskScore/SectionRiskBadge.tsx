import { FC } from "react";
import { useRiskScoreForSection } from "@/data/riskScore/useRiskScore";
import { RiskBandBadge } from "./RiskBandBadge";

// Compact risk-band badge rendered on the section detail page near the
// problem-neighborhood indicator. Hidden for low-band sections to avoid
// stamping every page — only renders when the section sits at elevated
// or above. Non-clickable: the full decomposition lives in
// SectionRiskTile further down the same page.
export const SectionRiskBadge: FC<{ sectionCode: string }> = ({
  sectionCode,
}) => {
  const { row } = useRiskScoreForSection(sectionCode);
  if (!row || row.band === "low") return null;
  return (
    <RiskBandBadge
      band={row.band}
      score={row.score}
      signalsAvailable={row.signalsAvailable}
      signalsTotal={row.signalsTotal}
    />
  );
};
