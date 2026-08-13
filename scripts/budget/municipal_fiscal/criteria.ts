// The чл. 130а criteria as МФ ITSELF publishes them — the year-end-anchored
// releases, which state one column per criterion plus the ministry's own count
// and its финансово оздравяване verdict.
//
// WHY THIS IS A SEPARATE READER. The quarterly sheet lets us DERIVE three of
// the seven criteria from published levels; four need inputs it does not carry
// (debt SERVICE, guarantee nominal, three consecutive years of balance, the
// national collection mean). So „N от 7" from that source is always a floor,
// and `meets_threshold` can be decisively TRUE but never decisively FALSE.
//
// These releases close that gap: all seven, stated, for every year-end they
// cover. Where they reach, the verdict stops being ours.
//
// THE SHEET IS NOT THE QUARTERLY ONE and must never be read with its parser:
// it is one row per município per YEAR-END with per-year expenditure columns,
// not three period columns per indicator. `parsePokazateli` refuses it via the
// distinct-period guard, which is what that guard is for.

import { num } from "./parse";

/** Sheet-name spellings seen across the cache, including the Latin/Cyrillic
 *  switch (`danni` / `данни`). Matched case-insensitively and by prefix, since
 *  each carries its own year range („danni 2021-2024"). */
//  NO `\b` — JS word boundaries are ASCII-only, so between the „и" of „данни"
//  and the following space there is no boundary and the Cyrillic spelling never
//  matches. (Second time this trap has bitten in this module; the other is in
//  `parse.ts`'s collection titles.)
const CRITERIA_SHEET_RE = /^(danni|данни)(\s|$)/i;

export const findCriteriaSheet = (names: readonly string[]): string | null =>
  names.find((n) => CRITERIA_SHEET_RE.test(n.trim())) ?? null;

/** The seven criteria, in МФ's own order and numbering. */
export const CRITERIA_COUNT = 7;

const TITLES = {
  criteria: /^([1-7])\.\s/,
  /** „Брой на критериите по чл. 130а, ал. 1 от ЗПФ, на които отговаря …" —
   *  and there are SEVERAL such columns in the later releases (one per year in
   *  the range). The first is the one for the anchor year. */
  count: /^Брой на критериите по чл\.?\s*130а/i,
  recovery: /^Община за финансово оздравяване/i,
  mfCode: /^Община код по ЕБК/i,
} as const;

export interface OfficialCriteriaRow {
  mfCode: number;
  /** Which of the seven are met, by МФ's numbering. */
  met: number[];
  /** The ministry's own count. Kept beside `met` rather than derived from it,
   *  because a disagreement between the two is a parse error worth seeing. */
  officialCount: number | null;
  inRecovery: boolean;
}

export interface OfficialCriteria {
  /** The year-end these criteria describe. */
  fiscalYear: number;
  rows: OfficialCriteriaRow[];
  warnings: string[];
}

/** МФ code aliases used ONLY on these year-end sheets.
 *
 *  Столична община is `7200` in the quarterly returns and `7225` here — the
 *  same alternate code the 2018 Q4-anchored release used. Unmapped, the largest
 *  município in the country silently has no official чл. 130а verdict on any
 *  year-end, while the other 264 do: a one-row gap that no count makes visible,
 *  since 264 of 265 reads as a rounding artefact rather than as Sofia missing.
 *
 *  Mapped here rather than in `codes.ts` because it is a property of THIS
 *  sheet, not of the crosswalk — the quarterly corpus never sees 7225. */
const MF_ALIAS: Readonly<Record<number, number>> = { 7225: 7200 };

const norm = (v: unknown): string =>
  v == null ? "" : String(v).replace(/\s+/g, " ").trim();

