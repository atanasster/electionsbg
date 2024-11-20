import { useAdditionalVotersRule } from "../common/useAdditionalVotersRule";
import { SettlementTemplate } from "./SettlementTemplate";

export const SettlementsAdditionalVotersReport = () => {
  const reportRule = useAdditionalVotersRule(50);

  return (
    <SettlementTemplate
      reportRule={reportRule}
      titleKey="additional_voters"
      ruleKey="additional_voters_over"
      visibleColumns={["pctAdditionalVoters"]}
    />
  );
};
