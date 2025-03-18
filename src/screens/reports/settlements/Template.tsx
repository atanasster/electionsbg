import { FC } from "react";
import {
  ColumnNames,
  ReportColumns,
  ReportTemplate,
} from "../common/ReportTemplate";
import { ReportRow } from "@/data/dataTypes";

export const Template: FC<{
  titleKey: string;
  ruleKey?: string;
  votes?: ReportRow[];
  bigger?: boolean;
  defaultThreshold: number;
  visibleColumns?: ColumnNames[];
  hiddenColumns?: ColumnNames[];
  extraColumns?: ReportColumns;
}> = ({ visibleColumns = [], ...rest }) => {
  return (
    <ReportTemplate
      levelKey="by_settlements"
      visibleColumns={[...visibleColumns, "ekatte"]}
      {...rest}
    />
  );
};
