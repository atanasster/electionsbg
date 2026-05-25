// НАП annual-report parser. The Годишен отчет за дейността на НАП is published
// once a year (early March of year T+1, approved by Council of Ministers) and
// contains:
//   – Table 3:  declared VAT by КИД-2008 economic sector (22 rows + total)
//   – Table 8:  PIT-employment receipts by payment type (5 rows)
//   – Table 10: PIT-freelance/non-employment receipts by payment type (6 rows)
//   – Plus a narrative line for "Окончателен данък + dividends" (final tax)
//
// We use `pdftotext -layout` (poppler-utils) — these are wide multi-line-wrap
// tables and the `-layout` mode preserves their column alignment far better
// than a custom pdfjs extractor. Adds a poppler-utils system dependency, but
// it's universally available on dev machines and CI.
//
// Two output JSON files per fiscal year:
//   data/budget/revenue_breakdown/vat/<YYYY>.json
//   data/budget/revenue_breakdown/pit/<YYYY>.json

import { execFileSync } from "child_process";
import { toEur } from "../../src/lib/currency";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Convert "5 060,4" / "611,3" / "11 694,4" / "1 595,9" → 5060.4 (millions).
// Returns null on unparseable input. Handles NBSP / narrow no-break / thin
// spaces and Bulgarian decimal commas.
const parseMillions = (raw: string): number | null => {
  if (raw == null) return null;
  let cleaned = String(raw)
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .replace(/\s+/g, "")
    .replace(/,/g, ".");
  let sign = 1;
  if (/^-/.test(cleaned)) {
    sign = -1;
    cleaned = cleaned.slice(1);
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return sign * n;
};

// Convert a millions-native figure to the canonical Money record.
const toMoney = (
  millions: number | null,
  currency: "BGN" | "EUR",
): { amount: number; currency: "BGN" | "EUR"; amountEur: number } | null => {
  if (millions == null) return null;
  const amount = Math.round(millions * 1_000_000);
  const eur = toEur(amount, currency);
  return {
    amount,
    currency,
    amountEur: eur == null ? amount : Math.round(eur),
  };
};

// Extract the report text using `pdftotext -layout`. Shells out — assumes
// poppler-utils is installed (universal on dev/CI environments). Returns the
// full text as a single string.
const extractTextLayout = (pdfPath: string): string => {
  return execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
};

// ---------------------------------------------------------------------------
// VAT — Table 3 (КИД-2008 sector breakdown)
// ---------------------------------------------------------------------------

// Sector A-T plus "U" (extraterritorial) and "Не е посочена" + "ОБЩО:".
// `letter` is the KID-2008 sector code; `re` matches the row's leading label
// span ON THE FIRST LINE of the row (sector name may wrap, but the letter +
// name beginning is always on the first line).
interface SectorDef {
  id: string;
  letter: string;
  labelBg: string;
  labelEn: string;
  re: RegExp;
}

// Sector regexes match the LEADING LETTER + space + first lowercase word.
// Sector names often wrap to a second line in the PDF; we anchor on letter
// + first word so a wrap doesn't break the match. The "А"/"В"/"С" letters
// (sectors A/B/C) are Cyrillic in the source, while D-U use Latin glyphs —
// quirk of the report's typesetting, preserved exactly to avoid Unicode
// confusion.
const VAT_SECTORS: SectorDef[] = [
  {
    id: "A",
    letter: "А",
    labelBg: "Селско, горско и рибно стопанство",
    labelEn: "Agriculture, forestry & fishing",
    re: /^\s*А\s+Селско/,
  },
  {
    id: "B",
    letter: "В",
    labelBg: "Добивна промишленост",
    labelEn: "Mining & quarrying",
    re: /^\s*В\s+Добивна/,
  },
  {
    id: "C",
    letter: "С",
    labelBg: "Преработваща промишленост",
    labelEn: "Manufacturing",
    re: /^\s*С\s+Преработваща/,
  },
  {
    id: "D",
    letter: "D",
    labelBg:
      "Производство и разпределение на електрическа и топлинна енергия и на газообразни горива",
    labelEn: "Electricity, gas, steam & air conditioning supply",
    re: /^\s*D\s+Производство/,
  },
  {
    id: "E",
    letter: "E",
    labelBg:
      "Доставяне на води; канализационни услуги, управление на отпадъци и възстановяване",
    labelEn: "Water supply, sewerage, waste management",
    re: /^\s*E\s+Доставяне/,
  },
  {
    id: "F",
    letter: "F",
    labelBg: "Строителство",
    labelEn: "Construction",
    re: /^\s*F\s+Строителство/,
  },
  {
    id: "G",
    letter: "G",
    labelBg: "Търговия; ремонт на автомобили и мотоциклети",
    labelEn: "Wholesale & retail trade",
    re: /^\s*G\s+Търговия/,
  },
  {
    id: "H",
    letter: "H",
    labelBg: "Транспорт, складиране и пощи",
    labelEn: "Transportation & storage",
    re: /^\s*H\s+Транспорт/,
  },
  {
    id: "I",
    letter: "I",
    labelBg: "Хотелиерство и ресторантьорство",
    labelEn: "Accommodation & food service",
    re: /^\s*I\s+Хотелиерство/,
  },
  {
    id: "J",
    letter: "J",
    labelBg:
      "Създаване и разпространение на информация и творчески продукти; далекосъобщения",
    labelEn: "Information & communication",
    re: /^\s*J\s+Създаване/,
  },
  {
    id: "K",
    letter: "K",
    labelBg: "Финансови и застрахователни дейности",
    labelEn: "Financial & insurance activities",
    re: /^\s*K\s+Финансови/,
  },
  {
    id: "L",
    letter: "L",
    labelBg: "Операции с недвижими имоти",
    labelEn: "Real estate activities",
    re: /^\s*L\s+Операции/,
  },
  {
    id: "M",
    letter: "M",
    labelBg: "Професионални дейности и научни изследвания",
    labelEn: "Professional, scientific & technical activities",
    re: /^\s*M\s+Професионални/,
  },
  {
    id: "N",
    letter: "N",
    labelBg: "Административни и спомагателни дейности",
    labelEn: "Administrative & support service activities",
    re: /^\s*N\s+Административни/,
  },
  {
    id: "O",
    letter: "O",
    labelBg: "Държавно управление",
    labelEn: "Public administration & defence",
    re: /^\s*O\s+Държавно/,
  },
  {
    id: "P",
    letter: "P",
    labelBg: "Образование",
    labelEn: "Education",
    re: /^\s*P\s+Образование/,
  },
  {
    id: "Q",
    letter: "Q",
    labelBg: "Хуманно здравеопазване и социална работа",
    labelEn: "Human health & social work",
    re: /^\s*Q\s+Хуманно/,
  },
  {
    id: "R",
    letter: "R",
    labelBg: "Култура, спорт и развлечения",
    labelEn: "Arts, entertainment & recreation",
    re: /^\s*R\s+Култура/,
  },
  {
    id: "S",
    letter: "S",
    labelBg: "Други дейности",
    labelEn: "Other service activities",
    re: /^\s*S\s+Други/,
  },
  {
    id: "T",
    letter: "T",
    labelBg: "Дейности на домакинства като работодатели",
    labelEn: "Activities of households as employers",
    re: /^\s*T\s+Дейности/,
  },
  {
    id: "U",
    letter: "U",
    labelBg: "Дейности на екстериториални организации и служби",
    labelEn: "Extraterritorial organisations",
    re: /^\s*U\s+Дейности/,
  },
  {
    id: "X",
    letter: "—",
    labelBg: "Не е посочена икономическа дейност",
    labelEn: "Economic activity not specified",
    re: /^\s*Не е посочена/,
  },
];

// Token regex — a Bulgarian decimal cell ("11 694,4", "—", "-374,6").
const TOKEN_RE = /-?\d[\d \u00a0\u202f]*(?:,\d+)?/g;

// Locate Table 3 in the text. We split the text at the "Таблица № 3" header
// and the next chapter heading ("Корпоративен данък"). Then walk lines and
// match each sector definition.
//
// Within each sector row the figures appear on the row's last text line
// (when the sector name wraps, the row spans two lines: the FIRST has letter
// + name only, the SECOND has the trailing name plus the 9 numeric cells).
// We collect numeric tokens from the row's first line AND the next two lines
// until we have at least 9 numbers — that catches both single-line rows
// (most) and wrapped rows.
interface VatSectorRow {
  id: string;
  labelBg: string;
  labelEn: string;
  declaredToPay: number | null; // млн. лв.  Деклариран ДДС за внасяне 2024
  declaredToRefund: number | null;
  declaredNet: number | null; // 2024 net (positive = net inflow from sector)
}

export interface VatBreakdownFile {
  generatedAt: string;
  country: "BG";
  fiscalYear: number;
  asOf: string;
  currency: "BGN" | "EUR";
  source: {
    publisher: string;
    document: string;
    url: string;
  };
  declaredNet: number | null; // total declared net VAT (TT only, native units)
  declaredNetEur: number | null;
  sectors: Array<{
    id: string;
    labelBg: string;
    labelEn: string;
    declaredToPay: number | null; // native units (lev for BGN years)
    declaredToPayEur: number | null;
    declaredToRefund: number | null;
    declaredToRefundEur: number | null;
    declaredNet: number | null;
    declaredNetEur: number | null;
    share: number | null; // share of total declaredNet (signed)
  }>;
}

const parseVatTable3 = (text: string): VatSectorRow[] => {
  const start = text.indexOf("Таблица № 3:");
  const end = text.indexOf("Корпоративен данък", start);
  if (start < 0 || end < 0) return [];
  const slice = text.slice(start, end);
  const lines = slice.split("\n");

  const rows: VatSectorRow[] = [];
  for (const def of VAT_SECTORS) {
    // Find the line that starts this row.
    const idx = lines.findIndex((l) => def.re.test(l));
    if (idx < 0) continue;
    // The numeric cells live on the row's first OR up-to-seventh line —
    // sector T's name wraps across 5 lines before the numbers ("Дейности на
    // домакинства като работодатели; Недиференцирани дейности на домакинства
    // по производство на стоки и услуги за собствено потребление"). We stop
    // at 8 lines or when we hit the NEXT sector row, whichever comes first.
    const stopRe = /^\s*(?:[А-Я]|[A-T]|Не е посочена|ОБЩО:?)\s+\S/;
    const candidateLines: string[] = [lines[idx]];
    for (let i = idx + 1; i < Math.min(lines.length, idx + 8); i++) {
      if (i > idx + 1 && stopRe.test(lines[i])) break;
      candidateLines.push(lines[i]);
    }
    const joined = candidateLines.join(" ");
    const tokens = joined.match(TOKEN_RE) ?? [];
    // Filter to "real" numeric cells: drop the leading sector-letter wrap by
    // taking tokens that parse to a number.
    const cells = tokens
      .map((t) => parseMillions(t))
      .filter((n): n is number => n != null);
    // Expected 9 cells per row: [pay2023, pay2024, payΔ, payΔ%, refund2023,
    //                            refund2024, refundΔ, refundΔ%, net2023,
    //                            net2024, netΔ]. The table actually carries
    // 11 cells per row (3 groups, 9 of which we'd target). The "Деклариран
    // нетен ДДС 2024" we want lives at index 9 (0-based, in an 11-cell row).
    // But some rows publish only 10 cells (missing trailing Δ). To be robust,
    // take the LAST cell from the second numeric group ("net 2024") via:
    //   payToCells[0..3], refundCells[4..7], netCells[8..10]
    // and pick netCells[1] = the 10th (net 2024).
    // We also handle 9-cell rows (Δ% sometimes absent) by:
    //   pay = cells[0..3] (pay block — 4 cells incl. Δ%)
    //   if cells.length >= 10: refund = cells[4..7], net = cells[8..10]
    //   else: refund = cells[3..6], net = cells[7..]
    if (cells.length < 8) continue;
    let declaredToPay: number | null = null;
    let declaredToRefund: number | null = null;
    let declaredNet: number | null = null;
    if (cells.length >= 10) {
      declaredToPay = cells[1]; // 2024 pay
      declaredToRefund = cells[5]; // 2024 refund
      declaredNet = cells[9]; // 2024 net
    } else {
      // Fallback for shorter rows — best-effort.
      declaredToPay = cells[1] ?? null;
      declaredToRefund = cells[4] ?? null;
      declaredNet = cells[7] ?? null;
    }
    rows.push({
      id: def.id,
      labelBg: def.labelBg,
      labelEn: def.labelEn,
      declaredToPay,
      declaredToRefund,
      declaredNet,
    });
  }
  return rows;
};

// ---------------------------------------------------------------------------
// PIT — Tables 8 (employment) + 10 (freelance) + narrative (final tax)
// ---------------------------------------------------------------------------

interface PitRow {
  id: string;
  labelBg: string;
  labelEn: string;
  amount2024: number | null;
}

export interface PitBreakdownFile {
  generatedAt: string;
  country: "BG";
  fiscalYear: number;
  asOf: string;
  currency: "BGN" | "EUR";
  source: {
    publisher: string;
    document: string;
    url: string;
  };
  lines: Array<{
    id: string;
    labelBg: string;
    labelEn: string;
    amount: number | null;
    amountEur: number | null;
    parent: string | null;
    share?: number | null;
  }>;
  total: number | null;
  totalEur: number | null;
  // Table 9: employment-PIT due contributions by КИД-2008 sector. Note: the
  // source publishes Jan-Nov values (11 months) NOT a full-year cumulative —
  // the only sector-of-origin lens НАП ships and it's stuck on this coverage
  // every year. Use shares for proportional analysis; treat the absolute
  // amounts as a representative sample.
  bySector: {
    coverage: string; // "Jan-Nov 2024" — copy of the source caveat
    total: number | null;
    totalEur: number | null;
    sectors: Array<{
      id: string;
      labelBg: string;
      labelEn: string;
      amount: number | null;
      amountEur: number | null;
      share: number | null;
    }>;
  };
}

const PIT_EMPLOYMENT_ROWS: Array<{
  id: string;
  labelBg: string;
  labelEn: string;
  re: RegExp;
}> = [
  {
    id: "emp_declaration",
    labelBg: "Плащане по декларация",
    labelEn: "Payment by declaration",
    re: /^\s*Плащане по декларация\s/,
  },
  {
    id: "emp_revision_act",
    labelBg: "Плащане по РА",
    labelEn: "Payment by revision act",
    re: /^\s*Плащане по РА\s/,
  },
  {
    id: "emp_interest",
    labelBg: "Плащане на лихви за ДДФЛ",
    labelEn: "Interest payments",
    re: /^\s*Плащане на лихви за ДДФЛ\s/,
  },
  {
    id: "emp_past_years",
    labelBg: "Плащане на ДДФЛ за минали години",
    labelEn: "Past-year arrears",
    re: /^\s*Плащане на ДДФЛ за минали години\s/,
  },
  {
    id: "emp_refunded",
    labelBg: "Възстановен и прихванат данък",
    labelEn: "Refunded & offset (negative)",
    re: /^\s*Възстановен и прихванат данък\s/,
  },
];

const PIT_NONEMP_ROWS: Array<{
  id: string;
  labelBg: string;
  labelEn: string;
  re: RegExp;
}> = [
  {
    id: "non_declaration",
    labelBg: "Плащане по декларация",
    labelEn: "Payment by declaration",
    re: /^\s*Плащане по декларация\s/,
  },
  {
    id: "non_advance",
    labelBg: "Плащане на авансови вноски",
    labelEn: "Advance payments",
    re: /^\s*Плащане на авансови вноски\s/,
  },
  {
    id: "non_revision_act",
    labelBg: "Плащане по РА",
    labelEn: "Payment by revision act",
    re: /^\s*Плащане по РА\s/,
  },
  {
    id: "non_interest",
    labelBg: "Плащане на лихви за ДДФЛ",
    labelEn: "Interest payments",
    re: /^\s*Плащане на лихви за ДДФЛ\s/,
  },
  {
    id: "non_past_years",
    labelBg: "Плащане за минали години",
    labelEn: "Past-year arrears",
    re: /^\s*Плащане за минали години\s/,
  },
  {
    id: "non_refunded",
    labelBg: "Възстановен и прихванат данък",
    labelEn: "Refunded & offset (negative)",
    re: /^\s*Възстановен и прихванат данък\s/,
  },
];

// Parse a payment-type sub-table bounded by [start, end] header markers.
// Each row has 4 numeric cells: 2023, 2024, Δ%, ΔLEV. We want index 1 (2024).
const parsePaymentTable = (
  text: string,
  startMarker: string,
  endMarker: string,
  rowDefs: Array<{ id: string; labelBg: string; labelEn: string; re: RegExp }>,
): PitRow[] => {
  const start = text.indexOf(startMarker);
  const end = endMarker ? text.indexOf(endMarker, start) : text.length;
  if (start < 0) return [];
  const slice = text.slice(start, end > start ? end : text.length);
  const lines = slice.split("\n");
  const out: PitRow[] = [];
  for (const def of rowDefs) {
    const ln = lines.find((l) => def.re.test(l));
    if (!ln) continue;
    const tokens = ln.match(TOKEN_RE) ?? [];
    const cells = tokens
      .map((t) => parseMillions(t))
      .filter((n): n is number => n != null);
    if (cells.length < 2) continue;
    out.push({
      id: def.id,
      labelBg: def.labelBg,
      labelEn: def.labelEn,
      amount2024: cells[1],
    });
  }
  return out;
};

// Extract the narrative "Окончателен данък + dividends" total. The 2024 PDF
// says: "постъпленията от тези данъци през 2024 г. са в размер на 611,3 млн.
// лeва" — note the typo "лeва" (Latin e in лева, in some editions).
const parseFinalTax = (text: string): number | null => {
  const re =
    /Окончателен данък.{0,400}?са\s+в\s+размер\s+на\s+(\d[\d \u00a0\u202f]*(?:,\d+)?)\s*млн\.?\s*лe?ва/is;
  const m = text.match(re);
  return m ? parseMillions(m[1]) : null;
};

// ---------------------------------------------------------------------------
// PIT by КИД-2008 sector — Table 9
// ---------------------------------------------------------------------------

// Parse a raw lev integer ("88 211 404", "724 384 314") to a Number. Unlike
// parseMillions, the source values are NOT divided by a million — they are
// full lev amounts. Returns null on unparseable input.
const parseLev = (raw: string): number | null => {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[\s\u00a0\u202f\u2009]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

interface PitSectorRow {
  id: string;
  labelBg: string;
  labelEn: string;
  amount2024: number | null; // raw lev (Jan-Nov 2024 coverage)
}

// Parse Table 9: due employment-PIT contributions by КИД-2008 sector. Values
// are full lev integers (not millions); the table covers Jan-Nov only — note
// the source itself, not us, applies this 11-month window every year.
const parsePitTable9 = (text: string): PitSectorRow[] => {
  const start = text.indexOf("Таблица № 9:");
  // Bounded by the next narrative chunk ("Най-голям ръст") so stray sector
  // mentions in commentary don't leak in.
  const end = text.indexOf("Най-голям", start);
  if (start < 0) return [];
  const slice = text.slice(start, end > start ? end : text.length);
  const lines = slice.split("\n");

  const rows: PitSectorRow[] = [];
  for (const def of VAT_SECTORS) {
    const idx = lines.findIndex((l) => def.re.test(l));
    if (idx < 0) continue;
    // Same lookahead window as Table 3 — multi-line label wraps push the
    // numeric cells onto a subsequent line.
    const stopRe = /^\s*(?:[А-Я]|[A-T]|Не е посочена|ОБЩО:?)\s+\S/;
    const candidateLines: string[] = [lines[idx]];
    for (let i = idx + 1; i < Math.min(lines.length, idx + 8); i++) {
      if (i > idx + 1 && stopRe.test(lines[i])) break;
      candidateLines.push(lines[i]);
    }
    const joined = candidateLines.join(" ");
    // Cells per row: [2023 lev, 2024 lev, ΔLEV lev, Δ%]. We want index 1.
    //
    // Table 9 cells are integer lev counts with single-space thousand
    // separators ("88 211 404"). The naive approach — split on ≥2 spaces —
    // FAILS for rows whose columns are tight ("88 211 404 103 436 221"
    // separates with only ONE space between cells, identical to the
    // intra-cell separator).
    //
    // Cap each numeric token at "leading 1-3 digits + up to 2 trailing
    // 3-digit groups" = max 9 digits. Cap chosen because all known PIT
    // sector amounts are <1B lev (≤9 digits). For tight-spaced rows this
    // forces a break at the cell boundary; for loose-spaced rows it still
    // matches the full cell.
    const NUMERIC_CELL_RE = /\d{1,3}(?:\s\d{3}){0,2}(?!\d)/g;
    const matches = Array.from(joined.matchAll(NUMERIC_CELL_RE));
    const cells: number[] = [];
    for (const m of matches) {
      const v = parseLev(m[0]);
      if (v != null) cells.push(v);
    }
    if (cells.length < 2) continue;
    rows.push({
      id: def.id,
      labelBg: def.labelBg,
      labelEn: def.labelEn,
      amount2024: cells[1],
    });
  }
  return rows;
};

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

interface NapAnnualOutput {
  vat: VatBreakdownFile;
  pit: PitBreakdownFile;
}

export const parseNapAnnualPdf = (
  pdfPath: string,
  fiscalYear: number,
  source: { url: string },
): NapAnnualOutput => {
  const text = extractTextLayout(pdfPath);
  const currency: "BGN" | "EUR" = fiscalYear >= 2026 ? "EUR" : "BGN";

  // --- VAT ---
  const vatRows = parseVatTable3(text);
  const totalDeclaredNet = vatRows.reduce(
    (s, r) => s + (r.declaredNet ?? 0),
    0,
  );
  const vatTotalMoney = toMoney(totalDeclaredNet, currency);
  const vatSectors = vatRows.map((r) => {
    const pay = toMoney(r.declaredToPay, currency);
    const refund = toMoney(r.declaredToRefund, currency);
    const net = toMoney(r.declaredNet, currency);
    return {
      id: r.id,
      labelBg: r.labelBg,
      labelEn: r.labelEn,
      declaredToPay: pay?.amount ?? null,
      declaredToPayEur: pay?.amountEur ?? null,
      declaredToRefund: refund?.amount ?? null,
      declaredToRefundEur: refund?.amountEur ?? null,
      declaredNet: net?.amount ?? null,
      declaredNetEur: net?.amountEur ?? null,
      share:
        net && totalDeclaredNet !== 0
          ? (r.declaredNet ?? 0) / totalDeclaredNet
          : null,
    };
  });

  const vat: VatBreakdownFile = {
    generatedAt: new Date().toISOString(),
    country: "BG",
    fiscalYear,
    asOf: `${fiscalYear}-12-31`,
    currency,
    source: {
      publisher: "Национална агенция за приходите (НАП)",
      document: `Годишен отчет за дейността на НАП ${fiscalYear}`,
      url: source.url,
    },
    declaredNet: vatTotalMoney?.amount ?? null,
    declaredNetEur: vatTotalMoney?.amountEur ?? null,
    sectors: vatSectors,
  };

  // --- PIT ---
  const empRows = parsePaymentTable(
    text,
    "Таблица № 8:",
    "Таблица № 9:",
    PIT_EMPLOYMENT_ROWS,
  );
  const nonRows = parsePaymentTable(
    text,
    "Таблица № 10:",
    "Окончателен данък",
    PIT_NONEMP_ROWS,
  );
  const finalTax = parseFinalTax(text);

  // Sum each category; refunds are subtracted from the gross.
  const sumCategory = (rows: PitRow[], refundIds: Set<string>): number => {
    let s = 0;
    for (const r of rows) {
      if (r.amount2024 == null) continue;
      s += refundIds.has(r.id) ? -r.amount2024 : r.amount2024;
    }
    return s;
  };
  const empTotal = sumCategory(empRows, new Set(["emp_refunded"]));
  const nonTotal = sumCategory(nonRows, new Set(["non_refunded"]));
  const pitTotal = empTotal + nonTotal + (finalTax ?? 0);

  const m = (v: number | null) => toMoney(v, currency);

  const pitLines: PitBreakdownFile["lines"] = [];
  pitLines.push({
    id: "pit_employment_net",
    labelBg: "ДДФЛ от трудови правоотношения (нетно)",
    labelEn: "Personal income tax — employment (net)",
    amount: m(empTotal)?.amount ?? null,
    amountEur: m(empTotal)?.amountEur ?? null,
    parent: null,
  });
  for (const r of empRows) {
    const money = m(
      r.id === "emp_refunded" ? -(r.amount2024 ?? 0) : r.amount2024,
    );
    pitLines.push({
      id: r.id,
      labelBg: r.labelBg,
      labelEn: r.labelEn,
      amount: money?.amount ?? null,
      amountEur: money?.amountEur ?? null,
      parent: "pit_employment_net",
    });
  }
  pitLines.push({
    id: "pit_nonemployment_net",
    labelBg: "ДДФЛ от извънтрудови правоотношения (нетно)",
    labelEn: "Personal income tax — non-employment (net)",
    amount: m(nonTotal)?.amount ?? null,
    amountEur: m(nonTotal)?.amountEur ?? null,
    parent: null,
  });
  for (const r of nonRows) {
    const money = m(
      r.id === "non_refunded" ? -(r.amount2024 ?? 0) : r.amount2024,
    );
    pitLines.push({
      id: r.id,
      labelBg: r.labelBg,
      labelEn: r.labelEn,
      amount: money?.amount ?? null,
      amountEur: money?.amountEur ?? null,
      parent: "pit_nonemployment_net",
    });
  }
  pitLines.push({
    id: "pit_final_tax",
    labelBg: "Окончателен данък и дивиденти",
    labelEn: "Final tax (residents/non-residents) & dividends",
    amount: m(finalTax)?.amount ?? null,
    amountEur: m(finalTax)?.amountEur ?? null,
    parent: null,
  });
  for (const ln of pitLines) {
    if (ln.parent == null || ln.amount == null) continue;
    const parentLine = pitLines.find((p) => p.id === ln.parent);
    if (!parentLine || !parentLine.amount) continue;
    ln.share = ln.amount / parentLine.amount;
  }

  const totMoney = m(pitTotal);

  // --- PIT by sector (Table 9, employment-PIT due contributions, Jan-Nov) ---
  const sectorRows = parsePitTable9(text);
  const sectorTotalLev = sectorRows.reduce(
    (s, r) => s + (r.amount2024 ?? 0),
    0,
  );
  // sectorRows amounts are in raw lev; convert to native-currency-millions for
  // toMoney by dividing by 1e6.
  const sectorMoney = (lev: number | null) =>
    lev == null ? null : toMoney(lev / 1_000_000, currency);
  const sectorTotalMoney = sectorMoney(sectorTotalLev);
  const sectorEntries = sectorRows.map((r) => {
    const money = sectorMoney(r.amount2024);
    return {
      id: r.id,
      labelBg: r.labelBg,
      labelEn: r.labelEn,
      amount: money?.amount ?? null,
      amountEur: money?.amountEur ?? null,
      share:
        r.amount2024 != null && sectorTotalLev !== 0
          ? r.amount2024 / sectorTotalLev
          : null,
    };
  });

  const pit: PitBreakdownFile = {
    generatedAt: new Date().toISOString(),
    country: "BG",
    fiscalYear,
    asOf: `${fiscalYear}-12-31`,
    currency,
    source: {
      publisher: "Национална агенция за приходите (НАП)",
      document: `Годишен отчет за дейността на НАП ${fiscalYear}`,
      url: source.url,
    },
    lines: pitLines,
    total: totMoney?.amount ?? null,
    totalEur: totMoney?.amountEur ?? null,
    bySector: {
      coverage: `Jan-Nov ${fiscalYear}`,
      total: sectorTotalMoney?.amount ?? null,
      totalEur: sectorTotalMoney?.amountEur ?? null,
      sectors: sectorEntries,
    },
  };

  return { vat, pit };
};

// Hand-curated catalogue of NAP annual-report URLs. New years get added once
// the report is approved (typically early March of year T+1).
export const NAP_ANNUAL_REPORTS: Record<number, string> = {
  2024: "https://nra.bg/wps/wcm/connect/nra.bg25863/35154c13-e039-4fa4-9702-8cebf8adad22/%D0%93%D0%BE%D0%B4%D0%B8%D1%88%D0%B5%D0%BD_%D0%BE%D1%82%D1%87%D0%B5%D1%82_%D0%9D%D0%90%D0%9F_2024+-%D0%BE%D0%B4%D0%BE%D0%B1%D1%80%D0%B5%D0%BD+%D1%81+%D0%A0%D0%9C%D0%A4-3-07032025%D0%B3..pdf?MOD=AJPERES",
};
