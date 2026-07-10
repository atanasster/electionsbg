/**
 * МОН (Министерство на образованието и науката) — Държавни зрелостни
 * изпити (DZI / Matura) results, aggregated to municipality level.
 *
 * Source: data.egov.bg dataset 066b4b04-d81d-444e-a61c-8ca0516079e4
 * "Резултати от държавните зрелостни изпити по училища и по предмети".
 * The dataset lists 10 resources (one per session). We use only the
 * primary May-June sessions (excluding Aug-Sep retakes and the optional
 * by-student-choice exams). The modern format (2022-2025) has columns:
 *
 *   Област, Община, Населено място, Училище, Код по НЕИСПУО,
 *   Бр. БЕЛ(ООП) З, Ср.усп. БЕЛ(ООП) З, ... (other subjects)
 *
 * БЕЛ(ООП) = Bulgarian Language and Literature, mandatory general-education
 * exam taken by all 12-graders. We use it as the canonical DZI indicator.
 *
 * Aggregation per municipality:
 *   score(muni) = Σ(count_school × score_school) / Σ(count_school)
 * over all schools in that muni for the year.
 *
 * Older formats (2016, 2017) have different columns (БЕЛ Ср.усп. / БЕЛ Бр.)
 * — TODO: support in a follow-up. The 2018-2021 gap is upstream — those
 * years are not published on data.egov.bg.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseCsvRows, normRow } from "../../lib/csv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.resolve(__dirname, "../../../raw_data/indicators/mon");

const DATASET_PAGE =
  "https://data.egov.bg/data/view/066b4b04-d81d-444e-a61c-8ca0516079e4";

const DOWNLOAD_BASE = "https://data.egov.bg/resource/download";

const UA = "Mozilla/5.0 (compatible; electionsbg-indicators/1.0)";

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok)
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return await res.text();
};

// The data.egov.bg /resource/download endpoint has an outage mode where it
// 302-redirects to the portal HTML shell but still answers HTTP 200 (verified
// 2026-06-28; see reference_egov_api_endpoints). A naïve res.ok check writes
// that HTML verbatim as `${year}.csv`, silently poisoning the cache. Validate
// the content-type and sniff for an HTML doctype before trusting the bytes.
const looksLikeHtml = (buf: Buffer): boolean =>
  /^\s*(<!doctype html|<html)/i.test(buf.subarray(0, 200).toString("utf8"));

const fetchBuffer = async (url: string): Promise<Buffer> => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok)
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const ctype = res.headers.get("content-type") ?? "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (/text\/html/i.test(ctype) || looksLikeHtml(buf))
    throw new Error(
      `egov returned HTML, not a file, for ${url} (content-type: ${ctype || "?"}) — likely the /resource/download outage; retry later or use the dataset bulk-zip`,
    );
  return buf;
};

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

type ResourceRef = {
  uuid: string;
  /** Calendar year the score belongs to. For an academic year like
   * "учебна 2023/2024", we report it as the latter year (2024). */
  year: number;
  /** Cleaned title with year context. */
  title: string;
};

/**
 * Walk the dataset page and return one resource per year, picking the
 * primary May-June "задължителни" (mandatory) session for each. Skips
 * Aug-Sep retakes and optional-by-choice resources.
 */
export const discoverDziResources = async (): Promise<ResourceRef[]> => {
  const html = await fetchText(DATASET_PAGE);
  // Anchor format:
  //   <a href="/data/resourceView/<UUID>">Ресурс &nbsp;&#8211;&nbsp; <title>
  const anchors = Array.from(
    html.matchAll(
      /<a\s+href="(?:https?:\/\/data\.egov\.bg)?\/data\/resourceView\/([a-f0-9-]{36})"[^>]*>([\s\S]*?)<\/a>/g,
    ),
  );

  type Candidate = ResourceRef & { isPrimary: boolean };
  const byYear = new Map<number, Candidate>();

  for (const [, uuid, rawText] of anchors) {
    const clean = rawText
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&#8211;/g, "-")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    // Mandatory session?
    const isMandatory = /задължителн/i.test(clean);
    // Skip "по желание" (elective) resources.
    if (!isMandatory) continue;

    // Primary (May-June) or retake (Aug-Sep)?
    const isMayJune =
      /(сесия\s+май-юни|майска\s+сесия)/i.test(clean) || /май-юни/i.test(clean);
    const isAugSep = /сесия\s+август-септември/i.test(clean);
    if (isAugSep && !isMayJune) continue;
    if (!isMayJune) continue;

    // Year: prefer "учебна YYYY/YYYY+1" → take the second year, else fall back
    // to "майска сесия YYYY".
    let year: number | undefined;
    const academic = clean.match(/учебна\s+(\d{4})\/(\d{4})/);
    if (academic) year = Number(academic[2]);
    if (year === undefined) {
      const direct = clean.match(/майска\s+сесия\s+(\d{4})/i);
      if (direct) year = Number(direct[1]);
    }
    if (year === undefined) continue;

    const existing = byYear.get(year);
    if (!existing || (!existing.isPrimary && isMayJune)) {
      byYear.set(year, {
        uuid,
        year,
        title: clean,
        isPrimary: isMayJune,
      });
    }
  }

  return Array.from(byYear.values())
    .map((c): ResourceRef => ({ uuid: c.uuid, year: c.year, title: c.title }))
    .sort((a, b) => a.year - b.year);
};

