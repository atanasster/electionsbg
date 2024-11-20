import { useConcentratedReportRule } from "../common/useConcentratedRule";
import { MunicipalityTemplate } from "./MunicipalityTemplate";

export const MunicipalitiesConcentrationReport = () => {
  const reportRule = useConcentratedReportRule(60);
  return (
    <MunicipalityTemplate
      reportRule={reportRule}
      titleKey="concentrated_party_votes"
      ruleKey="one_party_votes_over"
      visibleColumns={[]}
    />
  );
};
