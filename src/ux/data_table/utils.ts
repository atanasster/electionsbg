import {
  AccessorKeyColumnDefBase,
  Cell,
  ColumnDef,
  Header,
} from "@tanstack/react-table";
import { DataTableColumns } from "./DataTable";
import { formatPct, formatThousands } from "@/data/utils";

export type DataTableColumnDef<TData, TValue> = ColumnDef<TData, TValue> & {
  hidden?: boolean;
  exportHidden?: boolean;
  className?: string;
  columns?: DataTableColumns<TData, TValue>;
  dataType?: "thousands" | "percent" | "pctChange" | "money";
  headerHint?: string;
};

function cellValue<TData, TValue>(
  cell: Cell<TData, TValue>,
): string | number | undefined | null {
  return cell.getValue<TData>() as string | number | undefined | null;
}
export function getCellValue<TData, TValue>(
  cell: Cell<TData, TValue>,
): string | number | undefined | null {
  const columnDef = cell.column.columnDef as DataTableColumnDef<TData, TValue>;
  const value = cellValue(cell);
  switch (columnDef.dataType) {
    case "thousands":
      if (typeof value === "number") return parseInt(value.toFixed(0));
      return value;
    case "percent":
      if (typeof value === "number") return parseFloat(value.toFixed(2));
      return value;
    case "pctChange":
      if (typeof value === "number") return parseFloat(value.toFixed(2));
      return value;
    case "money":
      if (typeof value === "number") return parseFloat(value.toFixed(2));
      return value;

    default:
      return value;
  }
}

export function getCellFormatted<TData, TValue>(
  cell: Cell<TData, TValue>,
): string | number | undefined | null {
  const columnDef = cell.column.columnDef as DataTableColumnDef<TData, TValue>;
  const value = cellValue(cell);
  switch (columnDef.dataType) {
    case "thousands":
      if (typeof value === "number") return formatThousands(value);
      return value;
    case "percent":
      if (typeof value === "number") return formatPct(value);
      return value;
    case "pctChange":
      if (typeof value === "number") return formatPct(value);
      return value;
    case "money":
      if (typeof value === "number") return formatThousands(value, 2);
      return value;

    default:
      return value;
  }
}

export function getHeaderValue<TData, TValue>(
  header: Header<TData, TValue>,
): string | number | undefined | null {
  const columnDef = header.column.columnDef as DataTableColumnDef<
    TData,
    TValue
  >;
  return typeof columnDef.header === "function"
    ? columnDef.header(header.getContext())
    : typeof columnDef.header !== "undefined"
      ? columnDef.header
      : (columnDef as AccessorKeyColumnDefBase<TData>).accessorKey ||
        columnDef.id;
}
