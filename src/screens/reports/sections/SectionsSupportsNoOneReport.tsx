import { useSupportsNoOneRule } from "../common/useSupportsNoOneRule";
import { SectionTemplate } from "./SectionTemplate";

export const SectionsSupportsNoOneReport = () => {
  const reportRule = useSupportsNoOneRule(50);
  return (
    <SectionTemplate
      reportRule={reportRule}
      titleKey="support_no_one"
      ruleKey="support_no_one_over"
      visibleColumns={["pctSupportsNoOne"]}
    />
  );
};
