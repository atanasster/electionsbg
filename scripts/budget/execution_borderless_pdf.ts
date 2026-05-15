// Per-ministry program-budget execution report parser — borderless-PDF variant.
//
// Some ministries (MOD among them) publish their "Отчет за изпълнението на
// програмния бюджет" as a PDF whose tables are laid out by text positioning
// only — no cell-border rectangles are drawn. The border-aware extractor in
// `pdf_table.ts` is blind to these. `pdf2array` (which clusters text by line)
// reads them well enough because the cells are single-line: each programme
// row is `code | name | Закон | Уточнен план | Отчет Q1 | Отчет H1 | Отчет 9M
// | Отчет Y`. Some rows lose the name when it wraps onto a separate text
// line, so the column structure is detected positionally from the trailing
// numeric cells instead of by header matching.
//
// Returns the same `ParsedExecutionUnit` shape as `execution_pdf.ts` /
// `execution_xlsx.ts`. The fact-builder + reconciler are format-agnostic.

import { pdf2array } from "pdf2array";
import { toEur } from "../../src/lib/currency";
import type { Money } from "./types";
import type {
  ExecutionTriple,
  ParsedExecutionProgram,
  ParsedExecutionUnit,
} from "./execution_pdf";

const CODE_RE = /^\d{4}\.\d{2}\.\d{2}$/;
const NUM_RE = /^-?\d[\d  ]*$/;

const toMoney = (cell: string, currency: "BGN" | "EUR"): Money | null => {
  const cleaned = cell.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "" || cleaned === "-" || cleaned === "—") return null;
  const n = Number(cleaned);
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

interface BorderlessOpts {
  // How many trailing numeric cells a programme row carries. Positional
  // convention: `[law, amended, ...intermediate Отчет cols, executed]`. For
  // the standard "quarterly cumulative" layout the count is 6 (law, amended,
  // Q1, H1, 9M, Y); for simpler layouts the count can be lower.
  trailingValueCount: number;
}

// Parse one ministry's program-budget execution PDF whose tables are
// borderless (text-positional). Throws when no programme rows are found.
export const parseBorderlessExecutionPdf = async (
  pdfBytes: Uint8Array,
  fiscalYear: number,
  opts: BorderlessOpts,
): Promise<ParsedExecutionUnit> => {
  const currency: "BGN" | "EUR" = fiscalYear >= 2026 ? "EUR" : "BGN";
  const rows = await pdf2array(new Uint8Array(pdfBytes));

  // Walk every row; keep those that look like `code + ≥trailingValueCount
  // numeric cells`. The numeric cells are the rightmost cells of the row;
  // the label (when present) is the cells between the code and the numbers.
  const programs = new Map<string, ParsedExecutionProgram>();

  const triple = (
    nums: string[],
  ): { law: Money | null; amended: Money | null; executed: Money | null } => {
    // positional convention: [law, amended, ...rest, executed]
    const law = toMoney(nums[0] ?? "", currency);
    const amended = toMoney(nums[1] ?? "", currency);
    const executed = toMoney(nums[nums.length - 1] ?? "", currency);
    return { law, amended, executed };
  };

  for (const row of rows) {
    let codeIdx = -1;
    let code: string | null = null;
    for (let i = 0; i < row.length; i++) {
      const c = (row[i] ?? "").trim();
      if (CODE_RE.test(c)) {
        codeIdx = i;
        code = c;
        break;
      }
    }
    if (!code || codeIdx < 0) continue;

    // Find the run of trailing numeric cells (a programme row ends in N
    // numbers). Skip blank cells defensively.
    const trailingNumbers: string[] = [];
    for (let i = row.length - 1; i > codeIdx; i--) {
      const c = (row[i] ?? "").trim();
      if (c === "") continue;
      if (NUM_RE.test(c)) {
        trailingNumbers.unshift(c);
      } else {
        break;
      }
    }
    if (trailingNumbers.length < opts.trailingValueCount) continue;
    // If pdf2array picked up MORE numbers than expected (unusual layout
    // variant), trim to the expected count from the right — the executed
    // (year-end) is the rightmost regardless.
    const used = trailingNumbers.slice(-opts.trailingValueCount);

    // Label = whatever non-empty text cells sit between code and the numbers.
    const labelParts: string[] = [];
    for (let i = codeIdx + 1; i < row.length - used.length; i++) {
      const c = (row[i] ?? "").trim();
      if (c && !NUM_RE.test(c)) labelParts.push(c);
    }
    const t = triple(used);
    if (!t.law && !t.amended && !t.executed) continue;
    // First occurrence wins (some ministries' reports repeat a programme
    // row across sub-tables; the policy-area level on page 1 is canonical).
    if (programs.has(code)) continue;
    programs.set(code, {
      code,
      nameBg: labelParts.join(" "),
      isPolicyArea: code.endsWith(".00"),
      law: t.law,
      amended: t.amended,
      executed: t.executed,
    });
  }

  if (programs.size === 0) {
    throw new Error(
      `borderless execution pdf ${fiscalYear}: no programme rows with ` +
        `${opts.trailingValueCount}+ trailing numbers — the report's text ` +
        `layout likely changed`,
    );
  }

  // Sum policy-area .00 rows for the unit total. Same convention as the XLSX
  // parser — borderless PDFs typically lack a "Общо разходи" anchor row.
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
      `borderless execution pdf ${fiscalYear}: could not compute the unit ` +
        `expenditure total from policy-area rows ` +
        `(${programs.size} programme rows seen)`,
    );
  }

  return {
    fiscalYear,
    asOf: `${fiscalYear}-12-31`,
    currency,
    revenue: { law: null, amended: null, executed: null },
    expenditure,
    programs: [...programs.values()],
  };
};