// A cached file is only trusted if it is genuinely CSV — a size check alone is
// not enough, because the egov outage writes a ~170 KB HTML page that sails past
// any byte-count guard (that is exactly how the 2022-2025 caches got poisoned).
const cachedCsvIsValid = (dest: string): boolean => {
  if (!fs.existsSync(dest) || fs.statSync(dest).size <= 1024) return false;
  const head = fs
    .readFileSync(dest, { encoding: "utf8", flag: "r" })
    .slice(0, 200);
  return !/^\s*(<!doctype html|<html)/i.test(head);
};

const ensureCsv = async (ref: ResourceRef, force: boolean): Promise<string> => {
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  const dest = path.join(RAW_DIR, `${ref.year}.csv`);
  if (!force && cachedCsvIsValid(dest)) return dest;
  const buf = await fetchBuffer(`${DOWNLOAD_BASE}/${ref.uuid}/csv`);
  fs.writeFileSync(dest, buf);
  return dest;
};

/**
 * Parse one DZI CSV into school-level (Област, Община, count, scoreSum) tuples.
 * Returns rows ready for muni-level aggregation: each tuple represents one
 * school's count and *sum-of-scores* (= count × average), so summing across
 * the muni and dividing yields the correct weighted average.
 *
 * Hand-written parser — full RFC 4180 is overkill; the source uses double-
 * quoted fields with no embedded quotes/newlines.
 */
type SchoolRow = {
  oblast: string;
  obshtina: string;
  count: number;
  scoreSum: number;
};

const parseCsv = (file: string, year: number): SchoolRow[] => {
  // The CSV uses CR/LF; values may contain newlines inside quoted headers.
  // Strip BOM (U+FEFF), normalise CRLF→LF.
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  // The header row in older files spans multiple lines (newlines inside quoted
  // column names); parseCsvRows walks char-by-char respecting quote boundaries.
  const rows = parseCsvRows(text);
  if (rows.length < 2)
    throw new Error(`mon_dzi parseCsv(${file}): only ${rows.length} rows`);
  const header = normRow(rows[0]);

  const oblastIdx = header.findIndex((c) => /област/i.test(c));
  const obshtinaIdx = header.findIndex((c) => /община/i.test(c));

  // Two layouts:
  //  (a) modern (2022, 2024, 2025): one row, cells like
  //      "Бр. БЕЛ(ООП) З" + "Ср.усп. БЕЛ(ООП) З" side by side.
  //  (b) 2023:  three-row header — row 0 has bare "БЕЛ(ООП)" spanning two
  //      cols, row 2 has the paired "Бр." / "Ср.усп." labels. Data starts
  //      at row 3 (0-indexed).
  let countIdx = header.findIndex((c) => /бр\.?\s*БЕЛ\(ООП\)/i.test(c));
  let scoreIdx = header.findIndex((c) =>
    /ср\.?\s*усп\.?\s*БЕЛ\(ООП\)/i.test(c),
  );
  let dataStart = 1;

  if ((countIdx < 0 || scoreIdx < 0) && rows.length > 3) {
    // Look for bare "БЕЛ(ООП)" header in row 0 and a row 2 containing
    // paired Бр. / Ср.усп. labels.
    const belIdx = header.findIndex((c) => /^БЕЛ\(ООП\)/i.test(c));
    const subHeader = normRow(rows[2]);
    const isPaired =
      belIdx >= 0 &&
      /бр\./i.test(subHeader[belIdx] ?? "") &&
      /ср\.?\s*усп/i.test(subHeader[belIdx + 1] ?? "");
    if (isPaired) {
      countIdx = belIdx;
      scoreIdx = belIdx + 1;
      dataStart = 3;
    }
  }

  if (oblastIdx < 0 || obshtinaIdx < 0 || countIdx < 0 || scoreIdx < 0) {
    throw new Error(
      `mon_dzi parseCsv(${file}): missing BG columns. headers: ${header.slice(0, 8).join(" | ")}`,
    );
  }

  const out: SchoolRow[] = [];
  for (let r = dataStart; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length < scoreIdx + 1) continue;
    const oblast = cells[oblastIdx]?.trim();
    const obshtina = cells[obshtinaIdx]?.trim();
    const countRaw = cells[countIdx]?.trim();
    const scoreRaw = cells[scoreIdx]?.trim();
    if (!oblast || !obshtina) continue;
    if (!countRaw || !scoreRaw) continue;
    const count = Number(countRaw);
    const score = Number(scoreRaw.replace(",", "."));
    if (!Number.isFinite(count) || count <= 0) continue;
    if (!Number.isFinite(score) || score <= 0) continue;
    out.push({
      oblast,
      obshtina,
      count,
      scoreSum: count * score,
    });
  }
  if (out.length === 0)
    throw new Error(`mon_dzi parseCsv(${file}, ${year}): 0 valid rows parsed`);
  return out;
};

