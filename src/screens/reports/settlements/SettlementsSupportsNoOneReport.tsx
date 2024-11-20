import { useSupportsNoOneRule } from "../common/useSupportsNoOneRule";
import { SettlementTemplate } from "./SettlementTemplate";

export const SettlementsSupportsNoOneReport = () => {
  const reportRule = useSupportsNoOneRule(50);
  return (
    <SettlementTemplate
      reportRule={reportRule}
      titleKey="support_no_one"
      ruleKey="support_no_one_over"
      visibleColumns={["pctSupportsNoOne"]}
    />
  );
};
