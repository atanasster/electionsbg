// Parses the КФН (Financial Supervision Commission) quarterly private-pension
// statistics — the ZIP of English XLSX workbooks published at fsc.bg. This is
// "the missing half" of the pension picture: pillars 2 and 3 (ДЗПО), the funded
// private accounts, alongside НОИ's pillar-1 pay-as-you-go.
//
// We target the four ACCUMULATION-phase workbooks — UPF (universal, mandatory
// pillar 2), PPF (professional, early-retirement pillar 2), VPF (voluntary
// pillar 3) and VPFOS (voluntary with occupational schemes) — which share a
// clean "funds as rows, months as columns, Total row" layout across two tables:
//   Table №1 = insured persons, Table №2 = net assets (in thousands BGN).
// The payout-phase workbooks (DPF deferred-payment, LPPF lifelong-payment) use a
// different columnar layout and are skipped for v1.
//
// Grain: one row per (fund, period). Net assets → EUR at ingest. Each fund maps
// to the ПОД (pension company) that manages it, derived from the fund name.

import { AdmZip } from "../../lib/adm_zip";
import * as XLSX from "xlsx";
import { toEur } from "../../../src/lib/currency";

export type KfnPillar = "UPF" | "PPF" | "VPF" | "VPFOS";

/** The four accumulation workbooks, by filename fragment + the sheet-name token
 *  their tables carry ("Table №1-U", "Table №2-P", "Table № 1-OS"…). */
// Anchor each filename regex to the start so "PPF" doesn't match "LPPF" and
// "VPF" doesn't match "VPFOS" — the КФН zip has both. entryName is a bare
// filename in this archive, so ^ anchors on the workbook name.
const WORKBOOKS: { pillar: KfnPillar; file: RegExp; token: string }[] = [
  { pillar: "UPF", file: /^UPF[_ ].*EN\.xlsx$/, token: "U" },
  { pillar: "PPF", file: /^PPF[_ ].*EN\.xlsx$/, token: "P" },
  { pillar: "VPF", file: /^VPF[_ ].*EN\.xlsx$/, token: "V" },
  { pillar: "VPFOS", file: /^VPFOS[_ ].*EN\.xlsx$/, token: "OS" },
];

const PILLAR_LABEL: Record<
  KfnPillar,
  { bg: string; en: string; pillar: 2 | 3 }
> = {
  UPF: { bg: "Универсален (УПФ)", en: "Universal (UPF)", pillar: 2 },
  PPF: { bg: "Професионален (ППФ)", en: "Professional (PPF)", pillar: 2 },
  VPF: { bg: "Доброволен (ДПФ)", en: "Voluntary (VPF)", pillar: 3 },
  VPFOS: {
    bg: "Доброволен по проф. схеми (ДПФПС)",
    en: "Voluntary occupational (VPFOS)",
    pillar: 3,
  },
};

// Fund name → managing ПОД (pension company) brand. КФН fund names embed the
// company (e.g. UPF "DOVERIE" → Doverie). The 10 licensed companies:
const COMPANY_PATTERNS: { re: RegExp; bg: string; en: string }[] = [
  { re: /DOVERIE/i, bg: "Доверие", en: "Doverie" },
  { re: /SAGLASIE/i, bg: "Съгласие", en: "Saglasie" },
  { re: /DSK\s*-?\s*RODINA/i, bg: "ДСК-Родина", en: "DSK-Rodina" },
  { re: /ALLIANZ/i, bg: "Алианц България", en: "Allianz Bulgaria" },
  { re: /UBB/i, bg: "ОББ", en: "UBB" },
  { re: /CCB\s*-?\s*SILA/i, bg: "ЦКБ-Сила", en: "CCB-Sila" },
  { re: /FUTURE|BADESHTE/i, bg: "Бъдеще", en: "Future" },
  { re: /TOPLINA/i, bg: "Топлина", en: "Toplina" },
  { re: /PENSIONNOOSIGURITELEN\s+INSTITUT|\bPOI\b/i, bg: "ПОИ", en: "POI" },
  { re: /DALLBOGG/i, bg: "ДаллБогг", en: "DallBogg" },
];

