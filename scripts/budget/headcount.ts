// Per-ministry, per-programme headcount extractor for the budget pipeline.
//
// Bulgarian ministries publish staffing data ("Численост на щатния персонал")
// in the same "Отчет за изпълнението на програмния бюджет" reports that carry
// their financial execution data. This module mirrors `execution_pdf.ts` /
// `execution_xlsx.ts` but extracts the staffing row alongside the financial
// rows.
//
// The staffing row sits inside each programme's appendix table and carries
// three columns (PDF) or six (XLSX) — the same Закон | Уточнен план | Отчет
// layout as the financial rows. We pair each programme's staffing with its
// Персонал financial line to derive the average personnel cost per FTE.
//
// Output: `ParsedHeadcountUnit` — one entry per programme, three integer
// triples (law / amended / executed) for headcount AND personnel.
//
// MOD's borderless PDF labels headcount rows but omits the numbers
// (defence — classified). The parser returns an empty list for such reports;
// the orchestrator notes this as expected, not a parser failure.

import * as XLSX from "xlsx";
import { extractTables } from "./pdf_table";
import type { Money } from "./types";
import { toEur } from "../../src/lib/currency";

// ---------- types ----------

export interface HeadcountTriple {
  law: number | null;
  amended: number | null;
  executed: number | null;
}

export interface ParsedHeadcountProgramme {
  code: string; // МФ classification code, e.g. "1600.01.01"
  nameBg: string;
  headcount: HeadcountTriple; // щатни бройки (positions)
  personnel: {
    law: Money | null;
    amended: Money | null;
    executed: Money | null;
  };
  // executed personnel ÷ executed headcount — average annual cost per FTE
  // (includes employer social-security contributions). Null when either side
  // is missing.
  avgAnnualCostPerFte: Money | null;
}

export interface ParsedHeadcountUnit {
  fiscalYear: number;
  currency: "BGN" | "EUR";
  programmes: ParsedHeadcountProgramme[];
}

// ---------- shared utilities ----------

const CODE_RE = /\b(\d{4}\.\d{2}\.\d{2})\b/;

