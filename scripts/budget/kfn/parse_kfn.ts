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

/** The four accumulation workbooks, by filename fragment + the sheet-name
 *  token(s) their tables carry. КФН shipped English workbooks
 *  ("UPF_… EN.xlsx", sheets "Table №1-U") through 2025; from the 2026 Q1
 *  release the zip is Bulgarian-only ("UPF_2026_Q1_BG.xlsx", nested under a
 *  "Statistics_YYYY_QN/" folder, sheets "Таблица №1-У", the voluntary pillars
 *  renamed ДПФ/ДПФПС). Match both languages: the filename regex accepts either
 *  spelling (VPF≡ДПФ, VPFOS≡ДПФПС) and each pillar carries its Latin + Cyrillic
 *  sheet token. Anchor the filename so "PPF" doesn't match "LPPF" and "DPF"
 *  doesn't match "DPFPS"; it is tested against the entry BASENAME (the BG zip
 *  nests the workbooks in a folder). */
const WORKBOOKS: { pillar: KfnPillar; file: RegExp; tokens: string[] }[] = [
  { pillar: "UPF", file: /^UPF[_ ]/i, tokens: ["U", "У"] },
  { pillar: "PPF", file: /^PPF[_ ]/i, tokens: ["P", "П"] },
  { pillar: "VPF", file: /^(?:VPF|DPF)[_ ]/i, tokens: ["V", "Д"] },
  { pillar: "VPFOS", file: /^(?:VPFOS|DPFPS)[_ ]/i, tokens: ["OS", "ПС"] },
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
// Fund names are Latin in the EN workbooks (DOVERIE), Cyrillic in the BG ones
// (ДОВЕРИЕ) — each pattern matches both spellings.
const COMPANY_PATTERNS: { re: RegExp; bg: string; en: string }[] = [
  { re: /DOVERIE|ДОВЕРИЕ/i, bg: "Доверие", en: "Doverie" },
  { re: /SAGLASIE|СЪГЛАСИЕ/i, bg: "Съгласие", en: "Saglasie" },
  {
    re: /DSK\s*-?\s*RODINA|ДСК\s*-?\s*РОДИНА/i,
    bg: "ДСК-Родина",
    en: "DSK-Rodina",
  },
  { re: /ALLIANZ|АЛИАНЦ/i, bg: "Алианц България", en: "Allianz Bulgaria" },
  { re: /UBB|ОББ/i, bg: "ОББ", en: "UBB" },
  { re: /CCB\s*-?\s*SILA|ЦКБ\s*-?\s*СИЛА/i, bg: "ЦКБ-Сила", en: "CCB-Sila" },
  { re: /FUTURE|BADESHTE|БЪДЕЩЕ/i, bg: "Бъдеще", en: "Future" },
  { re: /TOPLINA|ТОПЛИНА/i, bg: "Топлина", en: "Toplina" },
  // Лев Инс — rebranded from ПОИ / Пенсионноосигурителен институт (2025).
  {
    re: /LEV\s*INS|ЛЕВ\s*ИНС|PENSIONNOOSIGURITELEN\s+INSTITUT|ПЕНСИОННООСИГУРИТЕЛЕН\s+ИНСТИТУТ|\bPOI\b|\bПОИ\b/i,
    bg: "Лев Инс",
    en: "Lev Ins",
  },
  { re: /DALLBOGG|ДАЛЛБОГГ|ДАЛБОГ/i, bg: "ДаллБогг", en: "DallBogg" },
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

/** Find a workbook sheet by table number + one of the pillar's tokens, tolerant
 *  of spacing chaos and language ("Table №1-U", "Table № 1-OS", "Таблица №2-П").
 *  Matches on the part AFTER "№", so the "Table"/"Таблица" prefix is irrelevant. */
const findTable = (
  wb: XLSX.WorkBook,
  tableNo: number,
  tokens: string[],
): XLSX.WorkSheet | null => {
  const norm = (s: string) =>
    s.replace(/\s+/g, "").replace(/^.*?№/, "").toLowerCase();
  for (const token of tokens) {
    const want = `${tableNo}-${token}`.toLowerCase();
    const name = wb.SheetNames.find((s) => norm(s) === want);
    if (name) return wb.Sheets[name];
  }
  return null;
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
    const low = name.toLowerCase();
    if (!name || low === "total" || low === "общо") continue;
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

  // КФН reported лв through 2025; from 2026 (euro adoption) the workbooks are
  // euro-native — net assets are already in EUR, so there is no BGN→EUR
  // conversion and netAssetsBgn is left null. Before 2026 the figure is BGN,
  // converted to EUR (dividing a euro-native figure by 1.95583 would halve it).
  const euroNative = () => period !== "" && Number(period.slice(0, 4)) >= 2026;
  const bgnToEur = (bgn: number | null): number | null =>
    bgn == null ? null : Math.round(toEur(bgn, "BGN") ?? bgn);

  for (const { pillar, file, tokens } of WORKBOOKS) {
    const entry = entries.find((e) =>
      file.test(e.entryName.split("/").pop() ?? e.entryName),
    );
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
      findTable(wb, 1, tokens) ?? ({} as XLSX.WorkSheet),
    );
    const assetsByFund = latestByFund(
      findTable(wb, 2, tokens) ?? ({} as XLSX.WorkSheet),
    );
    const names = new Set([...insuredByFund.keys(), ...assetsByFund.keys()]);
    const lbl = PILLAR_LABEL[pillar];
    for (const fundName of names) {
      const co = companyOf(fundName);
      // Net assets are published in thousands (BGN through 2025, EUR from 2026).
      const naThousands = assetsByFund.get(fundName) ?? null;
      const naUnits =
        naThousands != null ? Math.round(naThousands * 1000) : null;
      const netAssetsBgn = euroNative() ? null : naUnits;
      const netAssetsEur = euroNative() ? naUnits : bgnToEur(naUnits);
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
        netAssetsEur,
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
