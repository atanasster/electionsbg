import { FC } from "react";
import { ColumnNames, ReportTemplate } from "../common/ReportTemplate";
import { ReportRow } from "@/data/dataTypes";

export const Template: FC<{
  titleKey: string;
  ruleKey?: string;
  votes?: ReportRow[];
  bigger?: boolean;
  defaultThreshold: number;
  visibleColumns?: ColumnNames[];
  hiddenColumns?: ColumnNames[];
}> = ({
  titleKey,
  ruleKey,
  votes,
  visibleColumns = [],
  hiddenColumns,
  defaultThreshold,
  bigger,
}) => {
  return (
    <ReportTemplate
      levelKey="sections"
      defaultThreshold={defaultThreshold}
      bigger={bigger}
      titleKey={titleKey}
      votes={votes}
      ruleKey={ruleKey}
      visibleColumns={[...visibleColumns, "ekatte", "section"]}
      hiddenColumns={hiddenColumns}
    />
  );
};