// Parse a row's last three positional cells as Закон | Уточнен план | Отчет.
const parseTripleFromCells = (
  cells: (string | null | undefined)[],
): HeadcountTriple => {
  const cleaned = cells.map((c) =>
    c == null ? "" : String(c).replace(/\s+/g, "").replace(",", "."),
  );
  const toN = (s: string): number | null => {
    if (!s || s === "-" || s === "—") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  return {
    law: toN(cleaned[0]),
    amended: toN(cleaned[1]),
    executed: toN(cleaned[2]),
  };
};

const trailing3 = (row: (string | null | undefined)[]): string[] =>
  row.slice(-3).map((c) => String(c ?? ""));

// "1500.01.01 Бюджетна програма «X»" header detection. The PDF extractor
// sometimes splits the leading digits ("1 600.01.04") so we collapse
// digit-space-digit pairs before matching.
const programmeHeader = (
  row: (string | null | undefined)[],
): { code: string; nameBg: string } | null => {
  const joined = row.map((c) => String(c ?? "")).join(" ");
  if (!/Бюджетна\s+програма/i.test(joined)) return null;
  const collapsed = joined.replace(/(\d)\s+(\d)/g, "$1$2");
  const m = collapsed.match(CODE_RE);
  if (!m) return null;
  const nameCell =
    row
      .map((c) => String(c ?? ""))
      .filter((c) => c && /програма/i.test(c))
      .map((c) => c.replace(/\s+/g, " ").trim())
      .sort((a, b) => b.length - a.length)[0] ?? "";
  const nameBg = nameCell
    .replace(/^\s*[\d\s]+\.\d{2}\.\d{2}\s*/, "")
    .replace(/^Бюджетна\s+програма\s*[„"]?/i, "")
    .replace(/[„"”]?\s*$/, "")
    .trim();
  return { code: m[1], nameBg };
};

// Carry-state across tables. Programme appendices span multiple ruled tables;
// the code header sits in one table, the expenditure body in another, the
// headcount in yet another.
interface ScanState {
  code: string | null;
  nameBg: string;
  personnel: HeadcountTriple | null;
}

const newState = (): ScanState => ({
  code: null,
  nameBg: "",
  personnel: null,
});

const toMoney = (n: number | null, currency: "BGN" | "EUR"): Money | null => {
  if (n == null) return null;
  const amount = Math.round(n);
  if (currency === "EUR") return { amount, currency, amountEur: amount };
  const eur = toEur(amount, "BGN");
  return {
    amount,
    currency,
    amountEur: eur == null ? amount : Math.round(eur),
  };
};

const personnelTriple = (
  t: HeadcountTriple,
  currency: "BGN" | "EUR",
): { law: Money | null; amended: Money | null; executed: Money | null } => ({
  law: toMoney(t.law, currency),
  amended: toMoney(t.amended, currency),
  executed: toMoney(t.executed, currency),
});

const computeAvgCost = (
  personnel: Money | null,
  headcount: number | null,
  currency: "BGN" | "EUR",
): Money | null => {
  if (!personnel || headcount == null || headcount <= 0) return null;
  const amount = Math.round(personnel.amount / headcount);
  const amountEur = Math.round(personnel.amountEur / headcount);
  return { amount, amountEur, currency };
};

// ---------- bordered-PDF parser ----------

export const parseHeadcountFromExecutionPdf = async (
  pdfBytes: Uint8Array,
  fiscalYear: number,
): Promise<ParsedHeadcountUnit> => {
  const tables = await extractTables(pdfBytes);
  const currency: "BGN" | "EUR" = fiscalYear >= 2026 ? "EUR" : "BGN";
  const programmes: ParsedHeadcountProgramme[] = [];
  let state = newState();

  const flush = (headcount: HeadcountTriple): void => {
    if (state.code && state.personnel) {
      const pers = personnelTriple(state.personnel, currency);
      programmes.push({
        code: state.code,
        nameBg: state.nameBg,
        headcount,
        personnel: pers,
        avgAnnualCostPerFte: computeAvgCost(
          pers.executed,
          headcount.executed,
          currency,
        ),
      });
    }
    state.personnel = null;
  };

  for (const t of tables) {
    for (const row of t.rows) {
      const header = programmeHeader(row);
      if (header) {
        state = { ...newState(), ...header };
        continue;
      }
      const label = row.find((c) => c && c.trim() !== "")?.trim() ?? "";
      // Персонал first occurrence after a programme header = the consolidated
      // "Общо ведомствени → Персонал" total (the headcount denominator).
      if (state.code && state.personnel == null && /^Персонал$/i.test(label)) {
        const triple = parseTripleFromCells(trailing3(row));
        if (
          triple.law != null ||
          triple.amended != null ||
          triple.executed != null
        ) {
          state.personnel = triple;
        }
      }
      if (state.code && /Численост на щатния персонал/i.test(label)) {
        flush(parseTripleFromCells(trailing3(row)));
      }
    }
  }

  return { fiscalYear, currency, programmes };
};

// ---------- XLSX parser (МТСП format) ----------

const findXlsxValueColumns = (
  rows: unknown[][],
): { law: number; amended: number; executed: number } | null => {
  let otchetOnly = -1;
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r] ?? [];
    let law = -1;
    let amended = -1;
    let executed = -1;
    for (let c = 0; c < row.length; c++) {
      const s = String(row[c] ?? "")
        .replace(/\s+/g, "")
        .toLowerCase();
      if (law < 0 && s.includes("закон")) law = c;
      else if (amended < 0 && s.includes("уточнен")) amended = c;
      else if (s.includes("отчет")) executed = c; // overwrite → rightmost wins
    }
    if (law >= 0 && amended >= 0 && executed >= 0 && law !== amended) {
      return { law, amended, executed };
    }
    // Track the right-most Отчет-only column for the fallback. Title rows
    // often contain the word "Отчет" at column 0 ("Отчет на ведомствените
    // разходи…"); the actual header row has it at column 3+. Take the
    // largest column index we see.
    if (executed > otchetOnly && law < 0 && amended < 0) {
      otchetOnly = executed;
    }
  }
  // МВнР's "Програми" sheet labels only the Отчет column; Закон / Уточнен
  // are present as columns but unlabelled. Fall back to assuming the three
  // value columns are consecutive ending at the labelled Отчет column.
  if (otchetOnly >= 2) {
    return {
      law: otchetOnly - 2,
      amended: otchetOnly - 1,
      executed: otchetOnly,
    };
  }
  return null;
};

const toNum = (cell: unknown): number | null => {
  if (cell == null || cell === "") return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  const s = String(cell).replace(/\s+/g, "").replace(",", ".");
  if (s === "" || s === "-" || s === "—") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export const parseHeadcountFromExecutionXlsx = (
  xlsxBytes: Uint8Array,
  fiscalYear: number,
): ParsedHeadcountUnit => {
  const wb = XLSX.read(Buffer.from(xlsxBytes), { type: "buffer" });
  const currency: "BGN" | "EUR" = fiscalYear >= 2026 ? "EUR" : "BGN";
  // МТСП uses sheet name "Прогр."; МВнР uses "Програми". Try both before
  // falling back to the first sheet (which may be a policy-area rollup
  // rather than the per-programme detail we want).
  const sheet =
    wb.Sheets["Прогр."] ?? wb.Sheets["Програми"] ?? wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  }) as unknown[][];

  const cols = findXlsxValueColumns(rows);
  if (!cols) return { fiscalYear, currency, programmes: [] };

  const programmes: ParsedHeadcountProgramme[] = [];
  let state = newState();

  const flush = (headcount: HeadcountTriple): void => {
    if (state.code && state.personnel) {
      const pers = personnelTriple(state.personnel, currency);
      programmes.push({
        code: state.code,
        nameBg: state.nameBg,
        headcount,
        personnel: pers,
        avgAnnualCostPerFte: computeAvgCost(
          pers.executed,
          headcount.executed,
          currency,
        ),
      });
    }
    state.personnel = null;
  };

  for (const row of rows) {
    const header = programmeHeader(row.map((c) => String(c ?? "")));
    if (header) {
      state = { ...newState(), ...header };
      continue;
    }

    // Ministry-wide consolidated section at end ("Общо разходи по бюджетните
    // програми на …") — its Персонал/Численост rows are not a programme.
    const joinedLow = row
      .map((c) => String(c ?? ""))
      .join(" ")
      .toLowerCase();
    if (/общо разходи по бюджетните програми на/.test(joinedLow)) {
      state = newState();
      continue;
    }

    const label =
      row
        .find((c) => c != null && String(c).trim() !== "")
        ?.toString()
        .trim() ?? "";

    const tripleFromXlsxRow = (): HeadcountTriple => ({
      law: toNum(row[cols.law]),
      amended: toNum(row[cols.amended]),
      executed: toNum(row[cols.executed]),
    });

    if (state.code && state.personnel == null && /^Персонал$/i.test(label)) {
      const triple = tripleFromXlsxRow();
      if (
        triple.law != null ||
        triple.amended != null ||
        triple.executed != null
      ) {
        state.personnel = triple;
      }
    }
    if (state.code && /Численост на щатния персонал/i.test(label)) {
      flush(tripleFromXlsxRow());
    }
  }

  return { fiscalYear, currency, programmes };
};
