// Parser for the ИСУН 2020 public "Бенефициенти" XLSX export.
//
// The export carries a filter-summary block of variable height, then a
// "Бенефициенти" header, then a 7-column table, then a "Забележки:" footer.
// We locate the table by matching the known header cells — that match IS the
// schema guard: if eufunds.bg restructures the export, parsing fails loud
// rather than emitting garbage.

import * as XLSX from "xlsx";
import { canonicalEik } from "./eik";
import { normaliseOrgName } from "../lib/normalize_name";
import type { FundsBeneficiary } from "./types";

const EXPECTED_HEADERS = [
  "Наименование на организацията",
  "Тип на организацията",
  "Вид на организацията",
  "Форма на организацията",
  "Брой сключени договори",
  "Договорени средства",
  "Реално изплатени суми",
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
  throw new Error(`ИСУН parse: non-numeric value ${JSON.stringify(v)}`);
};

// The org-name cell is "<EIK><spaces><name>", e.g.
// "175157251   ЕНТЪРПРАЙЗ КОМЮНИКЕЙШЪНС ГРУП ЕООД". The leading numeric token
// is always stripped (even when it's a 10-digit ЕГН we won't persist).
//
// The raw export carries many names in ALL CAPS — we normalise to sentence
// case at this single seam so every downstream artifact (per-EIK shards,
// derivatives, joins) shares one casing.
const splitNameAndEik = (
  cell: string,
): { eik: string | null; name: string } => {
  const m = cell.match(/^(\d+)\s+(.+)$/);
  const rawName = m ? m[2] : cell;
  const collapsed = rawName.trim().replace(/\s+/g, " ");
  const name = normaliseOrgName(collapsed);
  if (m) return { eik: canonicalEik(m[1]), name };
  return { eik: null, name };
};

export const parseBeneficiaries = (buf: Buffer): FundsBeneficiary[] => {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("ИСУН export: workbook has no sheets");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: true,
  });

  // Locate the header row — the filter block above it varies in height.
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
      "ИСУН export: header row not found — the eufunds.bg export schema may have changed",
    );
  }

  const out: FundsBeneficiary[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const first = Array.isArray(r) ? String(r[0] ?? "").trim() : "";
    // Data ends at the first blank row or the "Забележки:" footer block.
    if (first === "" || first.startsWith("Забележки")) break;
    const { eik, name } = splitNameAndEik(first);
    if (name === "") continue;
    out.push({
      eik,
      name,
      orgType: String((r as unknown[])[1] ?? "").trim(),
      orgKind: String((r as unknown[])[2] ?? "").trim(),
      orgForm: String((r as unknown[])[3] ?? "").trim(),
      contractCount: toNumber((r as unknown[])[4]),
      contractedEur: toNumber((r as unknown[])[5]),
      paidEur: toNumber((r as unknown[])[6]),
    });
  }
  return out;
};
