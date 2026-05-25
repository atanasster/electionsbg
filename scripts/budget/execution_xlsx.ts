// Per-ministry program-budget execution report parser — XLSX variant.
//
// Some ministries (MLSP among them) publish their "Отчет за изпълнението на
// програмния бюджет" as an XLSX bundled inside a ZIP rather than as a
// formatted PDF. The columns are the same — Закон / Уточнен план / Отчет —
// but laid out across multiple quarter-end Отчет columns (Q1, H1, 9M, Y); the
// year-end value is the rightmost. And the unit total is not published as a
// row (no "Общо разходи" anchor); we compute it by summing the policy-area
// ".00" rows.
//
// Returns the same `ParsedExecutionUnit` shape as `execution_pdf.ts`, so the
// downstream fact-builder + reconciler are format-agnostic.

import * as XLSX from "xlsx";
import { toEur } from "../../src/lib/currency";
import type { Money } from "./types";
import type {
  ExecutionTriple,
  ParsedExecutionProgram,
  ParsedExecutionUnit,
} from "./execution_pdf";

const CODE_RE = /^\d{4}\.\d{2}\.\d{2}$/;

// Loose numeric coercion: XLSX cells come through as numbers when the source
// is a numeric cell; as strings when they were formatted text. Strings can
// carry stray whitespace from the spreadsheet ("  1 221 324  ").
const toMoney = (cell: unknown, currency: "BGN" | "EUR"): Money | null => {
  if (cell == null || cell === "") return null;
  let n: number;
  if (typeof cell === "number") {
    n = cell;
  } else {
    const cleaned = String(cell).replace(/\s/g, "").replace(",", ".");
    if (cleaned === "" || cleaned === "-" || cleaned === "—") return null;
    n = Number(cleaned);
  }
  if (!Number.isFinite(n)) return null;
  const amount = Math.round(n);
  if (currency === "EUR") return { amount, currency, amountEur: amount };
  const eur = toEur(amount, "BGN");
  return {
    amount,
    currency,
    amountEur: eur == null ? amount : Math.round(eur),
  };
};

// Header keyword match, tolerant of whitespace/case (same convention as the
// PDF parser's headerMatches).
const headerMatches = (cell: unknown, keyword: string): boolean =>
  String(cell ?? "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .includes(keyword.toLowerCase());

// Find Закон / Уточнен план / (rightmost) Отчет in the first ~6 rows of a
// sheet. The rightmost Отчет is the year-end cumulative value (Q4); earlier
// Отчет columns are Q1 / H1 / 9M.
interface ColIndices {
  law: number;
  amended: number;
  executed: number;
  headerRow: number;
}
const findValueColumns = (rows: unknown[][]): ColIndices | null => {
  let otchetOnly = { col: -1, row: -1 };
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const row = rows[r] ?? [];
    let law = -1;
    let amended = -1;
    let executed = -1;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (law < 0 && headerMatches(cell, "Закон")) law = c;
      else if (amended < 0 && headerMatches(cell, "Уточнен")) amended = c;
      else if (headerMatches(cell, "Отчет")) executed = c; // keep overwriting → rightmost
    }
    if (law >= 0 && amended >= 0 && executed >= 0 && law !== amended) {
      return { law, amended, executed, headerRow: r };
    }
    // Track rightmost Отчет-only candidate. Title rows often carry "Отчет"
    // at column 0 ("Отчет на разходите …") which we don't want — take the
    // largest column index we see across all rows.
    if (executed > otchetOnly.col && law < 0 && amended < 0) {
      otchetOnly = { col: executed, row: r };
    }
  }
  // МВнР-style fallback: only "Отчет" is labelled (Закон/Уточнен columns
  // exist with placeholder zeros but no header). Assume the three value
  // columns are consecutive ending at the labelled Отчет column.
  if (otchetOnly.col >= 2) {
    return {
      law: otchetOnly.col - 2,
      amended: otchetOnly.col - 1,
      executed: otchetOnly.col,
      headerRow: otchetOnly.row,
    };
  }
  return null;
};

