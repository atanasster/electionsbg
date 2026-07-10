// Parser for НЗОК's "Справка 5" monthly antineoplastic/coagulopathy drug files
// (nhif.bg/bg/nzok/medicine/5). Each file is a legacy cp1251 .xls with ONE sheet
// named for the period ("05.2026"): row 0 is the title, row 1 the header, data
// from row 2. ~18.8k rows for a recent month.
//
// The parser is intentionally currency-agnostic: it returns the NATIVE reimbursed
// amount (BGN through 2025, EUR from 2026) and leaves the EUR conversion to the
// writer, which knows the period year. This keeps the parser pure + unit-testable.
//
// xls MUST be read via `XLSX.read(buf, {type:"buffer", codepage:1251})` —
// `xlsx.readFile` is disabled in the bundled xlsx and these files are cp1251.

import * as xlsx from "xlsx";

/** One source row (facility × pack × МКБ code) with the native reimbursed sum. */
export interface DrugUnitPriceRow {
  /** РЦЗ — the 10-digit Рег.№ ЛЗ; joins hospital_eik.json 1:1. */
  regNo: string;
  facility: string;
  atc: string;
  inn: string;
  /** Национален № as a string ("" when the source leaves it blank/0). */
  nationalNo: string;
  nzokCode: string;
  tradeName: string;
  form: string;
  /** Колич. на лекарственото в-во (dose text, e.g. "300 mcg/0,6 ml"). */
  strength: string;
  /** Брой в опаковка — units per pack. */
  packSize: number;
  /** МКБ код — the case-mix denominator, present on every row. */
  icd: string;
  diagnosis: string;
  /** Брой на ЗОЛ-броени за периода — distinct insured persons. */
  patients: number;
  /** Опаковки — packs dispensed (can be fractional, e.g. 0.7). */
  packs: number;
  /** Реимбурсна сума — NATIVE currency (BGN ≤2025, EUR ≥2026). */
  amount: number;
}

// Column indices, from the row-1 header (verified against 05.2026):
// 0 РЦЗ | 1 lech.zavedenie | 2 ATC | 3 INN | 4 Национален № | 5 НЗОК код |
// 6 trade name | 7 form | 8 strength | 9 Брой в опаковка | 10 МКБ | 11 diagnosis |
// 12 Брой на ЗОЛ | 13 Опаковки | 14 Реимбурсна сума
const COL = {
  regNo: 0,
  facility: 1,
  atc: 2,
  inn: 3,
  nationalNo: 4,
  nzokCode: 5,
  tradeName: 6,
  form: 7,
  strength: 8,
  packSize: 9,
  icd: 10,
  diagnosis: 11,
  patients: 12,
  packs: 13,
  amount: 14,
} as const;

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
// Cp1251 numbers usually parse via Number(); a stray decimal comma ("0,7") from a
// text-typed cell would otherwise NaN, so swallow the comma too.
const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  const n = Number(str(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

/** Derive the file's period from the sheet name ("05.2026" monthly | "2025"
 *  annual), falling back to the "за периода … --DD.MM.YYYYг." span in the title
 *  row when the sheet is named something else. Returns "" if neither resolves. */
const derivePeriod = (
  sheetName: string,
  titleRow: unknown[] | undefined,
): string => {
  const s = sheetName.trim();
  if (/^\d{2}\.\d{4}$/.test(s) || /^\d{4}$/.test(s)) return s;
  const title = str(titleRow?.[0]);
  // "... --31.05.2026г." → the end date carries the month + year.
  const m = title.match(/--\s*\d{2}\.(\d{2})\.(\d{4})/);
  if (m) return `${m[1]}.${m[2]}`;
  return s;
};

/**
 * Parse a Справка 5 .xls buffer into its period + native-currency rows.
 * Rows with a non-finite reimbursed amount are dropped (the writer applies the
 * economic guards — non-positive packs / packSize / amount — where it computes
 * unit prices, so they stay visible there).
 */
export const parseSpravka5 = (
  buf: Buffer,
): { period: string; rows: DrugUnitPriceRow[] } => {
  const wb = xlsx.read(buf, { type: "buffer", codepage: 1251 });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
  }) as unknown[][];
  const period = derivePeriod(wb.SheetNames[0], raw[0]);

  const rows: DrugUnitPriceRow[] = [];
  // Data starts at row 2 (0 title, 1 header).
  for (let i = 2; i < raw.length; i++) {
    const r = raw[i];
    if (!r) continue;
    const regNo = str(r[COL.regNo]);
    const amount = num(r[COL.amount]);
    // A blank РЦЗ or an unparseable amount is a footnote / stray total row, not a
    // dispensing record — skip it.
    if (!regNo || !Number.isFinite(amount)) continue;
    const natRaw = str(r[COL.nationalNo]);
    rows.push({
      regNo,
      facility: str(r[COL.facility]),
      atc: str(r[COL.atc]),
      inn: str(r[COL.inn]),
      // The source stores a blank Национален № as "" or 0 — normalize both to ""
      // so the writer's НЗОК-код fallback fires.
      nationalNo: natRaw === "0" ? "" : natRaw,
      nzokCode: str(r[COL.nzokCode]),
      tradeName: str(r[COL.tradeName]),
      form: str(r[COL.form]),
      strength: str(r[COL.strength]),
      packSize: num(r[COL.packSize]),
      icd: str(r[COL.icd]),
      diagnosis: str(r[COL.diagnosis]),
      patients: num(r[COL.patients]),
      packs: num(r[COL.packs]),
      amount,
    });
  }
  return { period, rows };
};
