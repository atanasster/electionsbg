/** Capped page export, with scope and source revision; never claims a full export. */
export function procurementPageCsv(
  rows: Record<string, unknown>[],
  scope: string,
  revision: unknown,
): string {
  const cell = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replace(/^[\s]*([=+@-])/, "\u0027$&")
      .replace(/"/g, '""') +
    '"';
  const keys = [...new Set(rows.flatMap(Object.keys))];
  return [
    ["Export", "Current page only"],
    ["Scope", scope],
    ["Revision", JSON.stringify(revision)],
    keys,
    ...rows.map((row) => keys.map((k) => row[k])),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
