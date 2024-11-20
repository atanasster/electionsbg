import { useTurnoutRule } from "../common/useTurnoutRule";
import { SettlementTemplate } from "./SettlementTemplate";

export const SettlementsTurnoutReport = () => {
  const reportRule = useTurnoutRule(70);
  return (
    <SettlementTemplate
      reportRule={reportRule}
      titleKey="voter_turnout"
      ruleKey="voter_turnout_over"
      visibleColumns={["voterTurnout"]}
    />
  );
};
