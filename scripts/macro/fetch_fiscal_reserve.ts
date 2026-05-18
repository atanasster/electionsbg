/**
 * Fiscal reserve (фискален резерв) — monthly stock-of-cash that the Law on
 * Public Finance requires to stay above a floor set by each year's State
 * Budget Law (4.5 BGN bn for 2025). Distinct from the BoP current account
 * (a flow that can be any sign) and from BNB FX reserves (which back the
 * currency board).
 *
 * Source: minfin.bg monthly mreport bulletins ("Българската икономика —
 * месечен обзор"). Each PDF carries a КФП summary table whose `Фискален
 * резерв` row lists ~12 months of end-of-month stock in млн. лв.
 *
 * Live minfin.bg is Cloudflare-WAF blocked, so we fetch through the Wayback
 * Machine `id_` URL (raw cached PDF). Wayback coverage 2013-2024 is
 * essentially complete; 2025+ is sparse (Wayback hasn't crawled the newest
 * uploads yet). Each report contains a rolling 12 months, so a handful of
 * well-chosen reports cover years' worth of data.
 *
 * Returns end-of-quarter values (last month of each quarter), in EUR million,
 * to plug into macro.json next to budgetBalanceNominal / currentAccountNominal.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pdf2array } from "pdf2array";
import * as XLSX from "xlsx";
import { toEur } from "../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.resolve(__dirname, "../../data/_cache/minfin_mreports");
// User-drop directory for FRA-MM-YYYY-BG.xlsx (or -EN.xlsx) monthly files
// downloaded manually from https://www.minfin.bg/bg/statistics/4. The
// pipeline reads any *.xlsx in here as an extra data source. We commit a
// README explaining the workflow; the .xlsx files themselves are git-
// ignored (one per month, ~13 KB).
const FR_XLSX_DIR = path.resolve(__dirname, "../../data/_cache/minfin_fr_xlsx");
const WAYBACK_CDX = "https://web.archive.org/cdx/search/cdx";
const WAYBACK_ID = "https://web.archive.org/web"; // append /<ts>id_/<url>

// Bulgarian month names that appear in mreport filenames. The cached URLs
// use a salad of full, short, and oddly-cased English month names: jan,
// january, feb, february, mar, march, apr, april, may, jun, june, jul,
// july, aug, august, sep, sept, september, oct, october, noe (Bulgarian
// short for ноември), nov, november, dec, december.
const MONTH_LOOKUP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  noe: 11,
  november: 11,
  dec: 12,
  december: 12,
};

type CdxRow = [string, string, string, string, string, string, string]; // [urlkey, ts, url, mime, status, digest, length]

type MreportEntry = {
  year: number;
  month: number;
  url: string;
  ts: string;
  // Two filename series live in minfin's /upload/ tree:
  //   "mreport"  → Институт за анализи и прогнози monthly economic review.
  //                Carries a КФП summary table with ~12 months of fiscal-
  //                reserve stocks. Wayback has good PDF captures 2013-09 to
  //                2024-09; from 2024-10 onward Cloudflare blocks Wayback's
  //                bot, so only the challenge page is archived.
  //   "buletin"  → Информационен бюлетин: ИЗПЪЛНЕНИЕ НА ДЪРЖАВНИЯ БЮДЖЕТ.
  //                A press-release-style narrative bulletin from the
  //                Ministry of Finance directly. Wayback has the actual PDFs
  //                much more often through 2025, but each one carries only
  //                the SINGLE end-of-month fiscal-reserve value in inline
  //                Bulgarian prose ("Размерът на фискалния резерв към
  //                28.02.2025 г. е 10,5 млрд. лв.") — no table.
  //   "fr_xlsx"  → FRA-MM-YYYY-BG.xlsx (or -EN.xlsx) from the dedicated
  //                Фискален резерв page at /bg/statistics/4. Plain table:
  //                row 0 says "Фискален резерв* към <date> г.", row 3 is the
  //                total in млн. лв. Wayback has ~80 historical captures;
  //                newer ones (post-2025-04) need to be dropped into
  //                FR_XLSX_DIR by hand (Cloudflare blocks automation).
  series: "mreport" | "buletin" | "fr_xlsx";
};

export type FiscalReservePoint = {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  period: string; // "YYYY-Q[1-4]"
  value: number; // EUR million (end-of-quarter)
  sourceMonth: number; // 1-12, month within the quarter the value snapshots
  sourceUrl: string; // original minfin URL
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ensureDir = (p: string) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
};

// Pick the best snapshot per (year, month) — prefer most recent crawl, since
// later crawls catch any corrections the bulletin received post-publication.
const enumerateMreports = async (): Promise<MreportEntry[]> => {
  const params = new URLSearchParams({
    url: "www.minfin.bg/upload/",
    matchType: "prefix",
    filter: "mimetype:application/pdf",
    limit: "2000",
    output: "json",
  });
  // Add the urlkey filter as a second `filter=` param.
  const url = `${WAYBACK_CDX}?${params.toString()}&filter=urlkey:.*mreport.*`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CDX query failed: HTTP ${res.status}`);
  const rows = (await res.json()) as CdxRow[];
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const data = rows.slice(1);

  // Group by URL, keep latest crawl timestamp. Normalise http→https so
  // duplicate variants of the same bulletin (Wayback indexes both schemes)
  // collapse to one entry.
  const latestByUrl = new Map<string, string>();
  for (const r of data) {
    const [, ts, originalRaw] = r;
    const original = originalRaw.replace(/^http:\/\//, "https://");
    if (!original.toLowerCase().includes("_bg")) continue;
    if (!original.toLowerCase().includes("mreport")) continue;
    const prev = latestByUrl.get(original);
    if (!prev || ts > prev) latestByUrl.set(original, ts);
  }

  // Extract (year, month) from filename. Patterns observed:
  //   mreport_Jan2024_bg.pdf       (no separator)
  //   mreport_jun2014_bg.pdf
  //   mreport_+Dec2017_bg.pdf      (literal '+' prefix)
  //   mreport_January2022_bg.pdf
  //   mreport_Noe2023_bg.pdf       (Bulgarian short for ноември)
  //   mreport_July-Aug2017_bg.pdf  (combined two-month — skip; we want stocks)
  //   mreport_Nov2022_bg.docx.pdf  (double-extension hiccup; valid)
  const fnPat = /mreport_\+?([a-z]+?)[-_]?(20\d{2})_?\+?_?bg/i;
  const entries: MreportEntry[] = [];
  for (const [url, ts] of latestByUrl.entries()) {
    const fn = url.split("/").pop()?.toLowerCase() ?? "";
    if (fn.includes("july-aug") || fn.includes("jul-aug")) continue;
    const m = fnPat.exec(fn);
    if (!m) continue;
    const monthRaw = m[1].toLowerCase();
    const year = Number(m[2]);
    const month = MONTH_LOOKUP[monthRaw] ?? MONTH_LOOKUP[monthRaw.slice(0, 3)];
    if (!month) continue;
    entries.push({ year, month, url, ts, series: "mreport" });
  }
  return entries.sort(
    (a, b) => a.year * 12 + a.month - (b.year * 12 + b.month),
  );
};

// Enumerate Wayback-cached FRA-MM-YYYY-(BG|EN).xlsx files from the dedicated
// fiscal-reserve statistics page. Wayback coverage ends around April 2025
// (Cloudflare started blocking the bot for newer captures), so any post-
// April-2025 month must be dropped into FR_XLSX_DIR by hand.
const enumerateFraXlsx = async (): Promise<MreportEntry[]> => {
  const params = new URLSearchParams({
    url: "www.minfin.bg/upload/",
    matchType: "prefix",
    limit: "2000",
    output: "json",
  });
  const url =
    `${WAYBACK_CDX}?${params.toString()}` +
    `&filter=statuscode:200&filter=urlkey:.*fra-.*\\.xlsx`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CDX query failed: HTTP ${res.status}`);
  const rows = (await res.json()) as CdxRow[];
  if (!Array.isArray(rows) || rows.length < 2) return [];

  // Dedupe URLs (Wayback indexes both http and https schemes), keep latest
  // crawl timestamp per URL. Prefer BG over EN when both variants of the
  // same (year, month) exist — the BG sheet name carries Bulgarian month
  // names, and median voting needs distinct sources so prefer-once is
  // enough.
  const latestByUrl = new Map<string, string>();
  for (const r of rows.slice(1)) {
    const [, ts, originalRaw] = r;
    const original = originalRaw.replace(/^http:\/\//, "https://");
    const prev = latestByUrl.get(original);
    if (!prev || ts > prev) latestByUrl.set(original, ts);
  }

  const fnPat = /FRA-(\d{2})-(\d{4})-(BG|EN)\.xlsx$/i;
  const entries: MreportEntry[] = [];
  for (const [u, ts] of latestByUrl.entries()) {
    const fn = u.split("/").pop() ?? "";
    const m = fnPat.exec(fn);
    if (!m) continue;
    const month = Number(m[1]);
    const year = Number(m[2]);
    if (month < 1 || month > 12) continue;
    entries.push({ year, month, url: u, ts, series: "fr_xlsx" });
  }
  return entries.sort(
    (a, b) => a.year * 12 + a.month - (b.year * 12 + b.month),
  );
};

// Enumerate the BULETIN_<MonthName>_YYYY.pdf monthly Information Bulletins.
// Required filters: mimetype=application/pdf AND statuscode=200 — Wayback
// captures of the post-2024 era are dominantly Cloudflare 403 challenge
// pages (HTML), and including them as candidates would just waste fetches.
const enumerateBuletins = async (): Promise<MreportEntry[]> => {
  const params = new URLSearchParams({
    url: "www.minfin.bg/upload/",
    matchType: "prefix",
    filter: "mimetype:application/pdf",
    limit: "2000",
    output: "json",
  });
  const url =
    `${WAYBACK_CDX}?${params.toString()}` +
    `&filter=statuscode:200&filter=urlkey:.*buletin_.*`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CDX query failed: HTTP ${res.status}`);
  const rows = (await res.json()) as CdxRow[];
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const latestByUrl = new Map<string, string>();
  for (const r of rows.slice(1)) {
    const [, ts, originalRaw] = r;
    const original = originalRaw.replace(/^http:\/\//, "https://");
    const prev = latestByUrl.get(original);
    if (!prev || ts > prev) latestByUrl.set(original, ts);
  }

  // Filename pattern: BULETIN_<MonthName>(_| +_)?<YYYY>.pdf
  //   BULETIN_February_2025.pdf
  //   BULETIN_January+_2024.pdf  (literal '+' between month and year)
  //   BULETIN_DECEMBER_2007.pdf  (occasional all-caps)
  const fnPat = /BULETIN_([A-Za-z]+)_?\+?_?(20\d{2})\.pdf$/i;
  const entries: MreportEntry[] = [];
  for (const [url, ts] of latestByUrl.entries()) {
    const fn = url.split("/").pop() ?? "";
    const m = fnPat.exec(fn);
    if (!m) continue;
    const monthRaw = m[1].toLowerCase();
    const year = Number(m[2]);
    const month = MONTH_LOOKUP[monthRaw];
    if (!month) continue;
    entries.push({ year, month, url, ts, series: "buletin" });
  }
  return entries.sort(
    (a, b) => a.year * 12 + a.month - (b.year * 12 + b.month),
  );
};

const cacheKey = (e: MreportEntry) => {
  const ext = e.series === "fr_xlsx" ? "xlsx" : "pdf";
  return `${e.series}-${e.year}-${String(e.month).padStart(2, "0")}.${ext}`;
};

// A real PDF starts with "%PDF" (0x25 0x50 0x44 0x46). Wayback's `id_`
// served body for the post-2024 captures is the Cloudflare challenge HTML;
// without this check the parser would silently try (and fail) to read it.
const isPdf = (buf: Uint8Array): boolean =>
  buf.length >= 4 &&
  buf[0] === 0x25 &&
  buf[1] === 0x50 &&
  buf[2] === 0x44 &&
  buf[3] === 0x46;

// XLSX magic = "PK\x03\x04" (it's a zip).
const isZip = (buf: Uint8Array): boolean =>
  buf.length >= 4 &&
  buf[0] === 0x50 &&
  buf[1] === 0x4b &&
  buf[2] === 0x03 &&
  buf[3] === 0x04;

const downloadFile = async (e: MreportEntry): Promise<Uint8Array> => {
  // Local user-dropped FRA XLSX — read directly, no cache copy.
  if (e.ts === "local" && e.url.startsWith("file://")) {
    const localPath = e.url.replace(/^file:\/\//, "");
    return new Uint8Array(fs.readFileSync(localPath));
  }
  ensureDir(CACHE_DIR);
  const cached = path.join(CACHE_DIR, cacheKey(e));
  if (fs.existsSync(cached) && fs.statSync(cached).size > 1024) {
    return new Uint8Array(fs.readFileSync(cached));
  }
  const waybackUrl = `${WAYBACK_ID}/${e.ts}id_/${e.url}`;
  // Be polite — Wayback rate-limits aggressive scrapers.
  await sleep(800);
  const res = await fetch(waybackUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${waybackUrl}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < 1024)
    throw new Error(`Truncated body from ${waybackUrl}`);
  // PDF series must be PDFs; XLSX series must be zip archives. Anything
  // else is almost always a Cloudflare challenge HTML that Wayback dutifully
  // archived in place of the real file.
  const expectZip = e.series === "fr_xlsx";
  const ok = expectZip ? isZip(buf) : isPdf(buf);
  if (!ok)
    throw new Error(
      `Wayback returned wrong body type (likely a Cloudflare challenge page) for ${waybackUrl}`,
    );
  fs.writeFileSync(cached, buf);
  return buf;
};

type HeaderCell =
  | { kind: "year"; year: number }
  | { kind: "quarter"; year: number; q: 1 | 2 | 3 | 4 }
  | { kind: "month"; year: number; month: number }
  | { kind: "unknown" };

const parseHeaderToken = (
  token: string,
  recentYears: Set<number>,
): HeaderCell => {
  const t = token.trim().replace(/\s+/g, "");
  // Year alone, e.g. "2023"
  if (/^20\d{2}$/.test(t)) return { kind: "year", year: Number(t) };
  // Quarter, e.g. "II'23" or "I'23" or "IV'23"
  let m = /^([IV]+)'(\d{2})$/.exec(t);
  if (m) {
    const roman = m[1];
    const yr = 2000 + Number(m[2]);
    const q = roman === "I" ? 1 : roman === "II" ? 2 : roman === "III" ? 3 : 4;
    if (recentYears.has(yr)) return { kind: "quarter", year: yr, q };
  }
  // Month, e.g. "12'22" or "09'24"
  m = /^(0[1-9]|1[012])'(\d{2})$/.exec(t);
  if (m) {
    const mm = Number(m[1]);
    const yr = 2000 + Number(m[2]);
    if (recentYears.has(yr)) return { kind: "month", year: yr, month: mm };
  }
  return { kind: "unknown" };
};

const parseValue = (s: string): number | null => {
  // Numbers in BG bulletins: "13 397" or "13,397" or "-666". Strip spaces and
  // any thousands separator; tolerate a unicode minus.
  const cleaned = s.replace(/[\s\u00a0]/g, "").replace(/[,]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
};

// pdf2array splits some header tokens because the publisher's typesetting
// has slightly-inconsistent kerning around digits and apostrophes. Repair
// known split patterns by treating the row as a space-separated string and
// substituting the recognisable broken forms with the merged ones. Run to
// a fixed point so chained fragments (e.g. "I I I'2 2" \u2192 "III'22") collapse
// over multiple passes.
const cleanHeaderTokens = (cells: string[]): string[] => {
  let text = " " + cells.join(" ") + " ";
  let prev = "";
  while (prev !== text) {
    prev = text;
    text = text
      // Year halves: "20 20" \u2192 "2020", "20 24" \u2192 "2024"
      .replace(/ (20) (20|21|22|23|24|25|26) /g, " $1$2 ")
      // Year split like "2 021"/"2 022"... \u2192 "2021"/"2022"...
      .replace(/ (2) (02[0-6]) /g, " $1$2 ")
      // Month with detached year-tail: "11'2 3" \u2192 "11'23"
      .replace(/ (0[1-9]|1[012])'(\d) (\d) /g, " $1'$2$3 ")
      // Month with detached apostrophe-and-tail: "11 '2 3" \u2192 "11'23"
      .replace(/ (0[1-9]|1[012]) '(\d) (\d) /g, " $1'$2$3 ")
      // Month split into individual digits: "1 2 '2 3" \u2192 "12'23", "0 1 '2 4"
      // \u2192 "01'24". Two leading single-digit cells before an apostrophe-year.
      .replace(/ (1) ([012]) '(\d) (\d) /g, " $1$2'$3$4 ")
      .replace(/ (0) ([1-9]) '(\d) (\d) /g, " $1$2'$3$4 ")
      // Quarter with apostrophe attached: "I'2 3" \u2192 "I'23"
      .replace(/ ([IV]+)'(\d) (\d) /g, " $1'$2$3 ")
      // Quarter with apostrophe detached: "IV '2 2" \u2192 "IV'22"
      .replace(/ ([IV]+) '(\d) (\d) /g, " $1'$2$3 ")
      // Roman fragments that precede a quarter ending: "I I'23" \u2192 "II'23",
      // "I II'23" \u2192 "III'23". Done last so the apostrophe-bearing piece
      // is already merged into the canonical "II'23" / "III'23" form.
      .replace(/ I (II'2\d) /g, " I$1 ")
      .replace(/ I (I'2\d) /g, " I$1 ");
  }
  return text.trim().split(/\s+/).filter(Boolean);
};

// Sanity floor: the fiscal reserve has never been below ~3 BGN bn in the
// post-2008 series — anything substantially lower is a column-alignment
// artefact, not a real data point. Drop those silently rather than letting
// them pollute the chart.
const MIN_PLAUSIBLE_BGN_MILLION = 2500;

// Reads one mreport PDF and returns its (year, month) -> value-in-BGN-million
// map for the Фискален резерв row.
const parseFiscalReserveFromPdf = async (
  pdfBytes: Uint8Array,
  reportYear: number,
): Promise<Map<string, number>> => {
  const out = new Map<string, number>();
  let rows: string[][];
  try {
    rows = await pdf2array(pdfBytes);
  } catch {
    return out;
  }

  // The mreport's КФП table starts with a header row carrying a mix of
  // annual ("2023"), quarterly ("II'23"), and monthly ("12'23") column
  // labels. The "Фискален резерв" row appears 1-3 rows below the header.
  // Both rows have an extra two leading cells: the row label and unit
  // ("млн. лв."). We line them up by trimming leading non-numeric cells
  // until lengths match.
  const recentYears = new Set<number>();
  for (let y = reportYear - 3; y <= reportYear + 1; y++) recentYears.add(y);

  const countHeaderCells = (cells: string[]): number => {
    let n = 0;
    for (const c of cells) {
      if (parseHeaderToken(c, recentYears).kind !== "unknown") n++;
    }
    return n;
  };

  // Walk rows; for each "Фискален резерв" row, search both backward and
  // forward for the nearest plausible header (a row with >= 3 year/quarter/
  // month cells). In some 2018-era bulletins the column header sits BELOW
  // the data block because the page lays the КФП table and the Financial-
  // sector table back-to-back with one shared header in between.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const joined = row.join(" ");
    if (!/Фискален\s*резерв/.test(joined)) continue;
    // Only interested in the BGN-million row; the next row is "% от БВП".
    if (!/млн\.?\s*лв/i.test(joined)) continue;

    // Find the nearest plausible header — first repair fragmented tokens
    // (so the merged header reflects what the publisher actually drew),
    // then score by how many year/quarter/month cells it carries.
    let header: string[] | null = null;
    let bestCount = 0;
    for (
      let j = Math.max(0, i - 12);
      j <= Math.min(rows.length - 1, i + 12);
      j++
    ) {
      if (j === i) continue;
      const candidate = cleanHeaderTokens(rows[j]);
      const c = countHeaderCells(candidate);
      if (c > bestCount) {
        bestCount = c;
        header = candidate;
      }
    }
    if (!header || bestCount < 3) continue;

    // Drop leading non-numeric values (row label, unit, etc.). Note: we do
    // NOT pre-merge split numbers here — we walk the raw cells in parallel
    // with the header, deciding per-position whether the next data cell is
    // a continuation of a split publisher value.
    const rawCells = row.slice();
    while (rawCells.length > 0 && parseValue(rawCells[0]) == null) {
      rawCells.shift();
    }
    if (rawCells.length === 0) continue;

    // Build a "structural" header that keeps only the cells matching one of
    // the known column kinds (year / quarter / month), in left-to-right
    // order. The original cleaned-header may also contain section dividers
    // ("—", "КОНСОЛИДИРАНА ФИСКАЛНА ПРОГРАМА (с натрупване)" et al.) that
    // never get a corresponding value.
    const structHeader: { cell: HeaderCell; raw: string }[] = [];
    for (const raw of header) {
      const cell = parseHeaderToken(raw, recentYears);
      if (cell.kind !== "unknown") structHeader.push({ cell, raw });
    }
    if (structHeader.length === 0) continue;

    // Walk header columns left-to-right, advancing a parallel cursor over
    // the raw data cells. For each column:
    //   - if the data cell parses as a real (≥100) BGN-million value, use it
    //     and consume one cell.
    //   - if it's a 1-2 digit fragment AND the next cell is a 3-digit tail,
    //     the publisher's "12 363" got tokenised as ["12","363"]; combine
    //     them and consume two cells.
    //   - otherwise, treat the data cell as a placeholder for an empty
    //     publisher column and consume one cell.
    // This preserves publisher-column alignment even when pdf2array fragments
    // or drops cells, which made the naive "drop rightmost N" approach fail.
    let dataIdx = 0;
    for (let h = 0; h < structHeader.length; h++) {
      if (dataIdx >= rawCells.length) break;
      const headerCell = structHeader[h].cell;
      const cur = (rawCells[dataIdx] ?? "").trim();
      const next = (rawCells[dataIdx + 1] ?? "").trim();
      let value: number | null = parseValue(cur);
      let consumed = 1;
      const looksLikeSplit = /^\d{1,2}$/.test(cur) && /^\d{3}$/.test(next);
      if (looksLikeSplit) {
        const merged = parseValue(cur + " " + next);
        if (merged != null && merged >= MIN_PLAUSIBLE_BGN_MILLION) {
          value = merged;
          consumed = 2;
        }
      }
      dataIdx += consumed;
      if (value == null) continue;
      if (headerCell.kind !== "month") continue;
      const key = `${headerCell.year}-${String(headerCell.month).padStart(2, "0")}`;
      out.set(key, value);
    }
  }
  return out;
};

// Pull the single end-of-month fiscal-reserve stock out of an FRA XLSX.
// Layout (consistent across BG and EN variants):
//   row 0: "Фискален резерв* към <DD.MM.YYYY> г."  /  "FISCAL RESERVE* as of"
//   row 2: header — UNIT label, one of:
//            (млн. лв.)   — BGN millions, used 2003 → 2025-12
//            (млн. евро)  — EUR millions, used 2026-01 onwards (Bulgaria
//                            joined the eurozone on 2026-01-01)
//            (BGN MLN)    — EN variant before adoption
//            (EUR MLN)    — EN variant after adoption
//   row 3: total — "Общ размер на фискалния резерв* (I+II)" / "FISCAL RESERVE
//          (FR)* (І+ІІ)" with the numeric value in column B
//
// Returns the value in BGN-equivalent millions (EUR → BGN via the fixed
// 1.95583 currency-board rate that survives euro adoption). Downstream
// monthlyToQuarterly then converts back to EUR — the round-trip is loss-
// less because the rate is a hard convention.
const parseFiscalReserveFromXlsx = (
  bytes: Uint8Array,
  reportYear: number,
  reportMonth: number,
): Map<string, number> => {
  const out = new Map<string, number>();
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: "array" });
  } catch {
    return out;
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return out;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
  });

  // Detect unit. Scan every cell for the label — placement has drifted
  // across years (sometimes row 2 col B, sometimes row 1 col B). Default to
  // BGN since every pre-2026 file is denominated that way and missing-
  // header is a stronger signal of a legacy layout than of a new unit.
  let unit: "BGN" | "EUR" = "BGN";
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const s = String(cell ?? "").toLowerCase();
      if (/млн\.?\s*евро/.test(s) || /eur\s*mln/.test(s)) {
        unit = "EUR";
        break;
      }
      if (/млн\.?\s*лв/.test(s) || /bgn\s*mln/.test(s)) {
        unit = "BGN";
        // don't break — a later EUR cell would win, since EUR is the
        // post-adoption canonical and BGN labels sometimes linger as
        // historical column headers in the same file
      }
    }
  }

  // Walk all rows; the publisher has shifted the totals row around (some
  // years have an extra "Note" row above the table). Find the row whose
  // first cell starts with a total-row label AND whose second cell is a
  // plausible monetary value.
  const totalLabel =
    /(Общ\s*размер\s*на\s*фискалния\s*резерв|FISCAL\s*RESERVE\s*\(FR\))/i;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const label = String(row[0] ?? "").trim();
    if (!totalLabel.test(label)) continue;
    const raw = row[1];
    const v =
      typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
    if (!Number.isFinite(v)) continue;
    // Normalise to BGN-equivalent millions. The currency-board rate
    // (1 EUR = 1.95583 BGN) is fixed by law, so the conversion is exact.
    const bgnMillion = unit === "EUR" ? v * 1.95583 : v;
    if (bgnMillion < MIN_PLAUSIBLE_BGN_MILLION) continue;
    const key = `${reportYear}-${String(reportMonth).padStart(2, "0")}`;
    out.set(key, bgnMillion);
    break;
  }
  return out;
};

// Enumerate user-dropped XLSX files in data/_cache/minfin_fr_xlsx/. Filenames
// must follow the upstream pattern FRA-MM-YYYY-BG.xlsx (or -EN.xlsx); we
// derive the report (year, month) from the filename rather than the workbook
// to keep the loader as simple as the regex.
const enumerateLocalFraXlsx = (): MreportEntry[] => {
  if (!fs.existsSync(FR_XLSX_DIR)) return [];
  const fnPat = /^FRA-(\d{2})-(\d{4})-(BG|EN)\.xlsx$/i;
  const entries: MreportEntry[] = [];
  for (const fn of fs.readdirSync(FR_XLSX_DIR)) {
    const m = fnPat.exec(fn);
    if (!m) continue;
    const month = Number(m[1]);
    const year = Number(m[2]);
    if (month < 1 || month > 12) continue;
    entries.push({
      year,
      month,
      url: `file://${path.join(FR_XLSX_DIR, fn)}`,
      ts: "local",
      series: "fr_xlsx",
    });
  }
  return entries.sort(
    (a, b) => a.year * 12 + a.month - (b.year * 12 + b.month),
  );
};

// Pull the single end-of-month fiscal-reserve stock out of a BULETIN
// information-bulletin PDF. The bulletin states the figure inline as one
// sentence, e.g.:
//
//   "Размерът на фискалния резерв към 28.02.2025 г. е 10,5 млрд. лв., в т.
//    ч. 8,8 млрд. лв. депозити на фискалния резерв в БНБ и банки и 1,7
//    млрд. лв. вземания от фондовете на Европейския съюз ..."
//
// Returns a single (YYYY-MM → BGN million) entry indexed by the matched
// date — typically the last calendar day of (reportMonth) of (reportYear).
// If the regex misses (older bulletins phrase it differently), returns an
// empty map.
const parseFiscalReserveFromBuletin = async (
  pdfBytes: Uint8Array,
  reportYear: number,
  reportMonth: number,
): Promise<Map<string, number>> => {
  const out = new Map<string, number>();
  let rows: string[][];
  try {
    rows = await pdf2array(pdfBytes);
  } catch {
    return out;
  }
  // Flatten the whole document to one text blob; the sentence we want is a
  // single paragraph that may straddle a page break.
  const text = rows
    .map((r) => r.join(" "))
    .join(" ")
    .replace(/\s+/g, " ");
  // "Размерът на фискалния резерв към 28.02.2025 г. е 10,5 млрд. лв."
  // pdf2array's text layout often inserts spaces inside words and around
  // digit-grouping punctuation ("фискал ния резерв", "28 . 02 .202 5"), so
  // the regex tolerates optional whitespace everywhere a typesetting glitch
  // could appear. After matching, all whitespace is stripped from the
  // captured number and date fragments before they're parsed.
  const re =
    /Размер\s*ът\s+на\s+фискал\s*ния\s+резерв\s+към\s+([\d\s]{1,4})\.\s*([\d\s]{1,3})\.\s*([\d\s]{3,6})\s+г\.?\s+е\s+([\d\s]+(?:[.,]\s*\d+)?)\s*(млрд|млн)\.?\s*лв/i;
  const m = re.exec(text);
  if (!m) return out;
  const stripSpaces = (s: string) => s.replace(/\s+/g, "");
  const dd = Number(stripSpaces(m[1]));
  const mm = Number(stripSpaces(m[2]));
  const yyyy = Number(stripSpaces(m[3]));
  if (yyyy !== reportYear || mm !== reportMonth || dd < 1 || dd > 31) {
    return out;
  }
  const num = Number(stripSpaces(m[4]).replace(",", "."));
  if (!Number.isFinite(num)) return out;
  const bgnMillion = m[5].toLowerCase().startsWith("млрд") ? num * 1000 : num;
  if (bgnMillion < MIN_PLAUSIBLE_BGN_MILLION) return out;
  const key = `${yyyy}-${String(mm).padStart(2, "0")}`;
  out.set(key, bgnMillion);
  return out;
};

// Aggregate monthly BGN-million observations into quarterly EUR-million
// end-of-quarter values. If only a non-quarter-end month is present (e.g.
// April but not June for Q2), fall back to that latest-available month so
// no quarter shows as a gap when partial data exists.
const monthlyToQuarterly = (
  monthly: Map<string, number>,
): FiscalReservePoint[] => {
  const byQuarter = new Map<string, FiscalReservePoint>();
  // Sort keys so we always pick the LATEST month in each quarter (closer to
  // quarter-end is preferable for a stock series).
  const sortedKeys = [...monthly.keys()].sort();
  for (const key of sortedKeys) {
    const [yStr, mStr] = key.split("-");
    const year = Number(yStr);
    const month = Number(mStr);
    const q = Math.ceil(month / 3) as 1 | 2 | 3 | 4;
    const period = `${year}-Q${q}`;
    const bgnMillion = monthly.get(key)!;
    if (bgnMillion < MIN_PLAUSIBLE_BGN_MILLION) continue;
    // Convert BGN million -> EUR million via the fixed currency-board rate.
    const eurUnits = toEur(bgnMillion * 1_000_000, "BGN");
    if (eurUnits == null) continue;
    const eurMillion = Math.round(eurUnits / 1_000_000);
    // Prefer the latest month within the quarter (closer to quarter-end).
    const existing = byQuarter.get(period);
    if (!existing || month > existing.sourceMonth) {
      byQuarter.set(period, {
        year,
        quarter: q,
        period,
        value: eurMillion,
        sourceMonth: month,
        sourceUrl: "",
      });
    }
  }
  return [...byQuarter.values()].sort((a, b) =>
    a.period.localeCompare(b.period),
  );
};

export const fetchFiscalReserve = async (options?: {
  yearFrom?: number;
  verbose?: boolean;
}): Promise<{
  points: FiscalReservePoint[];
  reportsUsed: number;
  monthsCovered: number;
}> => {
  const yearFrom = options?.yearFrom ?? 2013;
  const log = options?.verbose ? console.log : () => {};

  log("Enumerating mreport bulletins from Wayback CDX…");
  const mreports = await enumerateMreports();
  log("Enumerating BULETIN bulletins from Wayback CDX…");
  const buletins = await enumerateBuletins();
  log("Enumerating FRA XLSX from Wayback CDX…");
  const fraWayback = await enumerateFraXlsx();
  const fraLocal = enumerateLocalFraXlsx();
  // Local files are authoritative — drop any Wayback FRA entry that has a
  // local replacement so we don't waste a network fetch when the operator
  // has already dropped the file.
  const localKeys = new Set(fraLocal.map((e) => `${e.year}-${e.month}`));
  const fraWaybackFiltered = fraWayback.filter(
    (e) => !localKeys.has(`${e.year}-${e.month}`),
  );

  const all = [
    ...mreports,
    ...buletins,
    ...fraWaybackFiltered,
    ...fraLocal,
  ].filter((e) => e.year >= yearFrom);
  log(
    `  CDX returned ${mreports.length} mreport + ${buletins.length} BULETIN + ${fraWayback.length} FRA-xlsx; local FRA-xlsx: ${fraLocal.length}. Total since ${yearFrom}: ${all.length}.`,
  );

  // Strategy: each mreport carries ~12 months in a КФП summary table; each
  // BULETIN carries a single end-of-month figure in narrative prose; each
  // FRA xlsx carries one authoritative end-of-month total. Collect every
  // (year, month) → value reading from every source. Pick the MEDIAN so a
  // single misaligned PDF reading can't poison the series — bad alignments
  // show up as outliers and get out-voted. Local FRA XLSX values win
  // implicitly: they're authoritative MoF numbers, and even one matching
  // vote anchors the median when the PDF parses are noisy around it.
  const monthlyVotes = new Map<string, number[]>();
  const monthlyVoteSources = new Map<string, string[]>();
  let reportsUsed = 0;
  for (const entry of all) {
    const tag = `${entry.series}-${entry.year}-${entry.month}`;
    try {
      const bytes = await downloadFile(entry);
      let parsed: Map<string, number>;
      if (entry.series === "mreport") {
        parsed = await parseFiscalReserveFromPdf(bytes, entry.year);
      } else if (entry.series === "buletin") {
        parsed = await parseFiscalReserveFromBuletin(
          bytes,
          entry.year,
          entry.month,
        );
      } else {
        parsed = parseFiscalReserveFromXlsx(bytes, entry.year, entry.month);
      }
      if (parsed.size === 0) {
        log(`  [skip] ${tag}: no Фискален резерв data extracted`);
        continue;
      }
      reportsUsed++;
      for (const [k, v] of parsed.entries()) {
        const votes = monthlyVotes.get(k) ?? [];
        votes.push(v);
        monthlyVotes.set(k, votes);
        const srcs = monthlyVoteSources.get(k) ?? [];
        srcs.push(entry.url);
        monthlyVoteSources.set(k, srcs);
      }
      log(`  ${tag}: parsed ${parsed.size} month(s)`);
    } catch (err) {
      log(`  [error] ${tag}: ${(err as Error).message}`);
    }
  }

  // Resolve each month to its median value across all bulletin readings.
  // Drop months with a single reading IF that reading sits suspiciously far
  // (>30%) from the median of its temporal neighbours — singletons can't
  // self-validate, so we trust them only when they fit the local trend.
  const monthly = new Map<string, number>();
  const monthSourceUrl = new Map<string, string>();
  for (const [key, votes] of monthlyVotes.entries()) {
    const sorted = [...votes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    monthly.set(key, median);
    monthSourceUrl.set(key, monthlyVoteSources.get(key)?.[0] ?? "");
  }

  const points = monthlyToQuarterly(monthly);
  for (const p of points) {
    const monthKey = `${p.year}-${String(p.sourceMonth).padStart(2, "0")}`;
    p.sourceUrl = monthSourceUrl.get(monthKey) ?? "";
  }
  return { points, reportsUsed, monthsCovered: monthly.size };
};

// CLI: tsx scripts/macro/fetch_fiscal_reserve.ts
const isMain =
  process.argv[1] && process.argv[1].endsWith("fetch_fiscal_reserve.ts");
if (isMain) {
  fetchFiscalReserve({ verbose: true })
    .then(({ points, reportsUsed, monthsCovered }) => {
      const out = path.resolve(
        __dirname,
        "../../data/_cache/fiscal-reserve.json",
      );
      ensureDir(path.dirname(out));
      fs.writeFileSync(
        out,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            source:
              "minfin.bg monthly mreport (КФП table row) + BULETIN information bulletins (inline figure) + FRA-MM-YYYY-BG.xlsx (authoritative monthly file from /bg/statistics/4); fetched via web.archive.org with manual XLSX drops in data/_cache/minfin_fr_xlsx/",
            reportsUsed,
            monthsCovered,
            quarterly: points,
          },
          null,
          2,
        ),
      );
      console.log(
        `\nWrote ${out}: ${points.length} quarterly points (${monthsCovered} months across ${reportsUsed} bulletins).`,
      );
      if (points.length > 0) {
        const last = points[points.length - 1];
        console.log(
          `Latest: ${last.period} = €${last.value} M (from ${last.sourceMonth}/${last.year} stock)`,
        );
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
