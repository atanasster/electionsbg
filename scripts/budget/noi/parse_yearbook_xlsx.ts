// Parses the НОИ pension statistical yearbook — the ZIP-of-XLSX edition, not
// the PDF. НОИ publishes the same yearbook two ways; we used to PDF-scrape one
// table (6.3) via parse_pension_yearbook.ts, but the ZIP carries 11 clean
// chapter workbooks with far more grain: per-oblast (chapter 9), the pension
// size distribution (chapter 5), and the national headline series (chapter 1).
//
// Structure is UNSTABLE across years (verified 2022/2023/2024) — a parser that
// keys on exact sheet names or row indices silently misaligns. Every rule below
// exists because a real year broke the naive version:
//
//   * 2021/2025 URLs return an HTML 404 with HTTP 200 → the caller sniffs the
//     PK zip magic bytes, not the status code.
//   * Sheet names drift: "9.8-2024 " (trailing space) / "9.8 " (2023, no year
//     suffix) / "9.2-2022  " (two spaces); "9.5" gains a stray dot in 2022/24.
//     → normalizeCode() strips "-YYYY", all whitespace and a trailing dot.
//   * 2023 injects a "към съдържание" nav row at the top, shifting every table
//     by one → anchor on header text, never an absolute index.
//   * Size-bracket boundaries change every year (they track the minimum
//     pension) and the topology changed in 2024 (a bin split in two) → read the
//     edges from the sheet, never hardcode.
//   * 2022 uses comma decimals ("222,30") → parseNum handles both.
//   * Memo rows (no numeric ordinal in col A) must be dropped or the brackets
//     double-count → the gate is that ordinal rows sum EXACTLY to the "Общо"
//     headline, asserted per year.
//   * The 29th oblast row is not an oblast (three different names across
//     sources) → identified by ordinal, excluded.
//
// Values are in лева across the whole 2022-2024 corpus → converted to EUR at
// ingest (BGN_PER_EUR).

import { AdmZip } from "../../lib/adm_zip";
import * as XLSX from "xlsx";
import { toEur } from "../../../src/lib/currency";

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

/** National headline series (chapter 1.3 + 1.1), one row per calendar year. */
export interface NoiNationalYear {
  year: number;
  avgWageBgn: number | null; // средна месечна работна заплата
  avgWageEur: number | null;
  avgInsurableIncomeBgn: number | null; // среден осигурителен доход
  avgInsurableIncomeEur: number | null;
  avgPensionBgn: number | null; // среден размер на пенсията
  avgPensionEur: number | null;
  pensionerCount: number | null; // 31.12 pensioners (thousands → absolute)
}

/** One pension-size bracket (chapter 5.1). Boundaries are the year's statutory
 *  thresholds, so they move — always carry them explicitly. */
export interface NoiBracket {
  index: number; // 1..N, the sheet's own ordinal
  lo: number | null; // лв, null = open lower bound ("до X")
  hi: number | null; // лв, null = open upper bound ("над X")
  labelBg: string;
  count: number;
  share: number; // of the year's total
}

export interface NoiDistributionYear {
  year: number;
  total: number; // "Общо" pensioners headline
  minPensionBgn: number | null; // the "до X лв. вкл." memo edge = statutory min
  atCapCount: number | null; // "на 3400 лв." memo row (exactly at the cap)
  capBgn: number | null; // the cap edge itself
  aboveCapCount: number | null; // "над 3400 лв." bracket
  // At-risk-of-poverty monthly threshold (single person, 60% of median),
  // Eurostat ilc_li01 — the line to shade on the histogram. Null when the
  // Eurostat fetch was unavailable at ingest. Filled by fetchPovertyLines().
  povertyLineBgn: number | null;
  brackets: NoiBracket[];
}

/** Per-oblast row (chapter 9.8 avg pension + 9.11/9.1 cash-vs-bank). */
export interface NoiOblastRow {
  code: string; // canonical oblast code (SOF/SFO/… — see NOI_OBLAST_CODE)
  nameBg: string;
  avgPensionBgn: number;
  avgPensionEur: number;
  yoyPct: number | null; // this year in % of prior (1.12 = +12%)
  pensions: number | null; // total pensions (9.1)
  bankPaid: number | null; // paid to a bank account (9.11)
  cashPaid: number | null; // pensions − bank
  cashShare: number | null; // cashPaid / pensions
}