/** A criterion cell.
 *
 *  These are NOT booleans. МФ populates the cell with the MEASURED RATIO
 *  exactly when the criterion is met, and leaves it blank when it is not — so
 *  presence is the verdict and the number is the evidence. Verified against the
 *  ministry's own „Брой на критериите" column on every row of every release:
 *  the count of populated cells equals the published count, 265 municipalities
 *  × 4 year-ends, no exceptions.
 *
 *  Reading these as да/не would have found none, since none says „да" — which
 *  is how „0 municipalities meet 3+ criteria" appeared beside 17 in a чл. 130д
 *  recovery procedure, a state the statute makes impossible. */
export const criterionMet = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === "number") return Number.isFinite(v);
  const s = norm(v);
  if (s === "") return false;
  // A textual „да" is accepted too: cheap, and it costs nothing to survive a
  // release that changes its mind about the representation.
  if (/^(да|yes|true)$/i.test(s)) return true;
  return num(v) != null;
};

export const parseCriteriaSheet = (
  rows: readonly unknown[][],
  sheetName: string,
): OfficialCriteria | null => {
  const warnings: string[] = [];
  // The anchor year is the LAST in the sheet's own name („danni 2021-2024" →
  // 2024). Taken from the name rather than from a column because the year
  // columns describe the four-year window, not the verdict's period.
  const years = [...sheetName.matchAll(/(20\d{2})/g)].map((m) => Number(m[1]));
  if (years.length === 0) return null;
  const fiscalYear = Math.max(...years);

  // The header is not on a fixed row: these sheets carry a title block above
  // it. Find the row that names the criteria.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const hits = (rows[i] ?? []).filter((c) =>
      TITLES.criteria.test(norm(c)),
    ).length;
    if (hits >= 5) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return null;

  const header = rows[headerIdx] ?? [];
  const critCol = new Map<number, number>();
  let countCol: number | null = null;
  let recoveryCol: number | null = null;
  let mfCol: number | null = null;
  header.forEach((cell, i) => {
    const t = norm(cell);
    const m = TITLES.criteria.exec(t);
    // FIRST wins: the later releases repeat „Брой на критериите" once per year
    // in the window, and the anchor year's is the leftmost.
    if (m && !critCol.has(Number(m[1]))) critCol.set(Number(m[1]), i + 1);
    if (countCol == null && TITLES.count.test(t)) countCol = i + 1;
    if (recoveryCol == null && TITLES.recovery.test(t)) recoveryCol = i + 1;
    if (mfCol == null && TITLES.mfCode.test(t)) mfCol = i + 1;
  });

  if (critCol.size !== CRITERIA_COUNT) {
    warnings.push(
      `${sheetName}: found ${critCol.size} criteria columns, expected ${CRITERIA_COUNT} — not reading this sheet`,
    );
    return null;
  }
  if (mfCol == null) {
    warnings.push(`${sheetName}: no „Община код по ЕБК" column — not reading`);
    return null;
  }

  const out: OfficialCriteriaRow[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const raw = num(r?.[(mfCol as number) - 1]);
    if (raw == null || raw < 1000 || raw > 9999) continue;
    const mfCode = MF_ALIAS[raw] ?? raw;
    const met: number[] = [];
    for (let n = 1; n <= CRITERIA_COUNT; n++) {
      if (criterionMet(r[(critCol.get(n) as number) - 1])) met.push(n);
    }
    const officialCount =
      countCol == null ? null : num(r[(countCol as number) - 1]);
    // The ministry's count and the columns it is a count OF must agree. A gap
    // means we read the wrong columns, and publishing either half would be a
    // verdict about named municipalities built on a misread.
    if (officialCount != null && officialCount !== met.length) {
      warnings.push(
        `${sheetName}: mf ${mfCode} — МФ says ${officialCount} criteria met, ` +
          `its own columns say ${met.length}; row skipped`,
      );
      continue;
    }
    out.push({
      mfCode,
      met,
      officialCount,
      inRecovery:
        recoveryCol == null
          ? false
          : criterionMet(r[(recoveryCol as number) - 1]),
    });
  }
  if (out.length === 0) return null;
  return { fiscalYear, rows: out, warnings };
};
