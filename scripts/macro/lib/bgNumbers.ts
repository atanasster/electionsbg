// Shared Bulgarian-number cell parser for the МФ macro-fetch scripts
// (fetch_arrears, fetch_cash_balance, fetch_fiscal_reserve_history). МФ
// workbooks/PDFs write numbers with space or NBSP thousands separators, a comma
// OR period decimal mark, and occasionally a Unicode minus (−, U+2212):
// "284 710,4", "278 237.6", "−3 072,9". XLS cells arrive as real numbers; PDF
// cells as strings. Normalise either to a JS number, or null when not numeric.
export const parseBgNumber = (c: unknown): number | null => {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  if (typeof c !== "string") return null;
  const cleaned = c
    .replace(/−/g, "-") // Unicode minus → ASCII hyphen-minus
    .replace(/\s/g, "") // space / NBSP thousands separators
    .replace(/,/g, "."); // comma decimal → period
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
};
