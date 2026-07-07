// 1-based month number → localized month name. Index 0 is "" so `MONTHS[month]`
// is a direct lookup; out-of-range months yield "" rather than `undefined`.
const BG = [
  "",
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
];
const EN = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** 1-based month → localized name ("" for out-of-range). */
export const monthName = (m: number, lang: string): string =>
  (lang === "bg" ? BG : EN)[m] ?? "";

/** "<month> <year>" in the given language; blanks out gracefully for a bad month. */
export const monthYearLabel = (m: number, y: number, lang: string): string =>
  `${monthName(m, lang)} ${y}`.trim();
