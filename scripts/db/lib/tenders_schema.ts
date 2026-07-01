// Single source of truth for the tenders column ⇄ Tender field mapping. Both the
// loader (load_tenders_pg.ts) and the source-agnostic generator import this, so
// the SQL store and the JSON reconstruction can never drift apart. If a Tender
// field is added in src/lib/tenderTypes.ts, add it here and to 009_tenders.sql.
//
// COLUMN ORDER == the Tender object's field insertion order in
// scripts/procurement/normalize_eop_tender.ts (buildTenders). canonicalJson is
// order-preserving (it does not sort keys), so reconstructing the object in this
// order — omitting null fields exactly as the normalizer omits undefined ones —
// reproduces the by-ocid / by-tender shards byte-for-byte.
//
// See docs/plans/pg-datasets-roadmap.md §0 (Tenders).

import type { Tender, TenderLot } from "../../../src/lib/tenderTypes";

type Kind = "text" | "real" | "int" | "bool" | "json";

interface ColumnDef {
  field: keyof Tender;
  col: string;
  kind: Kind;
}

export const COLUMNS: ColumnDef[] = [
  { field: "unp", col: "unp", kind: "text" },
  { field: "ocid", col: "ocid", kind: "text" },
  { field: "tenderId", col: "tender_id", kind: "int" },
  { field: "noticeId", col: "notice_id", kind: "int" },
  { field: "publicationDate", col: "publication_date", kind: "text" },
  { field: "buyerEik", col: "buyer_eik", kind: "text" },
  { field: "buyerName", col: "buyer_name", kind: "text" },
  { field: "buyerType", col: "buyer_type", kind: "text" },
  { field: "buyerMainActivity", col: "buyer_main_activity", kind: "text" },
  { field: "subject", col: "subject", kind: "text" },
  { field: "noticeType", col: "notice_type", kind: "text" },
  { field: "procedureType", col: "procedure_type", kind: "text" },
  { field: "awardMethod", col: "award_method", kind: "text" },
  { field: "legalBasis", col: "legal_basis", kind: "text" },
  { field: "contractType", col: "contract_type", kind: "text" },
  { field: "cpv", col: "cpv", kind: "text" },
  { field: "cpvDesc", col: "cpv_desc", kind: "text" },
  {
    field: "estimatedValueNative",
    col: "estimated_value_native",
    kind: "real",
  },
  { field: "currency", col: "currency", kind: "text" },
  { field: "estimatedValueEur", col: "estimated_value_eur", kind: "real" },
  { field: "lotsCount", col: "lots_count", kind: "int" },
  { field: "lots", col: "lots", kind: "json" },
  { field: "submissionDeadline", col: "submission_deadline", kind: "text" },
  { field: "isCancelled", col: "is_cancelled", kind: "bool" },
  {
    field: "isFrameworkAgreement",
    col: "is_framework_agreement",
    kind: "bool",
  },
  { field: "isEuFunded", col: "is_eu_funded", kind: "bool" },
  { field: "euProgram", col: "eu_program", kind: "text" },
  { field: "hasUnsecuredFunding", col: "has_unsecured_funding", kind: "bool" },
  { field: "nuts", col: "nuts", kind: "text" },
  { field: "linkToOjEu", col: "link_to_oj_eu", kind: "text" },
  { field: "changeNoticeCount", col: "change_notice_count", kind: "int" },
  { field: "sourceDay", col: "source_day", kind: "text" },
  { field: "sourceUrl", col: "source_url", kind: "text" },
];

export const COLUMN_NAMES = COLUMNS.map((c) => c.col);

/** Per-column placeholder cast — jsonb needs an explicit ::jsonb on the param
 *  (node-pg would otherwise render a JS array as a PG array literal). */
export const columnCast = (col: string): string =>
  col === "lots" ? "::jsonb" : "";

type Param = string | number | boolean | null;

/** Tender → positional INSERT params (absent fields → NULL; lots → JSON text). */
export const tenderToRow = (t: Tender): Param[] =>
  COLUMNS.map(({ field, kind }) => {
    const v = t[field];
    if (v === undefined || v === null) return null;
    if (kind === "json") return JSON.stringify(v);
    return v as Param;
  });

// TenderLot field insertion order in normalize_eop_tender.ts (the .map that
// builds each lot). jsonb does not preserve key order, so on read we rebuild
// each lot in this order — omitting null/undefined exactly as the normalizer
// omits undefined — so canonicalJson reproduces the lots array byte-for-byte.
const LOT_FIELDS: (keyof TenderLot)[] = [
  "lotId",
  "tenderId",
  "name",
  "cpv",
  "estimatedValueNative",
  "currency",
  "estimatedValueEur",
  "nuts",
];

const normalizeLot = (raw: Record<string, unknown>): TenderLot => {
  const out: Record<string, unknown> = {};
  for (const f of LOT_FIELDS) {
    const v = raw[f];
    if (v !== null && v !== undefined) out[f] = v;
  }
  return out as unknown as TenderLot;
};

type SqlRow = Record<string, unknown>;

/** SQL row → Tender (NULL columns omitted so the object matches the source
 *  shape). Iterates COLUMNS in normalize order, so JSON.stringify /
 *  canonicalJson of the result reproduces the on-disk field order. jsonb columns
 *  come back from node-pg already parsed. */
export const rowToTender = (row: SqlRow): Tender => {
  const out: Record<string, unknown> = {};
  for (const { field, col, kind } of COLUMNS) {
    const v = row[col];
    if (v === null || v === undefined) continue;
    if (kind === "json") {
      const arr = (typeof v === "string" ? JSON.parse(v) : v) as Record<
        string,
        unknown
      >[];
      out[field] = arr.map(normalizeLot);
    } else if ((kind === "int" || kind === "real") && typeof v === "string") {
      // Defensive: int8/numeric would arrive as a string and JSON-quote the
      // number. Our columns are int4/float8 (JS numbers), but coerce anyway so a
      // future column-type change can't silently break byte-identical output.
      out[field] = Number(v);
    } else {
      out[field] = v;
    }
  }
  return out as unknown as Tender;
};
