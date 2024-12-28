import { Table } from "@tanstack/react-table";
import { DataTableColumnDef, getCellValue, getHeaderValue } from "./utils";

export function exportToCsv<TData>(table: Table<TData>, title: string) {
  const headers = table
    .getLeafHeaders()
    .filter((h) => {
      return (
        !("columns" in h.column.columnDef) &&
        !h.isPlaceholder &&
        !(h.column.columnDef as DataTableColumnDef<TData, unknown>).exportHidden
      );
    })
    .map((header) => getHeaderValue(header))
    .join(";");
  const data = table.getSortedRowModel().rows?.length
    ? table
        .getSortedRowModel()
        .rows.reduce(
          (acc, row) => [
            ...acc,
            row
              .getVisibleCells()
              .filter(
                (c) =>
                  !("columns" in c.column.columnDef) &&
                  !(c.column.columnDef as DataTableColumnDef<TData, unknown>)
                    .exportHidden,
              )
              .map((cell) => getCellValue(cell))
              .join(";"),
          ],
          [headers],
        )
        .join("\r\n")
    : null;
  if (data) {
    const csvData = new Blob([data], { type: "text/csv" });
    const csvURL = URL.createObjectURL(csvData);
    const link = document.createElement("a");
    link.href = csvURL;
    link.download = `${title.replace(" / ", "_").replace("/", "_")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
