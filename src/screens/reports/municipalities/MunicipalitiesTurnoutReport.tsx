import { useTurnoutRule } from "../common/useTurnoutRule";
import { MunicipalityTemplate } from "./MunicipalityTemplate";

export const MunicipalitiesTurnoutReport = () => {
  const reportRule = useTurnoutRule(50);
  return (
    <MunicipalityTemplate
      reportRule={reportRule}
      titleKey="voter_turnout"
      ruleKey="voter_turnout_over"
      visibleColumns={["voterTurnout"]}
    />
  );
};
