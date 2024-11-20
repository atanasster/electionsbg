import { useAdditionalVotersRule } from "../common/useAdditionalVotersRule";
import { SectionTemplate } from "./SectionTemplate";

export const SectionsAdditionalVotersReport = () => {
  const reportRule = useAdditionalVotersRule(50);

  return (
    <SectionTemplate
      reportRule={reportRule}
      titleKey="additional_voters"
      ruleKey="additional_voters_over"
      visibleColumns={["pctAdditionalVoters"]}
    />
  );
};