export interface NoiPensionsFile {
  generatedAt: string;
  source: {
    publisher: string;
    urlTemplate: string;
    description: string;
  };
  latestYear: number;
  years: number[];
  national: NoiNationalYear[];
  distribution: NoiDistributionYear[];
  oblasts: Record<number, NoiOblastRow[]>; // keyed by year
}

// ---------------------------------------------------------------------------
// НОИ oblast label → canonical code. НОИ numbers its own 28 ТП (Добрич at #24,
// out of alphabetical order) plus a 29th non-oblast row; we join by cleaned
// name, not ordinal. The Sofia trap: "София-град" is the capital (SOF), bare
// "София" is the rural oblast (SFO). Row 29 (Турция и ЕРМД / Европейски
// регламенти / ЦУ на НОИ, depending on the sheet) is excluded upstream.
// ---------------------------------------------------------------------------
export const NOI_OBLAST_CODE: Record<string, string> = {
  Благоевград: "BLG",
  Бургас: "BGS",
  Варна: "VAR",
  "Велико Търново": "VTR",
  Видин: "VID",
  Враца: "VRC",
  Габрово: "GAB",
  Кърджали: "KRZ",
  Кюстендил: "KNL",
  Ловеч: "LOV",
  Монтана: "MON",
  Пазарджик: "PAZ",
  Перник: "PER",
  Плевен: "PVN",
  Пловдив: "PDV",
  Разград: "RAZ",
  Русе: "RSE",
  Силистра: "SLS",
  Сливен: "SLV",
  Смолян: "SML",
  "София-град": "SOF",
  София: "SFO",
  "Стара Загора": "SZR",
  Добрич: "DOB",
  Търговище: "TGV",
  Хасково: "HKV",
  Шумен: "SHU",
  Ямбол: "JAM",
};

// ---------------------------------------------------------------------------
// Cell / sheet helpers
// ---------------------------------------------------------------------------

type Row = unknown[];

/** Normalize a sheet name to its bare numeric code: "9.8-2024 " → "9.8",
 *  "9.5.-2024" → "9.5", "1.1 2024" → "1.1". */
const normalizeCode = (sheetName: string): string =>
  sheetName
    .replace(/[-\s]?20\d\d/g, "") // drop the year suffix (with or without dash)
    .replace(/\s+/g, "") // drop all whitespace
    .replace(/\.$/, ""); // drop a trailing dot (the 9.5. case)

/** Find the sheet whose normalized name equals `code` (e.g. "9.8"). */
const findSheet = (wb: XLSX.WorkBook, code: string): XLSX.WorkSheet | null => {
  const match = wb.SheetNames.find((n) => normalizeCode(n) === code);
  return match ? wb.Sheets[match] : null;
};

const rowsOf = (sheet: XLSX.WorkSheet): Row[] =>
  XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  }) as Row[];

const text = (v: unknown): string =>
  v == null ? "" : String(v).replace(/\s+/g, " ").trim();

/** Parse a number that may be a JS number, a comma-decimal string ("222,30"),
 *  or carry thousands separators. Returns null when not numeric. */
const parseNum = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  // Bulgarian convention: comma is the DECIMAL separator, dot/space are the
  // thousands separators. Strip only dot-thousands (a dot before a 3-digit group
  // that ends the run), then turn the decimal comma into a dot. Doing it the
  // other way — stripping a comma before 3 digits — would wrongly collapse a
  // genuine comma-decimal like "1,128" (=1.128) to 1128.
  const cleaned = v
    .replace(/\s/g, "") // \s covers NBSP (U+00A0)
    .replace(/\.(?=\d{3}(?:\D|$))/g, "") // dot = thousands separator
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

// The yearbook reports лв for every period through 2025. From 2026 (euro
// adoption) НОИ will report euro-native figures, and dividing those by 1.95583
// would silently halve every amount. Fail loudly rather than mis-scale: when a
// euro-native yearbook lands, this assert is the reminder to change the basis.
const eur = (bgn: number, year: number): number => {
  if (year >= 2026)
    throw new Error(
      `NOI yearbook ${year}: source is euro-native from 2026 — remove the ` +
        `BGN→EUR conversion (toEur) before ingesting this period.`,
    );
  return Math.round(toEur(bgn, "BGN") ?? bgn);
};

