import { useTurnoutRule } from "../common/useTurnoutRule";
import { SectionTemplate } from "./SectionTemplate";

export const SectionsTurnoutReport = () => {
  const reportRule = useTurnoutRule(70);
  return (
    <SectionTemplate
      reportRule={reportRule}
      titleKey="voter_turnout"
      ruleKey="voter_turnout_over"
      visibleColumns={["voterTurnout"]}
    />
  );
};
