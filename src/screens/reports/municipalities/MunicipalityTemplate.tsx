import { FC, useMemo } from "react";
import { ColumnNames, ReportTemplate } from "../common/ReportTemplate";
import { ReportRule } from "../common/utils";
import { useMunicipalityData } from "./useData";
import { useSearchParams } from "react-router-dom";
import { useMunicipalities } from "@/data/useMunicipalities";

export const MunicipalityTemplate: FC<{
  reportRule: ReportRule;
  titleKey: string;
  ruleKey: string;
  visibleColumns?: ColumnNames[];
}> = ({ reportRule, titleKey, ruleKey, visibleColumns = [] }) => {
  const [searchParams] = useSearchParams();
  const { findMunicipality } = useMunicipalities();
  const threshold = useMemo(
    () =>
      parseInt(
        searchParams.get("threshold") || reportRule.defaultThreshold.toString(),
      ),
    [reportRule.defaultThreshold, searchParams],
  );

  const votes = useMunicipalityData(reportRule, threshold);
  return (
    <ReportTemplate
      levelKey="municipalities"
      reportRule={reportRule}
      titleKey={titleKey}
      votes={votes}
      ruleKey={ruleKey}
      locationFn={(row) => findMunicipality(row.getValue("obshtina"))}
      visibleColumns={visibleColumns}
    />
  );
};
