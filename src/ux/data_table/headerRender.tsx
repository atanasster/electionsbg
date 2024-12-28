import { Header } from "@tanstack/react-table";
import { DataTableColumnDef, getHeaderValue } from "./utils";
import { ReactNode } from "react";
import { Hint } from "../Hint";
import { Button } from "@/components/ui/button";
import { ArrowUpDown } from "lucide-react";

export function headerRender<TData, TValue>(
  header: Header<TData, TValue>,
): ReactNode {
  const columnDef = header.column.columnDef as DataTableColumnDef<
    TData,
    TValue
  >;
  const hintText = columnDef.headerHint;
  const value = getHeaderValue(header);
  const getValue = () => {
    switch (columnDef.dataType) {
      case "thousands":
      case "percent":
      case "money":
      case "pctChange":
        return <div className="text-center">{value}</div>;
      default:
        return value;
    }
  };
  const rendered = hintText ? (
    <Hint text={hintText}>{getValue()}</Hint>
  ) : (
    getValue()
  );

  return (
    <div className="flex justify-center items-center gap-2">
      {rendered}
      {header.column.getCanSort() && (
        <Button
          variant="ghost"
          className="px-0"
          onClick={() =>
            header.column.toggleSorting(header.column.getIsSorted() === "asc")
          }
        >
          <ArrowUpDown className="h-4 w-4 " />
        </Button>
      )}
    </div>
  );
}