/** True for a cell that starts with a numeric ordinal ("1.", " 15.", "17"). */
const leadingOrdinal = (v: unknown): number | null => {
  const m = text(v).match(/^(\d+)\s*\.?/);
  return m ? Number(m[1]) : null;
};

// ---------------------------------------------------------------------------
// Chapter 1 — national headline series (1.1 pensioners, 1.3 wage/income/pension)
// ---------------------------------------------------------------------------

/** Read a "Показатели | 2020 | 2021 | … | 2024" sheet, returning the year
 *  columns and a lookup that finds a labelled row's value for a given year. */
const readYearMatrix = (
  sheet: XLSX.WorkSheet,
): {
  years: number[];
  valueAt: (labelRe: RegExp, year: number) => number | null;
} => {
  const rows = rowsOf(sheet);
  // Header row = the first row whose cells past col 0 are mostly 4-digit years.
  let headerIdx = -1;
  let years: number[] = [];
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const yrs = rows[i]
      .slice(1)
      .map((c) => parseNum(c))
      .filter((n): n is number => n != null && n >= 2000 && n <= 2100);
    if (yrs.length >= 3) {
      headerIdx = i;
      years = rows[i].map((c) => parseNum(c) ?? 0) as number[]; // col-index → year
      break;
    }
  }
  const valueAt = (labelRe: RegExp, year: number): number | null => {
    const col = years.findIndex((y) => y === year);
    if (col < 0) return null;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      if (labelRe.test(text(rows[i][0]))) return parseNum(rows[i][col]);
    }
    return null;
  };
  return {
    years: years.filter((y) => y >= 2000 && y <= 2100),
    valueAt,
  };
};

const parseNational = (wb: XLSX.WorkBook): NoiNationalYear[] => {
  const s13 = findSheet(wb, "1.3");
  if (!s13) return [];
  const m13 = readYearMatrix(s13);
  // pensionerCount is filled later from the validated distribution total (the
  // exact 31.12 pensioner headcount), which is more robust than the 1.1 sheet's
  // thousands-rounded average — see buildNoiPensionsFile.
  return m13.years.map((year) => {
    const avgPensionBgn = m13.valueAt(
      /един пенсионер общо за всички видове пенсии$/i,
      year,
    );
    const avgWageBgn = m13.valueAt(/Средна месечна работна заплата/i, year);
    const avgInsurableIncomeBgn = m13.valueAt(
      /Среден осигурителен доход/i,
      year,
    );
    // Every monetary field carries its EUR sibling — convert at ingest so the
    // frontend never re-does it client-side (project euro convention).
    return {
      year,
      avgWageBgn,
      avgWageEur: avgWageBgn != null ? eur(avgWageBgn, year) : null,
      avgInsurableIncomeBgn,
      avgInsurableIncomeEur:
        avgInsurableIncomeBgn != null ? eur(avgInsurableIncomeBgn, year) : null,
      avgPensionBgn,
      avgPensionEur: avgPensionBgn != null ? eur(avgPensionBgn, year) : null,
      pensionerCount: null,
    };
  });
};

// ---------------------------------------------------------------------------
// Chapter 5.1 — pension size distribution
// ---------------------------------------------------------------------------

/** Extract the lo/hi лв edges from a bracket label:
 *   "до 276.37 лв."           → { lo: null, hi: 276.37 }
 *   "от 276.37 до 435.43 лв."  → { lo: 276.37, hi: 435.43 }
 *   "над 3400.00 лв."          → { lo: 3400, hi: null } */
const bracketEdges = (
  label: string,
): { lo: number | null; hi: number | null } => {
  // Strip inner spaces before the number match so a space-grouped threshold
  // ("над 3 400.00 лв.") reads as 3400, not 3. The preposition detection below
  // still runs against the original (spaced) label.
  const nums = (label.replace(/\s/g, "").match(/\d+[.,]?\d*/g) ?? []).map(
    (s) => parseNum(s)!,
  );
  // NB: JS `\b` does not anchor on Cyrillic letters, so match a following
  // space, not a word boundary, after "до" / "над" / "от".
  if (/^\s*до\s/i.test(label)) return { lo: null, hi: nums[0] ?? null };
  if (/^\s*над\s/i.test(label)) return { lo: nums[0] ?? null, hi: null };
  if (/^\s*от\s/i.test(label))
    return { lo: nums[0] ?? null, hi: nums[1] ?? null };
  return { lo: null, hi: null };
};