const companyOf = (fundName: string): { bg: string; en: string } => {
  for (const c of COMPANY_PATTERNS) if (c.re.test(fundName)) return c;
  // No pattern matched: we can only echo the raw (often Latin) fund name into
  // both fields — which mislabels the BG side. Warn so a new company gets added
  // to COMPANY_PATTERNS rather than shipping a Latin name in Bulgarian UI.
  console.warn(
    `КФН: no company mapping for fund "${fundName}" — using raw name for both bg/en; add it to COMPANY_PATTERNS.`,
  );
  return { bg: fundName, en: fundName };
};

export interface KfnFundRow {
  pillar: KfnPillar;
  pillarLabelBg: string;
  pillarLabelEn: string;
  pillarNumber: 2 | 3;
  fundName: string;
  companyBg: string;
  companyEn: string;
  insured: number | null;
  netAssetsBgn: number | null;
  netAssetsEur: number | null;
}

export interface KfnFundsFile {
  generatedAt: string;
  period: string; // ISO as-of date, e.g. "2025-06-30"
  periodLabel: string; // e.g. "2025 Q2"
  source: { publisher: string; url: string; description: string };
  funds: KfnFundRow[];
}

type Row = unknown[];

const rowsOf = (sheet: XLSX.WorkSheet): Row[] =>
  XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  }) as Row[];

const text = (v: unknown): string =>
  v == null ? "" : String(v).replace(/\s+/g, " ").trim();

/** Find a workbook sheet by table number + pillar token, tolerant of the
 *  spacing chaos ("Table №1-U", "Table № 1-OS", "Table №2-P"). */
const findTable = (
  wb: XLSX.WorkBook,
  tableNo: number,
  token: string,
): XLSX.WorkSheet | null => {
  const norm = (s: string) =>
    s.replace(/\s+/g, "").replace(/№/g, "").toLowerCase();
  const want = norm(`Table${tableNo}-${token}`);
  const name = wb.SheetNames.find((s) => norm(s) === want);
  return name ? wb.Sheets[name] : null;
};

/** From a "funds as rows, months as columns" table, return { fundName → value }
 *  at the latest month column. The month-header row is the one whose first cell
 *  is the pillar token and whose later cells are month numbers (12,1,2,…). */
const latestByFund = (sheet: XLSX.WorkSheet): Map<string, number> => {
  const rows = rowsOf(sheet);
  // Locate the month-header row: a row with ≥3 small integers (months 1..12).
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const months = rows[i]
      .slice(1)
      .filter((c) => typeof c === "number" && c >= 1 && c <= 12);
    if (months.length >= 3) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return new Map();
  // Latest month = last column carrying a 1..12 integer in the header row.
  const header = rows[headerIdx];
  let latestCol = -1;
  for (let c = 1; c < header.length; c++) {
    const v = header[c];
    if (typeof v === "number" && v >= 1 && v <= 12) latestCol = c;
  }
  if (latestCol < 0) return new Map();

  const out = new Map<string, number>();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const name = text(rows[i][0]);
    if (!name || /^Total$/i.test(name)) continue;
    const v = rows[i][latestCol];
    if (typeof v === "number" && Number.isFinite(v)) out.set(name, v);
  }
  return out;
};

/** Parse the as-of date + label from a workbook filename ("UPF_2025 Q2_EN.xlsx"
 *  or "DPF_2025_Q2_EN.xlsx"). Q1→03-31, Q2→06-30, Q3→09-30, Q4→12-31. */
