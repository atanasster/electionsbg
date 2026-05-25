// Per-ministry program-budget execution report parser — DOCX variant.
//
// Some ministries (MZH among them) publish their "Отчет за изпълнението на
// програмния бюджет" as a .docx file. The DOCX format is OOXML (zipped
// XML); tables live in `word/document.xml` as `<w:tbl>` elements containing
// `<w:tr>` rows whose `<w:tc>` cells hold runs of `<w:t>` text. We extract
// the same table structure as the PDF / XLSX parsers and reuse the same
// "find header columns + walk for Общо приходи / Общо разходи / programme
// codes" logic.
//
// Returns the same `ParsedExecutionUnit` shape so the downstream
// `buildExecutionFacts` is format-agnostic.

import * as cheerio from "cheerio";
import unzipper from "unzipper";
import { toEur } from "../../src/lib/currency";
import type { Money } from "./types";
import type {
  ExecutionTriple,
  ParsedExecutionProgram,
  ParsedExecutionUnit,
} from "./execution_pdf";

const CODE_RE = /^\d{4}\.\d{2}\.\d{2}$/;

// "1 221 324" / "- 867 000" / "0" / "" → whole leva/eur. DOCX cells often
// contain stray non-break spaces and trailing dots; strip whitespace and
// trim before parsing.
const toMoney = (
  cell: string | undefined,
  currency: "BGN" | "EUR",
): Money | null => {
  if (cell == null) return null;
  const cleaned = cell.replace(/\s/g, "").replace(/[.]$/, "");
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

// Case + whitespace tolerant header match (mirrors execution_pdf.ts).
const headerMatches = (cell: string, keyword: string): boolean =>
  cell.replace(/\s+/g, "").toLowerCase().includes(keyword.toLowerCase());

interface ValueColumns {
  law: number;
  amended: number;
  executed: number;
  headerRow: number;
}

// Find the Закон / Уточнен план / Отчет column indices by scanning the
// first ~6 rows for the header keywords. Returns null when the table has
// no such header (table is something else — e.g., an indicators table).
const findValueColumns = (rows: string[][]): ValueColumns | null => {
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const row = rows[r];
    let law = -1;
    let amended = -1;
    let executed = -1;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c] ?? "";
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

// First non-empty label cell in a row (columns 0..2 — code rows put the
// label in col 1, plain rows in col 0).
const rowLabel = (row: string[]): string => {
  for (let i = 0; i < Math.min(row.length, 3); i++) {
    const s = (row[i] ?? "").trim();
    if (s && !CODE_RE.test(s)) return s;
  }
  return "";
};

const rowCode = (row: string[]): string | null => {
  for (const c of row) {
    const s = (c ?? "").trim();
    if (CODE_RE.test(s)) return s;
  }
  return null;
};

const parseAsOf = (text: string, fiscalYear: number): string => {
  const m = text.replace(/\s/g, "").match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return `${fiscalYear}-12-31`;
};

// Extract every table from a DOCX as string[][] rows.
const extractDocxTables = async (
  docxBytes: Uint8Array,
): Promise<string[][][]> => {
  const dir = await unzipper.Open.buffer(Buffer.from(docxBytes));
  const docXml = dir.files.find((f) => f.path === "word/document.xml");
  if (!docXml) {
    throw new Error("docx: word/document.xml not found in archive");
  }
  const xml = (await docXml.buffer()).toString("utf8");
  const $ = cheerio.load(xml, { xmlMode: true });
  const tables: string[][][] = [];
  $("w\\:tbl").each((_, tbl) => {
    const rows: string[][] = [];
    $(tbl)
      .find("w\\:tr")
      .each((_, tr) => {
        const cells: string[] = [];
        $(tr)
          .find("w\\:tc")
          .each((_, tc) => {
            const text: string[] = [];
            $(tc)
              .find("w\\:t")
              .each((_, t) => {
                text.push($(t).text());
              });
            cells.push(text.join(""));
          });
        rows.push(cells);
      });
    tables.push(rows);
  });
  return tables;
};

export const parseExecutionDocx = async (
  docxBytes: Uint8Array,
  fiscalYear: number,
): Promise<ParsedExecutionUnit> => {
  const tables = await extractDocxTables(docxBytes);

  const currency: "BGN" | "EUR" = fiscalYear >= 2026 ? "EUR" : "BGN";

  let revenue: ExecutionTriple | null = null;
  let expenditure: ExecutionTriple | null = null;
  let asOf = `${fiscalYear}-12-31`;

  const tripleFrom = (row: string[], cols: ValueColumns): ExecutionTriple => ({
    law: toMoney(row[cols.law], currency),
    amended: toMoney(row[cols.amended], currency),
    executed: toMoney(row[cols.executed], currency),
  });

  for (const tbl of tables) {
    const cols = findValueColumns(tbl);
    if (!cols) continue;
    if (!revenue) {
      const row = tbl.find((r) => /^Общо\s+приходи/i.test(rowLabel(r)));
      if (row) {
        revenue = tripleFrom(row, cols);
        asOf = parseAsOf(tbl[cols.headerRow][cols.executed] ?? "", fiscalYear);
      }
    }
    if (!expenditure) {
      const row = tbl.find((r) => /^Общо\s+разходи/i.test(rowLabel(r)));
      if (row) expenditure = tripleFrom(row, cols);
    }
    if (revenue && expenditure) break;
  }

  // Programme breakdown — first table with both value columns AND code rows.
  const programs: ParsedExecutionProgram[] = [];
  for (const tbl of tables) {
    const cols = findValueColumns(tbl);
    if (!cols) continue;
    const hasCodes = tbl.some((r) => rowCode(r));
    if (!hasCodes) continue;
    for (const row of tbl) {
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
    break;
  }

  if (!revenue) {
    revenue = { law: null, amended: null, executed: null };
  }
  if (!expenditure) {
    throw new Error(
      `execution docx ${fiscalYear}: could not locate the expenditure ` +
        `(Общо разходи) total — the report's table structure likely changed`,
    );
  }

  return { fiscalYear, asOf, currency, revenue, expenditure, programs };
};
