// Parser for the ИСУН 2020 public "Проекти" XLSX export.
//
// The export carries a filter-summary block of variable height, then a
// 15-column header, then one row per signed contract, then no footer block
// of its own (the data ends at the first empty row). We locate the table by
// matching the known header cells — that match IS the schema guard: if
// eufunds.bg restructures the export, parsing fails loud rather than
// emitting garbage.

import * as XLSX from "xlsx";
import { canonicalEik } from "./eik";
import type { FundsProject } from "./projects_types";

const EXPECTED_HEADERS = [
  "Програма",
  "Бенефициент",
  "Тип на организацията",
  "Вид на организацията",
  "Форма на организацията",
  "Седалище",
  "Местонахождение",
  "Номер на проектно предложение",
  "Наименование на проекта",
  "Обща стойност",
  "БФП",
  "Собствено съфинансиране от бенефициента",
  "Реално изплатени суми",
  "Продължителност (месеци)",
  "Статус на изпълнение на договора/заповедта за БФП",
];

const toNumber = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (v == null || v === "") return 0;
  if (typeof v === "string") {
    const cleaned = v.replace(/\s/g, "").replace(",", ".");
    if (cleaned === "") return 0;
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(
    `ИСУН projects parse: non-numeric value ${JSON.stringify(v)}`,
  );
};

const toInteger = (v: unknown): number => {
  const n = toNumber(v);
  if (!Number.isInteger(n)) {
    throw new Error(
      `ИСУН projects parse: expected integer, got ${JSON.stringify(v)}`,
    );
  }
  return n;
};

const str = (v: unknown): string =>
  String(v ?? "")
    .trim()
    .replace(/\s+/g, " ");

// Programme cells are "<code> <Bulgarian name>", e.g.
// "2014BG16RFOP002 Иновации и конкурентоспособност". The leading token is the
// stable programme identifier; the trailing portion is its human label.
const splitProgram = (cell: string): { code: string; name: string } => {
  const m = cell.match(/^(\S+)\s+(.+)$/);
  if (m) return { code: m[1], name: m[2].trim() };
  return { code: cell, name: "" };
};

// Beneficiary cells follow the same convention as the rollup export:
// "<EIK><spaces><name>". The leading numeric token is always stripped (even
// when it's a 10-digit token we can't persist — see ./eik.ts).
const splitBeneficiary = (
  cell: string,
): { eik: string | null; name: string } => {
  const m = cell.match(/^(\d+)\s+(.+)$/);
  if (m) return { eik: canonicalEik(m[1]), name: m[2].trim() };
  return { eik: null, name: cell };
};

export const parseProjects = (buf: Buffer): FundsProject[] => {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("ИСУН projects export: workbook has no sheets");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: true,
  });

  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (
      Array.isArray(r) &&
      EXPECTED_HEADERS.every((h, c) => String(r[c] ?? "").trim() === h)
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      "ИСУН projects export: header row not found — the eufunds.bg export schema may have changed",
    );
  }

  const out: FundsProject[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] as unknown[] | undefined;
    if (!Array.isArray(r)) continue;
    // Data ends at the first row with no programme cell, or at the
    // "Забележки:" footer block (the export ends with a notes section that
    // has text in column A).
    const programRaw = str(r[0]);
    if (programRaw.startsWith("Забележки")) break;
    if (programRaw === "") {
      // Some XLSX outputs interleave a stray empty row mid-table; only stop
      // when the next non-empty row is also empty (defensive — the current
      // export has a single contiguous block).
      const next = rows[i + 1] as unknown[] | undefined;
      if (!Array.isArray(next) || str(next[0]) === "") break;
      continue;
    }
    const { code: programCode, name: programName } = splitProgram(programRaw);
    const { eik: beneficiaryEik, name: beneficiaryName } = splitBeneficiary(
      str(r[1]),
    );
    out.push({
      programCode,
      programName,
      beneficiaryEik,
      beneficiaryName,
      orgType: str(r[2]),
      orgKind: str(r[3]),
      orgForm: str(r[4]),
      hqAddress: str(r[5]),
      locationRaw: str(r[6]),
      contractNumber: str(r[7]),
      title: str(r[8]),
      totalEur: toNumber(r[9]),
      grantEur: toNumber(r[10]),
      ownCofinanceEur: toNumber(r[11]),
      paidEur: toNumber(r[12]),
      durationMonths: toInteger(r[13]),
      status: str(r[14]),
    });
  }
  return out;
};
