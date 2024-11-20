import { useConcentratedReportRule } from "../common/useConcentratedRule";
import { SettlementTemplate } from "./SettlementTemplate";

export const SettlementsConcentrationReport = () => {
  const reportRule = useConcentratedReportRule(90);
  return (
    <SettlementTemplate
      reportRule={reportRule}
      titleKey="concentrated_party_votes"
      ruleKey="one_party_votes_over"
      visibleColumns={[]}
    />
  );
};
