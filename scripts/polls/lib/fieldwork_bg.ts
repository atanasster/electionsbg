// Parses an agency's own Bulgarian fieldwork-period text into the
// fieldwork CONTRACT (`src/data/polls/fieldwork.ts`) — the one place this
// rule lives, shared by `scrape_polls.ts` (Wikipedia cell text) and the
// Tier 2c agency extractors (an agency's own published passport text, e.g.
// Trend's OCR'd "Период на провеждане: 12-18 февруари 2026 г."). Extracted
// out of `scrape_polls.ts` rather than forked a second time — decision 14's
// "one home" rule applies to this parsing logic exactly as it does to the
// alias table and the corpus types.

import { formatFieldwork } from "../../../src/data/polls/fieldwork";

const MONTH_BG = [
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

// Exported — scrape_polls.ts's own cell-text cleanup needs the identical
// rule, and this is that logic's one home now.
export const collapseSpaces = (s: string) => s.replace(/\s+/g, " ").trim();

export interface ParsedFieldwork {
  startIso: string | null;
  endIso: string;
  fieldwork: string;
}

/**
 * Bulgarian period text → the canonical fieldwork string (`formatFieldwork`
 * both writes it and is the ONE thing that can throw on an unrepresentable
 * date, per its own contract). Handles the shapes real captures use:
 *
 *   "7 – 14 април 2026"       →  { endIso: "2026-04-14", fieldwork: "Apr 7-14 2026" }
 *   "30 март – 5 април 2026"  →  { endIso: "2026-04-05", fieldwork: "Mar 30 - Apr 5 2026" }
 *   "19 април 2026"           →  { endIso: "2026-04-19", fieldwork: "Apr 19 2026" }
 *   "28–30.09. 2014г"         →  { endIso: "2014-09-30", fieldwork: "Sep 28-30 2014" }
 *   "24.02 – 03.03.2014г"     →  { endIso: "2014-03-03", fieldwork: "Feb 24 - Mar 3 2014" }
 *
 * Returns `null` — never throws — on text that matches none of these
 * shapes, or names a month `formatFieldwork` cannot represent (an
 * impossible day, a range spanning two years): decision 5's rule that an
 * unparseable field is refused, not guessed, applies to a date exactly as
 * it does to a share.
 */
export const parseBgFieldworkRange = (raw: string): ParsedFieldwork | null => {
  const cleaned = collapseSpaces(
    raw.replace(/[\u2013\u2014]/g, "-").replace(/\u00A0/g, " "),
  );
  // A trailing "г." ("year", abbreviated) is optional — Trend's own passport
  // slides always carry it ("13-19 март 2026 г.", measured 2026-09-09
  // across all three real captures), tesseract routinely drops the period,
  // and a Wikipedia table cell (this function's other caller) never has it
  // at all.
  const YEAR_SUFFIX = "(?:\\s*г\\.?)?";
  const reRange = new RegExp(
    `^(\\d{1,2})\\s*-\\s*(\\d{1,2})\\s+([а-я]+)\\s+(\\d{4})${YEAR_SUFFIX}$`,
    "i",
  );
  const reCross = new RegExp(
    `^(\\d{1,2})\\s+([а-я]+)\\s*-\\s*(\\d{1,2})\\s+([а-я]+)\\s+(\\d{4})${YEAR_SUFFIX}$`,
    "i",
  );
  const reSingle = new RegExp(
    `^(\\d{1,2})\\s+([а-я]+)\\s+(\\d{4})${YEAR_SUFFIX}$`,
    "i",
  );

  const monthIndex = (m: string) => MONTH_BG.indexOf(m.toLowerCase());
  const iso = (year: string, monthIdx: number, day: string) =>
    `${year}-${String(monthIdx + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;

  const write = (
    startIso: string | null,
    endIso: string,
  ): ParsedFieldwork | null => {
    try {
      return { startIso, endIso, fieldwork: formatFieldwork(startIso, endIso) };
    } catch (e) {
      console.warn(
        `  ! unrepresentable fieldwork "${raw.trim()}": ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  };

  // Numeric months — Alpha Research's pre-2017 Word attachments write
  // "28–30.09. 2014г" and "24.02 – 03.03.2014г". The trailing "." after
  // the month is optional and may be followed by a space before the year.
  const reNumRange = new RegExp(
    `^(\\d{1,2})\\s*-\\s*(\\d{1,2})\\.(\\d{1,2})\\.?\\s*(\\d{4})${YEAR_SUFFIX}$`,
  );
  const reNumCross = new RegExp(
    `^(\\d{1,2})\\.(\\d{1,2})\\.?\\s*-\\s*(\\d{1,2})\\.(\\d{1,2})\\.?\\s*(\\d{4})${YEAR_SUFFIX}$`,
  );
  const numMonth = (m: string): number => {
    const n = Number(m);
    return n >= 1 && n <= 12 ? n - 1 : -1;
  };

  let mr: RegExpMatchArray | null;
  if ((mr = cleaned.match(reNumCross))) {
    const [, d1, m1, d2, m2, year] = mr;
    const mo1 = numMonth(m1);
    const mo2 = numMonth(m2);
    if (mo1 < 0 || mo2 < 0) return null;
    return write(iso(year, mo1, d1), iso(year, mo2, d2));
  }
  if ((mr = cleaned.match(reNumRange))) {
    const [, d1, d2, m, year] = mr;
    const mo = numMonth(m);
    if (mo < 0) return null;
    return write(iso(year, mo, d1), iso(year, mo, d2));
  }
  if ((mr = cleaned.match(reCross))) {
    const [, d1, mo1Bg, d2, mo2Bg, year] = mr;
    const mo1 = monthIndex(mo1Bg);
    const mo2 = monthIndex(mo2Bg);
    if (mo1 < 0 || mo2 < 0) return null;
    return write(iso(year, mo1, d1), iso(year, mo2, d2));
  }
  if ((mr = cleaned.match(reRange))) {
    const [, d1, d2, moBg, year] = mr;
    const mo = monthIndex(moBg);
    if (mo < 0) return null;
    return write(iso(year, mo, d1), iso(year, mo, d2));
  }
  if ((mr = cleaned.match(reSingle))) {
    const [, d, moBg, year] = mr;
    const mo = monthIndex(moBg);
    if (mo < 0) return null;
    return write(iso(year, mo, d), iso(year, mo, d));
  }
  return null;
};
