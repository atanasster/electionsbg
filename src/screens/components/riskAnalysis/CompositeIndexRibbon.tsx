import { FC } from "react";
import { useRiskComposite } from "@/data/riskScore/useRiskComposite";
import { CompositeIndexRibbonView } from "./CompositeIndexRibbonView";

// Slim ribbon at the top of the home Anomalies section — the parliamentary composite, drawn by
// the shared `CompositeIndexRibbonView`.
export const CompositeIndexRibbon: FC = () => {
  const composite = useRiskComposite();
  if (!composite) return null;
  return (
    <CompositeIndexRibbonView
      composite={composite}
      seeFullTo="/risk-analysis"
    />
  );
};
