import { FC, useMemo } from "react";
import { ColumnNames, ReportTemplate } from "../common/ReportTemplate";
import { ReportRule } from "../common/utils";
import { useSettlementData } from "./useData";
import { useSearchParams } from "react-router-dom";
import { useSettlementsInfo } from "@/data/useSettlements";

export const SettlementTemplate: FC<{
  reportRule: ReportRule;
  titleKey: string;
  ruleKey: string;
  visibleColumns?: ColumnNames[];
}> = ({ reportRule, titleKey, ruleKey, visibleColumns = [] }) => {
  const [searchParams] = useSearchParams();
  const { findSettlement } = useSettlementsInfo();
  const threshold = useMemo(
    () =>
      parseInt(
        searchParams.get("threshold") || reportRule.defaultThreshold.toString(),
      ),
    [reportRule.defaultThreshold, searchParams],
  );

  const votes = useSettlementData(reportRule, threshold);
  return (
    <ReportTemplate
      levelKey="settlements"
      reportRule={reportRule}
      titleKey={titleKey}
      votes={votes}
      ruleKey={ruleKey}
      locationFn={(row) => findSettlement(row.getValue("ekatte"))}
      visibleColumns={[...visibleColumns, "ekatte"]}
    />
  );
};