const parseDistribution = (
  wb: XLSX.WorkBook,
  year: number,
): NoiDistributionYear | null => {
  const sheet = findSheet(wb, "5.1");
  if (!sheet) return null;
  const rows = rowsOf(sheet);

  // "Общо" headline: the total-pensioners row — first data row whose label is
  // exactly "Общо" and whose count column carries the grand total.
  let total = 0;
  // The count lives in column C (index 2), not B. Find it by scanning the
  // Общо row for the largest numeric cell (the % columns are < 1).
  const totalRow = rows.find((r) => /^Общо$/i.test(text(r[1])));
  if (totalRow) {
    for (const c of totalRow.slice(2)) {
      const n = parseNum(c);
      if (n != null && n > total) total = n;
    }
  }
  if (!total) return null;

  const brackets: NoiBracket[] = [];
  let minPensionBgn: number | null = null;
  let capBgn: number | null = null;
  let atCapCount: number | null = null;
  let aboveCapCount: number | null = null;

  for (const r of rows) {
    const ord = leadingOrdinal(r[0]);
    const label = text(r[1]);
    // Bracket rows: a numeric ordinal in col A. Memo rows have an empty col A.
    if (ord != null && label) {
      // count = first numeric cell after the label that is a plausible count
      // (>= 1, integer-ish), i.e. column C onward, skipping the % columns.
      let count: number | null = null;
      for (const c of r.slice(2)) {
        const n = parseNum(c);
        if (n != null && n >= 1) {
          count = n;
          break;
        }
      }
      if (count == null) continue;
      const { lo, hi } = bracketEdges(label);
      brackets.push({
        index: ord,
        lo,
        hi,
        labelBg: label,
        count,
        share: count / total,
      });
      if (/^\s*над\s/i.test(label)) {
        aboveCapCount = count;
        capBgn = lo;
      }
    } else if (!ord && label) {
      // Memo rows — exact-at-cap and the "до X лв. вкл." minimum edge.
      const n = (() => {
        for (const c of r.slice(2)) {
          const v = parseNum(c);
          if (v != null && v >= 1) return v;
        }
        return null;
      })();
      // Strip inner spaces before the number match (space-grouped thousands).
      const memoNum = parseNum(
        (label.replace(/\s/g, "").match(/[\d.,]+/) ?? [])[0],
      );
      if (/^на\s+[\d.,]+\s*лв/i.test(label)) {
        atCapCount = n;
        capBgn = capBgn ?? memoNum;
      } else if (
        /^до\s+[\d.,]+\s*лв.*вкл/i.test(label) &&
        minPensionBgn == null
      ) {
        minPensionBgn = memoNum;
      }
    }
  }

  // Validation gate: ordinal-row counts must sum EXACTLY to the Общо headline.
  const sum = brackets.reduce((s, b) => s + b.count, 0);
  if (sum !== total) {
    throw new Error(
      `NOI yearbook ${year} sheet 5.1: bracket sum ${sum} != Общо ${total} ` +
        `(${brackets.length} brackets) — memo-row filter or column pick drifted`,
    );
  }

  return {
    year,
    total,
    minPensionBgn,
    atCapCount,
    capBgn,
    aboveCapCount,
    povertyLineBgn: null, // filled by fetchPovertyLines()
    brackets,
  };
};

// ---------------------------------------------------------------------------
// Eurostat ilc_li01 — at-risk-of-poverty monthly threshold (single person,
// 60% of median). Optional; the histogram degrades to no poverty line offline.
// ---------------------------------------------------------------------------

export const fetchPovertyLines = async (
  years: number[],
): Promise<Map<number, number>> => {
  const out = new Map<number, number>();
  const params = new URLSearchParams({
    format: "JSON",
    geo: "BG",
    hhcomp: "A1", // single person
    statinfo: "MED_EI",
    rskpovth: "B_60", // 60% of median (the A_ codes are empty for BG)
    unit: "NAC", // national currency (BGN)
  });
  for (const y of years) params.append("time", String(y));
  const url =
    "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ilc_li01?" +
    params.toString();
  try {
    const res = await fetch(url);
    if (!res.ok) return out;
    const j = (await res.json()) as {
      value: Record<string, number>;
      dimension: { time: { category: { index: Record<string, number> } } };
    };
    const idx = j.dimension.time.category.index;
    for (const [t, i] of Object.entries(idx)) {
      const annual = j.value[i];
      if (annual != null) out.set(Number(t), Math.round(annual / 12)); // → monthly
    }
  } catch {
    // offline / Eurostat down — leave the map empty, histogram hides the line.
  }
  return out;
};