export type DziRow = {
  year: number;
  oblastContext: string;
  muniName: string;
  /** Weighted-mean score over the muni's schools, on the 2-6 scale. */
  value: number;
};

const aggregatePerMuni = (school: SchoolRow[]): Map<string, DziRow> => {
  // Key = "<oblast>||<obshtina>" so we can disambiguate same-name munis
  // across oblasts at the normalize step (same approach as AZ unemployment).
  const agg = new Map<
    string,
    { count: number; scoreSum: number; oblast: string; obshtina: string }
  >();
  for (const r of school) {
    const key = `${r.oblast}||${r.obshtina}`;
    const a = agg.get(key) ?? {
      count: 0,
      scoreSum: 0,
      oblast: r.oblast,
      obshtina: r.obshtina,
    };
    a.count += r.count;
    a.scoreSum += r.scoreSum;
    agg.set(key, a);
  }
  const out = new Map<string, DziRow>();
  for (const [key, a] of agg) {
    out.set(key, {
      year: 0, // filled in by caller
      oblastContext: a.oblast,
      muniName: a.obshtina,
      value: round(a.scoreSum / a.count, 2),
    });
  }
  return out;
};

export type MonDziFetchOpts = {
  forceDownload?: boolean;
  maxYears?: number;
  verbose?: boolean;
};

export type MonDziFetchResult = {
  rows: DziRow[];
};

/**
 * Discover, download, parse, aggregate. Returns one row per (year, muni).
 * The names are still in raw BG (uppercase, with МОН's specific naming
 * conventions) — `normalize.ts` will map them to obshtina codes.
 */
export const fetchMonDzi = async (
  opts: MonDziFetchOpts = {},
): Promise<MonDziFetchResult> => {
  const refs = await discoverDziResources();
  const slice = opts.maxYears ? refs.slice(-opts.maxYears) : refs;
  if (opts.verbose) {
    console.log(
      `MON DZI: discovered ${refs.length} primary May-June sessions (${refs[0]?.year}..${refs.at(-1)?.year}), processing ${slice.length}.`,
    );
  }

  const allRows: DziRow[] = [];
  for (const ref of slice) {
    let csvPath: string;
    try {
      csvPath = await ensureCsv(ref, !!opts.forceDownload);
    } catch (e) {
      if (opts.verbose)
        console.log(
          `  ${ref.year}: download failed — ${e instanceof Error ? e.message : e}`,
        );
      continue;
    }
    let schools: SchoolRow[];
    try {
      schools = parseCsv(csvPath, ref.year);
    } catch (e) {
      // Older formats (2016, 2017) use different column names; tolerate skip.
      if (opts.verbose)
        console.log(
          `  ${ref.year}: parse skipped — ${e instanceof Error ? e.message : e}`,
        );
      continue;
    }
    const munis = aggregatePerMuni(schools);
    for (const row of munis.values()) {
      allRows.push({ ...row, year: ref.year });
    }
    if (opts.verbose) {
      console.log(
        `  ${ref.year}: ${schools.length} schools → ${munis.size} munis`,
      );
    }
  }

  return { rows: allRows };
};
