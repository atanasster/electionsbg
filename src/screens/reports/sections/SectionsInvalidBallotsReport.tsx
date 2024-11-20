import { useInvalidBallotsRule } from "../common/useInvalidBallotsRule";
import { SectionTemplate } from "./SectionTemplate";

export const SectionsInvalidBallotsReport = () => {
  const reportRule = useInvalidBallotsRule(20);
  return (
    <SectionTemplate
      reportRule={reportRule}
      titleKey="invalid_ballots"
      ruleKey="invalid_ballots_over"
      visibleColumns={["pctInvalidBallots"]}
    />
  );
};
