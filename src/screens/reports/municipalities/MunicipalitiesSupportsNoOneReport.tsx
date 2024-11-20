import { useSupportsNoOneRule } from "../common/useSupportsNoOneRule";
import { MunicipalityTemplate } from "./MunicipalityTemplate";

export const MunicipalitiesSupportsNoOneReport = () => {
  const reportRule = useSupportsNoOneRule(50);
  return (
    <MunicipalityTemplate
      reportRule={reportRule}
      titleKey="support_no_one"
      ruleKey="support_no_one_over"
      visibleColumns={["pctSupportsNoOne"]}
    />
  );
};