// ---------------------------------------------------------------------------
// Chapter 9 — per-oblast (9.8 avg pension, 9.11 bank-paid, 9.1 total pensions)
// ---------------------------------------------------------------------------

/** Rows of a chapter-9 sheet that carry a leading "N.Name" oblast ordinal,
 *  1..28. Row 29 (non-oblast) and header/total rows are dropped. Returns
 *  [{ ord, name, cells }]. */
const oblastRows = (
  sheet: XLSX.WorkSheet,
): { ord: number; name: string; cells: Row }[] => {
  const out: { ord: number; name: string; cells: Row }[] = [];
  for (const r of rowsOf(sheet)) {
    const ord = leadingOrdinal(r[0]);
    if (ord == null || ord < 1 || ord > 28) continue; // 29 = non-oblast, excluded
    const name = text(r[0]).replace(/^\s*\d+\s*\.\s*/, "");
    out.push({ ord, name, cells: r });
  }
  return out;
};

/** First numeric cell at or after column `from`, with its column index. */
const firstNumAt = (
  cells: Row,
  from: number,
): { value: number; col: number } | null => {
  for (let i = from; i < cells.length; i++) {
    const n = parseNum(cells[i]);
    if (n != null) return { value: n, col: i };
  }
  return null;
};

/** First numeric cell at or after column `from`. */
const firstNumFrom = (cells: Row, from: number): number | null =>
  firstNumAt(cells, from)?.value ?? null;

const parseOblasts = (wb: XLSX.WorkBook, year: number): NoiOblastRow[] => {
  const s98 = findSheet(wb, "9.8");
  if (!s98) return [];

  // 9.8: col A = "N.Name", col B = avg pension (лв), col C = YoY ratio.
  const avgByName = new Map<string, { avg: number; yoy: number | null }>();
  for (const { name, cells } of oblastRows(s98)) {
    const avgHit = firstNumAt(cells, 1);
    if (!avgHit) continue;
    // Drift gate: col B is the average monthly pension in лв — it must land in a
    // plausible band. A count, a percentage, or a shifted column would fall
    // outside it, so throw rather than accept a wrong number silently.
    if (avgHit.value < 100 || avgHit.value > 5000)
      throw new Error(
        `NOI yearbook ${year} sheet 9.8: implausible avg pension ${avgHit.value} ` +
          `лв for "${name}" — column layout likely drifted.`,
      );
    // YoY ratio is the next numeric cell strictly AFTER the avg column — read by
    // column index, never by value-equality indexOf (which misses text cells).
    const yoy = firstNumFrom(cells, avgHit.col + 1);
    avgByName.set(name, { avg: avgHit.value, yoy });
  }

  // 9.1: total ДОО pensions per oblast (first numeric = "Брой пенсии" total).
  const pensionsByName = new Map<string, number>();
  const s91 = findSheet(wb, "9.1");
  if (s91)
    for (const { name, cells } of oblastRows(s91)) {
      const n = firstNumFrom(cells, 1);
      if (n != null) pensionsByName.set(name, n);
    }

  // 9.11: bank-paid pensions per oblast (first numeric = ДОО "Брой").
  const bankByName = new Map<string, number>();
  const s911 = findSheet(wb, "9.11");
  if (s911)
    for (const { name, cells } of oblastRows(s911)) {
      const n = firstNumFrom(cells, 1);
      if (n != null) bankByName.set(name, n);
    }

  const out: NoiOblastRow[] = [];
  for (const [name, { avg, yoy }] of avgByName) {
    const code = NOI_OBLAST_CODE[name];
    if (!code) {
      // A name we can't map is a signal the sheet drifted — surface it loudly
      // rather than silently dropping an oblast.
      throw new Error(
        `NOI yearbook ${year} sheet 9.8: unmapped oblast name "${name}"`,
      );
    }
    const pensions = pensionsByName.get(name) ?? null;
    const bankPaid = bankByName.get(name) ?? null;
    const cashPaid =
      pensions != null && bankPaid != null ? pensions - bankPaid : null;
    out.push({
      code,
      nameBg: name,
      // Keep the unrounded лв value — national (chapter 1.3) stores full
      // precision too, so rounding only oblasts would make the two disagree.
      avgPensionBgn: avg,
      avgPensionEur: eur(avg, year),
      yoyPct: yoy,
      pensions,
      bankPaid,
      cashPaid,
      cashShare: cashPaid != null && pensions ? cashPaid / pensions : null,
    });
  }
  if (out.length !== 28)
    throw new Error(
      `NOI yearbook ${year} sheet 9.8: got ${out.length} oblasts, expected 28`,
    );
  return out;
};

