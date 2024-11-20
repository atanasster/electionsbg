import { useAdditionalVotersRule } from "../common/useAdditionalVotersRule";
import { MunicipalityTemplate } from "./MunicipalityTemplate";

export const MunicipalitiesAdditionalVotersReport = () => {
  const reportRule = useAdditionalVotersRule(5);

  return (
    <MunicipalityTemplate
      reportRule={reportRule}
      titleKey="additional_voters"
      ruleKey="additional_voters_over"
      visibleColumns={["pctAdditionalVoters"]}
    />
  );
};
