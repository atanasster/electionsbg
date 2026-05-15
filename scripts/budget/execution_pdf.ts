// Per-ministry program-budget execution report parser.
//
// Each first-level spending unit publishes its own "Отчет за изпълнението на
// програмния бюджет" PDF. Section I carries the appendices we need, each with
// three value columns — Закон / Уточнен план / Отчет = law / amended / executed:
//   - Приложение № 1  — revenue           ("Общо приходи" is the unit total)
//   - Приложение № 2а — expenditure by policy area / budget programme, keyed by
//                       the МФ classification code (e.g. 2000.01.01); the
//                       "Общо разходи по бюджета на <unit>" row is the unit total
//
// Amounts are in whole leva (the header says "в лева") — unlike the State
// Budget Law tables, which are in thousands. 2026+ reports switch to euro.
//
// The PDF tables are ruled grids; pdf_table.ts turns them into string[][].

import { extractTables } from "./pdf_table";
import { toEur } from "../../src/lib/currency";
import type { Money } from "./types";

// Three-stage figure for one row of an appendix.
export interface ExecutionTriple {
  law: Money | null; // Закон
  amended: Money | null; // Уточнен план
  executed: Money | null; // Отчет
}

// One classified line of Приложение № 2а.
export interface ParsedExecutionProgram {
  code: string; // "2000.01.01" — the МФ administrative+programme code
  nameBg: string;
  // ".00" codes are policy areas (области на политика); the rest are budget
  // programmes. The reconciler joins programmes; policy areas are context.
  isPolicyArea: boolean;
  law: Money | null;
  amended: Money | null;
  executed: Money | null;
}

export interface ParsedExecutionUnit {
  fiscalYear: number;
  asOf: string; // ISO — the execution cut-off ("Отчет към <date>")
  currency: "BGN" | "EUR";
  revenue: ExecutionTriple; // Приложение № 1 — "Общо приходи"
  expenditure: ExecutionTriple; // Приложение № 2а — "Общо разходи по бюджета на …"
  programs: ParsedExecutionProgram[];
}

const CODE_RE = /^\d{4}\.\d{2}\.\d{2}$/;

// "1 221 324" / "- 867 000" / "0" / "" → whole leva. The extractor sometimes
// leaves stray spaces inside a number (positionally-split glyphs); stripping
// all whitespace is safe because these figures have no decimal part.
const toMoney = (
  cell: string | undefined,
  currency: "BGN" | "EUR",
): Money | null => {
  if (cell == null) return null;
  const cleaned = cell.replace(/\s/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "—") return null;
  const n = Number(cleaned.replace(",", "."));
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

// Locate the law / amended / executed value columns by scanning the first few
// rows for the header keywords. The extractor sometimes leaves positional gaps
// inside words ("Уточне н план") so we strip internal whitespace before the
// match. Returns null when the table has no such header.
const headerMatches = (cell: string, keyword: string): boolean =>
  cell.replace(/\s+/g, "").toLowerCase().includes(keyword.toLowerCase());

const findValueColumns = (
  rows: string[][],
): {
  law: number;
  amended: number;
  executed: number;
  headerRow: number;
} | null => {
  for (let r = 0; r < Math.min(rows.length, 4); r++) {
    const row = rows[r];
    let law = -1;
    let amended = -1;
    let executed = -1;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (law < 0 && headerMatches(cell, "Закон")) law = c;
      else if (amended < 0 && headerMatches(cell, "Уточнен")) amended = c;
      else if (executed < 0 && headerMatches(cell, "Отчет")) executed = c;
    }
    if (law >= 0 && amended >= 0 && executed >= 0 && law !== amended) {
      return { law, amended, executed, headerRow: r };
    }
  }
  return null;
};

// First non-empty label cell in a row (columns 0..1 — code rows put the label
// in col 1, plain rows in col 0).
const rowLabel = (row: string[]): string =>
  (row.find((c, i) => i <= 1 && c && !CODE_RE.test(c.trim())) ?? "").trim();

const rowCode = (row: string[]): string | null => {
  const hit = row.find((c) => CODE_RE.test(c.trim()));
  return hit ? hit.trim() : null;
};

// "Отчет към 31.12.2024 г." → "2024-12-31". Falls back to year-end. The
// extractor can leave stray spaces inside the digits ("31.12.202 4"), so strip
// whitespace before matching.
const parseAsOf = (text: string, fiscalYear: number): string => {
  const m = text.replace(/\s/g, "").match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return `${fiscalYear}-12-31`;
};

