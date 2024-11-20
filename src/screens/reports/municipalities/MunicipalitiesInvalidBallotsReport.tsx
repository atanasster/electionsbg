import { useInvalidBallotsRule } from "../common/useInvalidBallotsRule";
import { MunicipalityTemplate } from "./MunicipalityTemplate";

export const MunicipalitiesInvalidBallotsReport = () => {
  const reportRule = useInvalidBallotsRule(5);
  return (
    <MunicipalityTemplate
      reportRule={reportRule}
      titleKey="invalid_ballots"
      ruleKey="invalid_ballots_over"
      visibleColumns={["pctInvalidBallots"]}
    />
  );
};
