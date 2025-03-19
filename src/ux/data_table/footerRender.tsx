import { Header, Table } from "@tanstack/react-table";
import { DataTableColumnDef } from "./utils";
import { ReactNode } from "react";
import { formatPct, formatThousands } from "@/data/utils";
import { ThousandsChange } from "../ThousandsChange";
import { PercentChange } from "../PercentChange";
import { TFunctionNonStrict } from "i18next";

export function footerRender<TData, TValue>(
  table: Table<TData>,
  header: Header<TData, TValue>,
  stickyColumn: boolean,
  t: TFunctionNonStrict<"translation", undefined>,
): ReactNode {
  const columnDef = header.column.columnDef as DataTableColumnDef<
    TData,
    TValue
  >;
  const rows = table.getFilteredRowModel().rows;
  const sum = () => {
    if (rows.length) {
      return rows.reduce((acc, row) => {
        const val = row.getValue(header.column.id) as number;
        if (val) {
          return (acc += val);
        }
        return acc;
      }, 0);
    }
    return undefined;
  };
  const avg = () => {
    const { sum, count } = rows.reduce(
      (acc: { sum: number; count: number }, row) => {
        const val = row.getValue(header.column.id) as number;
        if (val) {
          return {
            sum: acc.sum + val,
            count: acc.count + 1,
          };
        }
        return acc;
      },
      { sum: 0, count: 0 },
    );
    return count ? sum / count : undefined;
  };
  const getValue = () => {
    switch (columnDef.dataType) {
      case "money": {
        const value = sum();
        return formatThousands(value, 2);
      }
      case "thousands": {
        const value = sum();
        return formatThousands(value);
      }
      case "percent": {
        const value = avg();
        return value ? formatPct(value) : undefined;
      }
      case "thousandsChange": {
        const value = sum();
        return <ThousandsChange number={value} />;
      }
      case "pctChange": {
        const value = formatPct(avg());
        return (
          <PercentChange className="text-right" pctChange={value} suffix="" />
        );
      }
      default: {
        if (header.index === 0 && stickyColumn) {
          return (
            <div className="w-full">{`${t("total")}: ${formatThousands(rows.length)}`}</div>
          );
        }
        return undefined;
      }
    }
  };

  return <div className={"flex justify-end gap-2"}>{getValue()}</div>;
}