// Parse one ministry's program-budget execution PDF. Throws when the report
// structure does not yield the unit's revenue + expenditure totals — that is
// the "this ministry's report format drifted" signal.
export const parseExecutionPdf = async (
  pdfBytes: Uint8Array,
  fiscalYear: number,
): Promise<ParsedExecutionUnit> => {
  const tables = await extractTables(pdfBytes);

  // Bulgaria switched BGN→EUR on 2026-01-01, so FY2026+ reports are in euro and
  // everything earlier is in leva. The fiscal year is unambiguous; the header
  // "(в лева)" text is not (the narrative mentions euro in changeover years).
  const currency: "BGN" | "EUR" = fiscalYear >= 2026 ? "EUR" : "BGN";

  // The unit totals and the programme breakdown are found independently —
  // ministries lay out the appendices differently (some put the programme
  // table in the consolidated Прил.2б form with no law/amended/executed
  // columns), but the two headline totals are reliably present:
  //   - revenue total      — a value-column table with a "Общо приходи …" row
  //   - expenditure total  — a value-column table with a "Общо разходи …" row
  //                          (the unit's own budget — "по бюджета на ПРБ")
  // Programmes are best-effort: the first value-column table that also carries
  // classification-code rows. The admin grain never depends on it.
  let revenue: ExecutionTriple | null = null;
  let expenditure: ExecutionTriple | null = null;
  let asOf = `${fiscalYear}-12-31`;

  const tripleFrom = (
    row: string[],
    cols: { law: number; amended: number; executed: number },
  ): ExecutionTriple => ({
    law: toMoney(row[cols.law], currency),
    amended: toMoney(row[cols.amended], currency),
    executed: toMoney(row[cols.executed], currency),
  });

  for (const t of tables) {
    const cols = findValueColumns(t.rows);
    if (!cols) continue;
    if (!revenue) {
      const row = t.rows.find((r) => /^Общо приходи/i.test(rowLabel(r)));
      if (row) {
        revenue = tripleFrom(row, cols);
        asOf = parseAsOf(
          t.rows[cols.headerRow][cols.executed] ?? "",
          fiscalYear,
        );
      }
    }
    if (!expenditure) {
      const row = t.rows.find((r) => /^Общо разходи/i.test(rowLabel(r)));
      if (row) expenditure = tripleFrom(row, cols);
    }
    if (revenue && expenditure) break;
  }

  // --- programmes (best-effort): first value-column table with code rows,
  // plus header-less continuation tables on the following pages. ---
  const programs: ParsedExecutionProgram[] = [];
  for (let ti = 0; ti < tables.length; ti++) {
    const t = tables[ti];
    const cols = findValueColumns(t.rows);
    if (!cols || !t.rows.some((r) => rowCode(r))) continue;

    const collectFrom = (rows: string[][]): void => {
      for (const row of rows) {
        const code = rowCode(row);
        if (!code) continue;
        const triple = tripleFrom(row, cols);
        if (!triple.law && !triple.amended && !triple.executed) continue;
        programs.push({
          code,
          nameBg: rowLabel(row),
          isPolicyArea: code.endsWith(".00"),
          ...triple,
        });
      }
    };
    collectFrom(t.rows);
    let lastPage = t.page;
    for (let cont = ti + 1; cont < tables.length; cont++) {
      const nt = tables[cont];
      if (nt.page > lastPage + 1) break;
      if (
        nt.rows[0]?.length === t.rows[0]?.length &&
        !findValueColumns(nt.rows) &&
        nt.rows.some((r) => rowCode(r))
      ) {
        collectFrom(nt.rows);
        lastPage = nt.page;
      } else {
        break;
      }
    }
    break;
  }

  // Expenditure total is the headline — required. Revenue is best-effort:
  // smaller units genuinely have no own revenue and the row is absent; we
  // synthesise an all-null triple so the rest of the pipeline doesn't care.
  if (!revenue) {
    revenue = { law: null, amended: null, executed: null };
  }
  if (!expenditure) {
    throw new Error(
      `execution report ${fiscalYear}: could not locate the ` +
        `${!expenditure ? "expenditure (Общо разходи)" : ""} ` +
        `total — the report's table structure likely changed`,
    );
  }

  return { fiscalYear, asOf, currency, revenue, expenditure, programs };
};
