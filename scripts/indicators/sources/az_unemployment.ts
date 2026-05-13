/**
 * AZ (Агенция по заетостта) annual unemployment by municipality.
 *
 * Source: https://www.az.government.bg/stats/4/ — annual review pages,
 * one per year. Each year publishes a per-municipality unemployment rate
 * table. The format changed in 2024:
 *
 *   - 2007..2023: per-topic XLSX file `ravnishte-na-bezrabotica-...-po-
 *     obshtini.xlsx` with a single sheet. Columns: [Label, Name, current
 *     year rate, prior year rate, YoY delta]. No AZ internal codes; rows
 *     are matched by walking the "Област X" → "Община Y" hierarchy.
 *   - 2024+: combined XLSX `godishni-danni-za-...-g.xlsx` with multiple
 *     sheets; the muni-rate sheet is `Равнище на безработ. в страната`.
 *     Columns: [NUTS, AZ code, Name, current rate, prior rate, delta].
 *     AZ codes almost exactly match our `obshtina` codes from
 *     data/municipalities.json (263 / 265 direct hits; 2 alias rows).
 *
 * Sofia: published as a single municipality "Община София (столица)"
 * under AZ code SOF46 (NUTS3 BG411). The app splits Sofia city into 24
 * district codes (S2301..S2524) under data/municipalities.json oblast
 * S23/S24/S25. We store the Sofia value once under the synthetic key
 * SOF00 and let the hook fall back from any S2xxx district code.
 *
 * Each year's file ships the current + prior year, so ingesting N
 * yearly reviews gives N+1 years of coverage with one redundant
 * overlap year per pair (useful for sanity check on re-published files).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.resolve(__dirname, "../../../raw_data/indicators/az");

const STATS_PAGE = "https://www.az.government.bg/stats/4/";
const HOST = "https://www.az.government.bg";

const UA = "Mozilla/5.0 (compatible; electionsbg-indicators/1.0)";

export type AzPoint = { year: number; value: number };

export type AzObservation = {
  year: number;
  obshtinaCode: string;
  value: number;
};

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok)
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return await res.text();
};

const fetchBuffer = async (url: string): Promise<Buffer> => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok)
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Walk the /stats/4/ listing and return one annual review URL per year
 * (the most-recent if multiple are listed for the same year).
 */
export const discoverAnnualReviews = async (): Promise<
  { year: number; pageUrl: string }[]
> => {
  const html = await fetchText(STATS_PAGE);

  // The listing is structured as <year>...<a href=...>Януари - Декември</a>
  // blocks. Walk the HTML, tracking the most-recent year we saw before
  // each link. Within a year, the first link is the canonical review.
  const yearRe =
    /(20\d\d)|<a[^>]+href="(https:\/\/www\.az\.government\.bg\/bg\/stats\/view\/4\/(\d+)\/)"/g;
  const byYear: Map<number, string> = new Map();
  let currentYear: number | undefined;
  let m: RegExpExecArray | null;
  while ((m = yearRe.exec(html)) !== null) {
    if (m[1]) {
      currentYear = Number(m[1]);
    } else if (m[2] && currentYear !== undefined && !byYear.has(currentYear)) {
      byYear.set(currentYear, m[2]);
    }
  }
  return Array.from(byYear, ([year, pageUrl]) => ({ year, pageUrl })).sort(
    (a, b) => a.year - b.year,
  );
};

/**
 * For a single annual-review page, return the URL of the XLSX file we
 * should parse for municipality-level unemployment. Returns null if the
 * page doesn't appear to publish muni-level data in XLSX (e.g. before
 * 2010 some years only have DOCX).
 */
export const findMuniXlsxUrl = async (
  pageUrl: string,
): Promise<string | null> => {
  const html = await fetchText(pageUrl);
  const links = Array.from(
    html.matchAll(/href="(\/web\/files\/StatsFile\/[^"]+\.xlsx)"/g),
  ).map((mm) => HOST + mm[1]);

  // New-format combined file (2024+): one file `godishni-danni-...`.
  // It contains everything; the muni-rate sheet is selected later.
  const combined = links.find((u) => /godishni-danni-za-/i.test(u));
  if (combined) return combined;

  // Old format (2007–2023): per-topic file. The muni-rate file's slug
  // ends with `-po-obshtini.xlsx` (variations include `v-stranata`,
  // `v-bylgarija`).
  const perTopic = links.find((u) => /po-obshtini\.xlsx$/i.test(u));
  if (perTopic) return perTopic;

  return null;
};

/** Download the XLSX to raw_data/indicators/az/<year>.xlsx (cached). */
const ensureLocalXlsx = async (
  year: number,
  url: string,
  force: boolean,
): Promise<string> => {
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  const dest = path.join(RAW_DIR, `${year}.xlsx`);
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
    return dest;
  }
  const buf = await fetchBuffer(url);
  fs.writeFileSync(dest, buf);
  return dest;
};

type ParsedRow = {
  year: number;
  azCode?: string;
  oblastContext?: string;
  muniName: string;
  value: number;
};

/**
 * Parse a single XLSX file and yield rows. Auto-detects new vs old format.
 * `reportYear` is the year of the annual review (used as the "current"
 * year fallback when the header doesn't explicitly state it).
 */
