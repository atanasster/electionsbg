// DOCX execution-report headcount extractor.
//
// Some ministries (MZH among them) publish their "Отчет за изпълнението на
// програмния бюджет" as a .docx file (direct or wrapped in a .zip). This
// module extracts tables from word/document.xml via unzipper + cheerio (XML
// mode), then runs the same code-header → Персонал → Численост scanner as
// the bordered-PDF and XLSX parsers.
//
// Input: raw .docx bytes (already unzipped from an outer .zip if needed).
// Output: ParsedHeadcountUnit — identical shape to the other format parsers.

import * as cheerio from "cheerio";
import unzipper from "unzipper";
import { extractDocxBytesFromZip } from "./fetch_sources_docx";
import type { Money } from "./types";
import { toEur } from "../../src/lib/currency";
import type {
  HeadcountTriple,
  ParsedHeadcountProgramme,
  ParsedHeadcountUnit,
} from "./headcount";

const CODE_RE = /\b(\d{4}\.\d{2}\.\d{2})\b/;

// ---------- DOCX table extraction ----------

// Extract every table from a .docx file's word/document.xml as string[][]
// rows. Tables in DOCX are <w:tbl> elements containing <w:tr> rows whose
// <w:tc> cells hold paragraphs of <w:t> text runs. We concatenate all text
// runs in a cell and produce one row per <w:tr>.
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
            // One <w:tc> can contain multiple <w:p> paragraphs each holding
            // multiple <w:t> text runs; concatenate all into one cell.
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

// ---------- shared scanner (mirrors headcount.ts) ----------

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
  return {
    amount: Math.round(personnel.amount / headcount),
    amountEur: Math.round(personnel.amountEur / headcount),
    currency,
  };
};

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

export const parseHeadcountFromExecutionDocx = async (
  docxBytes: Uint8Array,
  fiscalYear: number,
): Promise<ParsedHeadcountUnit> => {
  const tables = await extractDocxTables(docxBytes);
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

  for (const tbl of tables) {
    for (const row of tbl) {
      const header = programmeHeader(row);
      if (header) {
        state = { ...newState(), ...header };
        continue;
      }
      const label = row.find((c) => c && c.trim() !== "")?.trim() ?? "";
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

// Re-export the helper for personnel_facts.ts dispatch.
export { extractDocxBytesFromZip };
