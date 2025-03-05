import { Cell } from "@tanstack/react-table";
import { DataTableColumnDef, getCellFormatted } from "./utils";
import { ReactNode } from "react";
import { PercentChange } from "../PercentChange";
import { ThousandsChange } from "../ThousandsChange";

export function cellRender<TData, TValue>(
  cell: Cell<TData, TValue>,
): ReactNode {
  const columnDef = cell.column.columnDef as DataTableColumnDef<TData, TValue>;
  const value = getCellFormatted(cell);
  switch (columnDef.dataType) {
    case "thousands":
    case "percent":
    case "money":
      return <div className="text-right">{value}</div>;
    case "thousandsChange":
      return <ThousandsChange className="text-right" number={value} />;
    case "pctChange":
      return (
        <PercentChange className="text-right" pctChange={value} suffix="" />
      );
    default:
      return typeof columnDef.cell === "function"
        ? columnDef.cell(cell.getContext())
        : value;
  }
}
