import { FC } from "react";
import { Link } from "@/ux/Link";
import { useRiskScoreForSection } from "@/data/riskScore/useRiskScore";
import { RiskBandBadge } from "./RiskBandBadge";

// Compact risk-band badge rendered on the section detail page next to
// the problem-neighborhood badge. Hidden for low-band sections to avoid
// stamping every page — only renders when the section sits at elevated
// or above. Clicks through to the per-section decomposition view.
export const SectionRiskBadge: FC<{ sectionCode: string }> = ({
  sectionCode,
}) => {
  const { row } = useRiskScoreForSection(sectionCode);
  if (!row || row.band === "low") return null;
  return (
    <Link
      to={`/risk-score/${sectionCode}`}
      underline={false}
      className="inline-flex"
    >
      <RiskBandBadge
        band={row.band}
        score={row.score}
        signalsAvailable={row.signalsAvailable}
        signalsTotal={row.signalsTotal}
      />
    </Link>
  );
};
