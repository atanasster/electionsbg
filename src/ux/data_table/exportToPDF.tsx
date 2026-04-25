import { Table } from "@tanstack/react-table";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { font } from "./OpenSans-Medium-normal";

import { DataTableColumnDef, getCellValue, getHeaderValue } from "./utils";

export function exportToPDF<TData>(table: Table<TData>, title: string) {
  const headers = table
    .getLeafHeaders()
    .filter(
      (h) =>
        !("columns" in h.column.columnDef) &&
        !h.isPlaceholder &&
        !(h.column.columnDef as DataTableColumnDef<TData, unknown>)
          .exportHidden,
    )
    .map((header) => getHeaderValue(header))
    .map((a) => (a ? a.toString() : ""));
  const data = table.getSortedRowModel().rows?.length
    ? table.getSortedRowModel().rows.reduce((acc: string[][], row) => {
        return [
          ...acc,
          row
            .getVisibleCells()
            .filter(
              (c) =>
                !("columns" in c.column.columnDef) &&
                !(c.column.columnDef as DataTableColumnDef<TData, unknown>)
                  .exportHidden,
            )
            .map((cell) => getCellValue(cell)?.toString()) as string[],
        ];
      }, [])
    : null;
  if (data) {
    const doc = new jsPDF({ filters: ["ASCIIHexEncode"] });

    doc.addFileToVFS("OpenSans-Medium-normal.ttf", font);
    doc.addFont("OpenSans-Medium-normal.ttf", "OpenSans-Medium", "normal");
    doc.setFont("OpenSans-Medium");
    doc.setFontSize(16);
    doc.text(title, 100, 20, {
      align: "center",
    });
    autoTable(doc, {
      startY: 30,
      head: [headers],
      body: data,
      styles: {
        font: "OpenSans-Medium",
        fontStyle: "normal",
      },
    });
    const filename = `${title.replace(" / ", "_").replace("/", "_")}.pdf`;
    if (data.length > 500) {
      doc.save(filename);
    } else {
      // jspdf 4 changed `dataurlnewwindow` semantics: it relies on a base64
      // data URI inside an iframe, which fails for large PDFs and is
      // popup-blocked. Use a blob URL opened from this user-gesture click.
      const blobUrl = doc.output("bloburl") as unknown as string;
      window.open(blobUrl, "_blank");
    }
  }
}