export const periodFromFilename = (
  file: string,
): { period: string; periodLabel: string } | null => {
  const m = file.match(/(\d{4})[ _]Q([1-4])/i);
  if (!m) return null;
  const year = m[1];
  const q = Number(m[2]);
  const end = { 1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31" }[q]!;
  return { period: `${year}-${end}`, periodLabel: `${year} Q${q}` };
};

export const parseKfnZip = (bytes: Uint8Array): KfnFundsFile => {
  // Guard against a soft-404 / HTML body served at HTTP 200: a real ZIP starts
  // with the "PK\x03\x04" magic bytes. Mirrors parseYearbookZip's isZip check.
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  )
    throw new Error("КФН: not a ZIP (soft-404 HTML?) — refusing to parse");

  const zip = new AdmZip(Buffer.from(bytes));
  const entries = zip.getEntries();

  // Period from any accumulation workbook's filename.
  let period = "";
  let periodLabel = "";
  const funds: KfnFundRow[] = [];

  // КФН reports лв through 2025; from 2026 (euro adoption) the source is
  // euro-native, so dividing by 1.95583 would halve every figure. Fail loudly
  // when a 2026+ period lands rather than silently mis-scale net assets.
  const naEur = (bgn: number | null): number | null => {
    if (bgn == null) return null;
    if (period && Number(period.slice(0, 4)) >= 2026)
      throw new Error(
        `КФН ${period}: source is euro-native from 2026 — remove the ` +
          `BGN→EUR conversion (toEur) before ingesting this period.`,
      );
    return Math.round(toEur(bgn, "BGN") ?? bgn);
  };

  for (const { pillar, file, token } of WORKBOOKS) {
    const entry = entries.find((e) => file.test(e.entryName));
    if (!entry) continue;
    if (!period) {
      const p = periodFromFilename(entry.entryName);
      if (p) {
        period = p.period;
        periodLabel = p.periodLabel;
      }
    }
    const wb = XLSX.read(entry.getData());
    const insuredByFund = latestByFund(
      findTable(wb, 1, token) ?? ({} as XLSX.WorkSheet),
    );
    const assetsByFund = latestByFund(
      findTable(wb, 2, token) ?? ({} as XLSX.WorkSheet),
    );
    const names = new Set([...insuredByFund.keys(), ...assetsByFund.keys()]);
    const lbl = PILLAR_LABEL[pillar];
    for (const fundName of names) {
      const co = companyOf(fundName);
      // Net assets are published in thousands of BGN.
      const naThousands = assetsByFund.get(fundName) ?? null;
      const netAssetsBgn = naThousands != null ? naThousands * 1000 : null;
      funds.push({
        pillar,
        pillarLabelBg: lbl.bg,
        pillarLabelEn: lbl.en,
        pillarNumber: lbl.pillar,
        fundName,
        companyBg: co.bg,
        companyEn: co.en,
        insured: insuredByFund.get(fundName) ?? null,
        netAssetsBgn,
        netAssetsEur: naEur(netAssetsBgn),
      });
    }
  }

  // Sort by pillar (2 before 3, then UPF/PPF/VPF/VPFOS) then net assets desc.
  const order: KfnPillar[] = WORKBOOKS.map((w) => w.pillar);
  funds.sort(
    (a, b) =>
      order.indexOf(a.pillar) - order.indexOf(b.pillar) ||
      (b.netAssetsEur ?? 0) - (a.netAssetsEur ?? 0),
  );

  return {
    generatedAt: new Date().toISOString(),
    period,
    periodLabel,
    source: {
      publisher: "Комисия за финансов надзор (КФН)",
      url: "https://www.fsc.bg/en/social-insurance-activity/statistics/",
      description:
        "Quarterly private-pension (pillars 2 & 3) statistics — insured " +
        "persons and net assets per fund, from the КФН XLSX workbooks.",
    },
    funds,
  };
};

/** True if `bytes` is a real ZIP (guards against a soft-404 HTML page). */
export const isZip = (bytes: Uint8Array): boolean =>
  bytes.length > 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  bytes[2] === 0x03 &&
  bytes[3] === 0x04;
