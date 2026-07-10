// Parser for НЗОК's monthly "Брой случаи и брой ЗОЛ по КП/АПр/КПр с основна и
// допълнителна диагноза" activity files (nhif.bg/bg/hospitalcare-report/activities
// /{year}). Each file is a single-sheet .xlsx ("Данни за <Месец> <Year>"): row 0
// is the title, row 1 the header, data from row 2. ~104k rows for a recent month,
// at the (facility × procedure × primary-ICD × secondary-ICD) grain.
//
// This corpus is the CASE-MIX DENOMINATOR the health pack lacks — cases and
// insured-persons (ЗОЛ) per clinical pathway (КП) / ambulatory procedure (АПр) /
// clinical procedure (КПр) per facility. It supplies (a) national procedure
// volumes, (b) per-hospital case-mix, and (c) a pathway-internal cases-per-bed
// outlier that needs no black-box model because the comparison is within one
// pathway. See docs/plans/nzok-hospital-intelligence-v1.md Phase 3.
//
// The file is keyed by facility NAME (Име ЛЗБП), not Рег.№ ЛЗ — the EIK crosswalk
// is therefore a name fold, resolved downstream where Postgres is available.
//
// The parser is intentionally lean: it folds the (procedure × ICD × ICD) grain up
// to (facility, procedure), summing cases + ЗОЛ across every diagnosis the
// facility reported the procedure under, because unit-of-analysis here is the
// procedure, not the diagnosis pair. Keeping the diagnosis grain would 20× the
// row count for no signal the pack uses.

import * as xlsx from "xlsx";
import { BG_MONTHS } from "./bg_months";

/** One facility's volume on one procedure in the file's period, summed across the
 *  primary/secondary diagnosis pairs the source splits it into. */
export interface ActivityRow {
  /** РЗОК region code, two digits ("01"…"28"). */
  rzok: string;
  /** Име ЛЗБП — the facility name (the only facility key the source carries). */
  facility: string;
  /** КП/АПр/КПр code ("A19", "P265.1", "K03"). */
  procedure: string;
  /** Брой случаи — reported cases. */
  cases: number;
  /** Брой ЗОЛ — insured persons (a person can recur across procedures/months). */
  zol: number;
}

// Column indices, from the row-1 header (verified against м. 12.2025):
// 0 РЗОК | 1 Име ЛЗБП | 2 КП/АПр/КПр | 3 Основна диагноза | 4 Вторична диагноза |
// 5 Брой случаи | 6 Брой ЗОЛ
const COL = {
  rzok: 0,
  facility: 1,
  procedure: 2,
  cases: 5,
  zol: 6,
} as const;

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
// cases/ЗОЛ are integer counts; xlsx returns them as JS numbers, so the string
// path is defensive only. Strip whitespace (incl. non-breaking) and a thousands
// separator before parsing — but keep a lone comma as a decimal separator (the
// BG convention) so a genuine fractional cell is not silently truncated.
// Exported for unit testing (the comma handling is subtle).
export const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  const cleaned = str(v)
    .replace(/\s/g, "")
    .replace(/,(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

/** Derive "MM.YYYY" from a sheet name like "Данни за Декември 2025". Returns ""
 *  when neither a month name nor a year is found. */
export const derivePeriod = (sheetName: string): string => {
  const s = sheetName.toLowerCase();
  const year = s.match(/\b(20\d{2})\b/)?.[1];
  const month = Object.keys(BG_MONTHS).find((m) => s.includes(m));
  if (!year || !month) return "";
  return `${String(BG_MONTHS[month]).padStart(2, "0")}.${year}`;
};

/**
 * Parse an activities .xlsx buffer into its period + folded (facility, procedure)
 * rows. A row with a blank facility or procedure, or a title/total row, is
 * skipped. Cases/ЗОЛ are summed across diagnoses.
 */
export const parseActivities = (
  buf: Buffer,
): { period: string; rows: ActivityRow[] } => {
  const wb = xlsx.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
  }) as unknown[][];
  const period = derivePeriod(wb.SheetNames[0]);

  // (facility \x00 procedure) → aggregate. \x00 can never appear in the source
  // text, so it is a collision-free composite key.
  const groups = new Map<string, ActivityRow>();
  // Data starts at row 2 (0 title, 1 header).
  for (let i = 2; i < raw.length; i++) {
    const r = raw[i];
    if (!r) continue;
    const facility = str(r[COL.facility]);
    const procedure = str(r[COL.procedure]);
    if (!facility || !procedure) continue;
    const cases = num(r[COL.cases]);
    const zol = num(r[COL.zol]);
    const key = `${facility}\x00${procedure}`;
    let g = groups.get(key);
    if (!g) {
      g = { rzok: str(r[COL.rzok]), facility, procedure, cases: 0, zol: 0 };
      groups.set(key, g);
    }
    g.cases += cases;
    g.zol += zol;
  }
  return { period, rows: [...groups.values()] };
};
