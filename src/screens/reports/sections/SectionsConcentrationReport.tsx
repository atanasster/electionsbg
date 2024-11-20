import { useConcentratedReportRule } from "../common/useConcentratedRule";
import { SectionTemplate } from "./SectionTemplate";

export const SectionsConcentrationReport = () => {
  const reportRule = useConcentratedReportRule(90);
  return (
    <SectionTemplate
      reportRule={reportRule}
      titleKey="concentrated_party_votes"
      ruleKey="one_party_votes_over"
      visibleColumns={[]}
    />
  );
};
