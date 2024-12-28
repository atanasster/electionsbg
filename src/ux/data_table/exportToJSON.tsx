import { AccessorKeyColumnDefBase, Table } from "@tanstack/react-table";
import { DataTableColumnDef, getCellValue } from "./utils";

export function exportToJSON<TData>(table: Table<TData>, title: string) {
  const headers = table
    .getLeafHeaders()
    .filter(
      (h) =>
        !("columns" in h.column.columnDef) &&
        !h.isPlaceholder &&
        !(h.column.columnDef as DataTableColumnDef<TData, unknown>)
          .exportHidden,
    )
    .map(
      (header) =>
        (header.column.columnDef as AccessorKeyColumnDefBase<TData>)
          .accessorKey,
    );
  const data = table.getSortedRowModel().rows?.length
    ? table.getSortedRowModel().rows.reduce(
        (acc: object[], row) => [
          ...acc,
          row
            .getVisibleCells()
            .filter(
              (c) =>
                !("columns" in c.column.columnDef) &&
                !(c.column.columnDef as DataTableColumnDef<TData, unknown>)
                  .exportHidden,
            )
            .reduce(
              (acc: object, cell, idx) => ({
                ...acc,
                [headers[idx] as string]: getCellValue(cell),
              }),
              {},
            ),
        ],
        [],
      )
    : null;
  if (data) {
    const jsonData = new Blob([JSON.stringify(data)], {
      type: "application/json",
    });
    const jsonURL = URL.createObjectURL(jsonData);
    const link = document.createElement("a");
    link.href = jsonURL;
    link.download = `${title.replace(" / ", "_").replace("/", "_")}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
