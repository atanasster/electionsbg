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
}> = ({ ...props }) => {
  return <ReportTemplate levelKey="by_municipalities" {...props} />;
};