const rowCode = (row: unknown[]): string | null => {
  for (const c of row) {
    const s = String(c ?? "").trim();
    if (CODE_RE.test(s)) return s;
  }
  return null;
};

const rowLabel = (row: unknown[]): string => {
  for (let i = 0; i < Math.min(row.length, 3); i++) {
    const s = String(row[i] ?? "").trim();
    if (s && !CODE_RE.test(s)) return s;
  }
  return "";
};

// Parse one ministry's program-budget execution XLSX. Throws when no sheet
// yields the expected columns — that is the "this ministry's report format
// drifted" signal.
export const parseExecutionXlsx = async (
  xlsxBytes: Uint8Array,
  fiscalYear: number,
): Promise<ParsedExecutionUnit> => {
  const currency: "BGN" | "EUR" = fiscalYear >= 2026 ? "EUR" : "BGN";
  const wb = XLSX.read(Buffer.from(xlsxBytes), { type: "buffer" });

  // Collect coded rows from every sheet that has the value-column header.
  // Use a Map keyed by code so we keep one entry per program (even if a
  // sheet repeats the policy-area summary in the per-programme breakdown).
  const programs = new Map<string, ParsedExecutionProgram>();
  let revenue: ExecutionTriple | null = null;
  const asOf = `${fiscalYear}-12-31`;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      blankrows: false,
      defval: null,
    }) as unknown[][];
    const cols = findValueColumns(rows);
    if (!cols) continue;

    // Revenue total (first sheet that carries it). Some ministries put it on
    // a dedicated sheet, others not at all — both OK; we synthesise nulls.
    if (!revenue) {
      const row = rows.find((r) => /^Общо приходи/i.test(rowLabel(r)));
      if (row) {
        revenue = {
          law: toMoney(row[cols.law], currency),
          amended: toMoney(row[cols.amended], currency),
          executed: toMoney(row[cols.executed], currency),
        };
      }
    }

    // Programmes: every coded row. .00 codes = policy area; others = leaf
    // budget programmes. Same convention as the PDF parser.
    for (const row of rows) {
      const code = rowCode(row);
      if (!code) continue;
      const law = toMoney(row[cols.law], currency);
      const amended = toMoney(row[cols.amended], currency);
      const executed = toMoney(row[cols.executed], currency);
      if (!law && !amended && !executed) continue;
      // first occurrence wins (the "Обл. пол." sheet, scanned first, has the
      // policy-area level which is the safest source of truth for sums)
      if (programs.has(code)) continue;
      programs.set(code, {
        code,
        nameBg: rowLabel(row),
        isPolicyArea: code.endsWith(".00"),
        law,
        amended,
        executed,
      });
    }
  }

  if (programs.size === 0) {
    throw new Error(
      `execution xlsx ${fiscalYear}: no rows with classification codes — ` +
        `the spreadsheet's structure likely changed`,
    );
  }

  // Sum policy-area rows for the unit total. (XLSX MLSP reports don't carry
  // an "Общо разходи" row; the policy-area sums ARE the ministry total.)
  const sumOver = (
    pick: (p: ParsedExecutionProgram) => Money | null,
  ): Money | null => {
    let total = 0;
    let totalEur = 0;
    let found = 0;
    for (const p of programs.values()) {
      if (!p.isPolicyArea) continue;
      const m = pick(p);
      if (!m) continue;
      total += m.amount;
      totalEur += m.amountEur;
      found++;
    }
    if (found === 0) return null;
    return { amount: total, currency, amountEur: totalEur };
  };
  const expenditure: ExecutionTriple = {
    law: sumOver((p) => p.law),
    amended: sumOver((p) => p.amended),
    executed: sumOver((p) => p.executed),
  };
  if (!expenditure.amended && !expenditure.executed) {
    throw new Error(
      `execution xlsx ${fiscalYear}: could not compute expenditure total ` +
        `from policy-area rows (${programs.size} programme rows seen)`,
    );
  }

  return {
    fiscalYear,
    asOf,
    currency,
    revenue: revenue ?? { law: null, amended: null, executed: null },
    expenditure,
    programs: [...programs.values()],
  };
};