// ---------------------------------------------------------------------------
// One yearbook ZIP → the three parsed slices for that year
// ---------------------------------------------------------------------------

export interface ParsedYearbook {
  year: number;
  national: NoiNationalYear[]; // the whole 2020..year series (from chapter 1)
  distribution: NoiDistributionYear | null;
  oblasts: NoiOblastRow[];
}

/** True if `bytes` is a real ZIP (starts with "PK\x03\x04"), guarding against
 *  the soft-404 HTML that НОИ serves for unpublished years at HTTP 200. */
export const isZip = (bytes: Uint8Array): boolean =>
  bytes.length > 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  bytes[2] === 0x03 &&
  bytes[3] === 0x04;

const openChapter = (zip: AdmZip, chapter: number): XLSX.WorkBook | null => {
  const re = new RegExp(`CHAPT#${chapter}-`);
  const entry = zip.getEntries().find((e) => re.test(e.entryName));
  return entry ? XLSX.read(entry.getData()) : null;
};

export const parseYearbookZip = (
  bytes: Uint8Array,
  year: number,
): ParsedYearbook => {
  if (!isZip(bytes))
    throw new Error(
      `NOI yearbook ${year}: not a ZIP (soft-404 HTML?) — refusing to parse`,
    );
  const zip = new AdmZip(Buffer.from(bytes));
  const ch1 = openChapter(zip, 1);
  const ch5 = openChapter(zip, 5);
  const ch9 = openChapter(zip, 9);
  return {
    year,
    national: ch1 ? parseNational(ch1) : [],
    distribution: ch5 ? parseDistribution(ch5, year) : null,
    oblasts: ch9 ? parseOblasts(ch9, year) : [],
  };
};

// ---------------------------------------------------------------------------
// Artifact assembly
// ---------------------------------------------------------------------------

export const buildNoiPensionsFile = async (
  parsed: ParsedYearbook[],
): Promise<NoiPensionsFile> => {
  const byYear = [...parsed].sort((a, b) => a.year - b.year);
  const latest = byYear[byYear.length - 1];

  const distribution = byYear
    .map((p) => p.distribution)
    .filter((d): d is NoiDistributionYear => d != null);

  // Shade the histogram with the Eurostat at-risk-of-poverty threshold.
  const poverty = await fetchPovertyLines(distribution.map((d) => d.year));
  for (const d of distribution) d.povertyLineBgn = poverty.get(d.year) ?? null;

  // National series: the newest yearbook's chapter-1 matrix already carries the
  // full 2020..latest span. Backfill each year's pensionerCount from the
  // matching distribution total (the exact validated 31.12 headcount).
  const totalByYear = new Map(distribution.map((d) => [d.year, d.total]));
  const national = (latest?.national ?? []).map((n) => ({
    ...n,
    pensionerCount: totalByYear.get(n.year) ?? n.pensionerCount,
  }));

  const oblasts: Record<number, NoiOblastRow[]> = {};
  for (const p of byYear) if (p.oblasts.length) oblasts[p.year] = p.oblasts;

  return {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Национален осигурителен институт (NOI)",
      urlTemplate:
        "https://www.nssi.bg/wp-content/uploads/Yearbook_Pensions_{YYYY}.zip",
      description:
        "Annual pension statistical yearbook (ZIP of chapter workbooks). " +
        "Chapter 1 = national wage/income/pension series; chapter 5 = pension " +
        "size distribution; chapter 9 = per-oblast avg pension + cash-vs-bank.",
    },
    latestYear: latest?.year ?? 0,
    years: byYear.map((p) => p.year),
    national,
    distribution,
    oblasts,
  };
};