const parseXlsx = (file: string, reportYear: number): ParsedRow[] => {
  // CDN-bundled xlsx in ESM context can't reach Node's fs; read the buffer
  // ourselves and pass it explicitly.
  const buf = fs.readFileSync(file);
  const wb = XLSX.read(buf, { type: "buffer" });

  // New format: combined file with sheet "Равнище на безработ. в страната".
  // Old format: single-sheet "Приложение №3" / "2023" / etc.
  const muniSheetName =
    wb.SheetNames.find((n) => /равнище\s*на\s*безработ/i.test(n)) ??
    wb.SheetNames[0];
  const ws = wb.Sheets[muniSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
  });

  // Detect format by header row. Find the row whose first 6 cells contain
  // either "NUTS" (new) or "ПОКАЗАТЕЛИ" (old).
  let headerIdx = -1;
  let isNewFormat = false;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const r = rows[i] ?? [];
    const cell0 = String(r[0] ?? "").trim();
    if (cell0 === "NUTS") {
      headerIdx = i;
      isNewFormat = true;
      break;
    }
    if (cell0 === "ПОКАЗАТЕЛИ") {
      headerIdx = i;
      isNewFormat = false;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error(
      `parseXlsx(${file}): could not find header row (NUTS or ПОКАЗАТЕЛИ)`,
    );
  }

  // Pull current+prior years from the header row. Cells look like "2025 г."
  const header = rows[headerIdx] ?? [];
  const yearFromCell = (c: unknown): number | undefined => {
    const m = String(c ?? "").match(/(20\d\d)/);
    return m ? Number(m[1]) : undefined;
  };
  // New: header is [NUTS, Код, ПОКАЗАТЕЛИ, "2025 г.", "2024 г.", "Прираст ..."]
  // Old: header is [ПОКАЗАТЕЛИ, <blank>, "2017 г.", "2016 г.", "Прираст ..."]
  const yearCurrent = isNewFormat
    ? (yearFromCell(header[3]) ?? reportYear)
    : (yearFromCell(header[2]) ?? reportYear);
  const yearPrior = isNewFormat
    ? (yearFromCell(header[4]) ?? reportYear - 1)
    : (yearFromCell(header[3]) ?? reportYear - 1);

  // Column indices.
  const colLabel = 0;
  const colCode = isNewFormat ? 1 : -1;
  const colName = isNewFormat ? 2 : 1;
  const colCurr = isNewFormat ? 3 : 2;
  const colPrior = isNewFormat ? 4 : 3;

  const out: ParsedRow[] = [];
  let oblastContext: string | undefined;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const label = String(r[colLabel] ?? "").trim();
    const name = String(r[colName] ?? "").trim();

    // Track oblast for old-format disambiguation.
    if (label === "Област") {
      oblastContext = name.replace(/^Област\s+/i, "").trim();
      continue;
    }
    if (
      label === "Район" ||
      label === "Статистическа зона" ||
      label === "България"
    ) {
      continue;
    }
    if (isNewFormat && label.startsWith("BG")) {
      // New format: rows for "Област ..." have a code like BG412, name in col C
      if (/^Област\s+/i.test(name)) {
        oblastContext = name.replace(/^Област\s+/i, "").trim();
        continue;
      }
    }

    // Muni rows: new format = empty col A; old format = "Община"
    const isMuniRow = isNewFormat
      ? !label && colCode >= 0 && !!r[colCode]
      : label === "Община";
    if (!isMuniRow) continue;

    const azCode = colCode >= 0 ? String(r[colCode] ?? "").trim() : undefined;
    const muniName = name.replace(/^Община\s+/i, "").trim();
    const valCurr = r[colCurr];
    const valPrior = r[colPrior];

    if (typeof valCurr === "number" && Number.isFinite(valCurr)) {
      out.push({
        year: yearCurrent,
        azCode,
        oblastContext,
        muniName,
        value: round(valCurr, 2),
      });
    }
    if (typeof valPrior === "number" && Number.isFinite(valPrior)) {
      out.push({
        year: yearPrior,
        azCode,
        oblastContext,
        muniName,
        value: round(valPrior, 2),
      });
    }
  }
  return out;
};

export type AzFetchOpts = {
  /** Re-download even if cached locally. */
  forceDownload?: boolean;
  /** Limit to the N most recent annual reviews. Default: all. */
  maxYears?: number;
  /** Print progress. */
  verbose?: boolean;
};

export type AzFetchResult = {
  /** Year → rows from that year's annual review (before normalize). */
  byYear: Map<number, ParsedRow[]>;
};

export const fetchAzUnemployment = async (
  opts: AzFetchOpts = {},
): Promise<AzFetchResult> => {
  const reviews = await discoverAnnualReviews();
  const slice = opts.maxYears ? reviews.slice(-opts.maxYears) : reviews;
  if (opts.verbose) {
    console.log(
      `AZ /stats/4/: ${reviews.length} annual reviews found (${reviews[0]?.year}..${reviews.at(-1)?.year}), processing ${slice.length}.`,
    );
  }

  const byYear = new Map<number, ParsedRow[]>();
  for (const { year, pageUrl } of slice) {
    const xlsxUrl = await findMuniXlsxUrl(pageUrl);
    if (!xlsxUrl) {
      if (opts.verbose)
        console.log(`  ${year}: no muni-level XLSX on ${pageUrl}, skipping.`);
      continue;
    }
    const local = await ensureLocalXlsx(year, xlsxUrl, !!opts.forceDownload);
    const rows = parseXlsx(local, year);
    if (rows.length === 0) {
      throw new Error(
        `AZ ${year}: parsed 0 rows from ${local}. Format may have changed.`,
      );
    }
    byYear.set(year, rows);
    if (opts.verbose) {
      const uniq = new Set(rows.map((r) => r.year));
      console.log(
        `  ${year}: ${rows.length} rows, years ${[...uniq].sort().join(",")}`,
      );
    }
  }

  return { byYear };
};
