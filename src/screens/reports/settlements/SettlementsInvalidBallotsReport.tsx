import { useInvalidBallotsRule } from "../common/useInvalidBallotsRule";
import { SettlementTemplate } from "./SettlementTemplate";

export const SettlementsInvalidBallotsReport = () => {
  const reportRule = useInvalidBallotsRule(20);
  return (
    <SettlementTemplate
      reportRule={reportRule}
      titleKey="invalid_ballots"
      ruleKey="invalid_ballots_over"
      visibleColumns={["pctInvalidBallots"]}
    />
  );
};
