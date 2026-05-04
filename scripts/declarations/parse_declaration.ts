/**
 * Parse a single MP property/interest declaration XML from register.cacbg.bg.
 *
 * The XML schema is fixed by ordinance and stable across declarants:
 *   <PublicPerson>
 *     <Personal>...</Personal>
 *     <DeclarationData>...</DeclarationData>
 *     <Tables>
 *       <Table Num="10" Description="..." Declared="True">
 *         <Row Num="1">
 *           <Cell Num="2" Description="...">value</Cell>
 *           ...
 *
 * See docs/plans/mp-financial-connections-slice0-findings.md for the full schema.
 */

import { load, type CheerioAPI } from "cheerio";
import type {
  MpDeclaration,
  MpIncomeRecord,
  MpOwnershipStake,
} from "../../src/data/dataTypes";

const text = ($: CheerioAPI, sel: string): string | null => {
  const el = $(sel).first();
  if (el.length === 0) return null;
  const t = el.text().trim();
  return t === "" ? null : t;
};

// Cell values use comma as decimal separator (RegionalSettings says "."
// for DecimalSeparator but the actual data uses commas — declarants enter
// numbers in Bulgarian convention regardless).
const toNumber = (raw: string | null): number | null => {
  if (raw == null) return null;
  const cleaned = raw.replace(/\s+/g, "").replace(/,/g, ".");
  if (cleaned === "" || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

// ISO-format a "dd.MM.yyyy" date.
const parseBgDate = (raw: string | null): string | null => {
  if (!raw) return null;
  const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
};

const cellByNum = (
  row: ReturnType<CheerioAPI>,
  num: number,
): string | null => {
  const cell = row.find(`Cell[Num="${num}"]`).first();
  if (cell.length === 0) return null;
  const t = cell.text().trim();
  return t === "" ? null : t;
};

// A row is "empty" when the only populated cell is the row number (cell 1).
const isEmptyRow = ($: CheerioAPI, row: ReturnType<CheerioAPI>): boolean => {
  const populated = row
    .find("Cell")
    .toArray()
    .filter((c) => {
      const num = $(c).attr("Num");
      if (num === "1") return false;
      return ($(c).text() || "").trim() !== "";
    });
  return populated.length === 0;
};

const parseTable10Row = (
  row: ReturnType<CheerioAPI>,
): MpOwnershipStake => ({
  table: "10",
  itemType: cellByNum(row, 2),
  shareSize: cellByNum(row, 3),
  companyName: cellByNum(row, 4),
  registeredOffice: cellByNum(row, 5),
  valueBgn: toNumber(cellByNum(row, 6)),
  holderName: cellByNum(row, 7),
  legalBasis: cellByNum(row, 9),
  fundsOrigin: cellByNum(row, 10),
});

const parseTable11Row = (
  row: ReturnType<CheerioAPI>,
): MpOwnershipStake => ({
  table: "11",
  itemType: cellByNum(row, 2),
  shareSize: cellByNum(row, 3),
  companyName: cellByNum(row, 4),
  registeredOffice: cellByNum(row, 5),
  valueBgn: toNumber(cellByNum(row, 6)),
  holderName: null,
  transfereeName: cellByNum(row, 7),
  legalBasis: cellByNum(row, 9),
  fundsOrigin: null,
});

const parseIncomeRow = (
  row: ReturnType<CheerioAPI>,
): MpIncomeRecord => ({
  parent: row.attr("Parent") || null,
  category: cellByNum(row, 2),
  amountBgnDeclarant: toNumber(cellByNum(row, 3)),
  amountBgnSpouse: toNumber(cellByNum(row, 4)),
});

export type ParseInput = {
  xml: string;
  mpId: number;
  institution: string;
  sourceUrl: string;
};

export const parseDeclarationXml = ({
  xml,
  mpId,
  institution,
  sourceUrl,
}: ParseInput): MpDeclaration => {
  const $ = load(xml, { xmlMode: true });

  const declarantName =
    text($, "PublicPerson > Personal > Name") || "(unknown)";
  const declType = text($, "DeclarationData > DeclarationType") || "Other";
  const declYearRaw = text($, "DeclarationData > Year");
  const fiscalYear = declYearRaw ? Number(declYearRaw) : null;
  const filedAt = parseBgDate(text($, "DeclarationData > DeclarationDate"));
  const entryNumber = text($, "DeclarationData > EntryNumber");
  const controlHash = text($, "DeclarationData > ControlHash");

  // Annual declaration filed in year N covers fiscal year N-1.
  const declarationYear =
    fiscalYear != null && declType === "Annualy"
      ? fiscalYear + 1
      : (fiscalYear ?? new Date().getFullYear());

  const ownershipStakes: MpOwnershipStake[] = [];

  // Source filings occasionally include the same row twice (the declarant
  // entered it both at the top and bottom of the table). Dedup by the
  // identifying tuple — same company + same holder + same share size.
  const seen = new Set<string>();
  const dedupKey = (s: MpOwnershipStake): string =>
    [
      s.table,
      s.companyName ?? "",
      s.holderName ?? "",
      s.shareSize ?? "",
      s.registeredOffice ?? "",
      s.valueBgn ?? "",
    ].join("|");

  const t10 = $('Table[Num="10"]').first();
  if (t10.attr("Declared") === "True") {
    t10.find("Row").each((_, el) => {
      const row = $(el);
      if (isEmptyRow($, row)) return;
      const stake = parseTable10Row(row);
      const k = dedupKey(stake);
      if (seen.has(k)) return;
      seen.add(k);
      ownershipStakes.push(stake);
    });
  }

  const t11 = $('Table[Num="11"]').first();
  if (t11.attr("Declared") === "True") {
    t11.find("Row").each((_, el) => {
      const row = $(el);
      if (isEmptyRow($, row)) return;
      const stake = parseTable11Row(row);
      const k = dedupKey(stake);
      if (seen.has(k)) return;
      seen.add(k);
      ownershipStakes.push(stake);
    });
  }

  const income: MpIncomeRecord[] = [];
  const t12 = $('Table[Num="12"]').first();
  if (t12.attr("Declared") === "True") {
    t12.find("Row").each((_, el) => {
      const row = $(el);
      const rec = parseIncomeRow(row);
      // Income table has many empty rows for unused categories; keep only
      // rows where at least one amount is set.
      if (rec.amountBgnDeclarant != null || rec.amountBgnSpouse != null) {
        income.push(rec);
      }
    });
  }

  return {
    mpId,
    declarantName,
    institution,
    declarationYear,
    fiscalYear,
    declarationType: declType,
    filedAt,
    entryNumber,
    controlHash,
    sourceUrl,
    ownershipStakes,
    income,
  };
};
