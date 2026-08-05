// Number formatting shared by the two education place tiles. One copy, because
// the tiles sit side by side: a grade rendered "4,55" in one and "4.55" in the
// other reads as two different datasets, and that is exactly what two private
// copies of these three functions drift into.

const locale = (lang: string): string => (lang === "bg" ? "bg-BG" : "en-US");

/** A matura grade — always two decimals, so 4,5 and 4,50 can't sit in one
 *  column looking like different precisions. */
export const fmtScore = (v: number, lang: string, digits = 2): string =>
  v.toLocaleString(locale(lang), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** A count — graduates, schools. */
export const fmtCount = (v: number, lang: string): string =>
  v.toLocaleString(locale(lang));

/** A change or a residual, with a real minus sign (U+2212) rather than the
 *  hyphen `toLocaleString` emits — it aligns in a tabular-nums column and reads
 *  as arithmetic rather than as a dash. */
export const fmtSigned = (v: number, lang: string): string =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtScore(Math.abs(v), lang)}`;
