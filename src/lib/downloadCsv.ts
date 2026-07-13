// Minimal array-of-objects → CSV download, for the bespoke (non-DataTable) tiles
// that render their own lists (the НЗОК pack, etc.). The DataTable surfaces use
// src/ux/data_table/exportToCsv.tsx instead; this is the lightweight sibling for
// a plain row array. Values are RFC-4180 quoted (quotes doubled, any cell with a
// delimiter/quote/newline wrapped) so Cyrillic hospital names with commas survive.

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

const cell = (v: string | number | null | undefined): string => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Build a CSV string from rows + typed columns. */
export const toCsv = <T>(
  rows: readonly T[],
  columns: CsvColumn<T>[],
): string => {
  const head = columns.map((c) => cell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(","));
  // Prepend a UTF-8 BOM so Excel opens the Cyrillic correctly.
  return "﻿" + [head, ...body].join("\r\n");
};

/** Trigger a browser download of `csv` as `<filename>.csv`. */
export const downloadCsv = (filename: string, csv: string): void => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
