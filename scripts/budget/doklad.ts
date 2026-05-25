// Annual "Доклад за състоянието на администрацията" (Report on the State of
// the Administration) parser. Published yearly by the Council of Ministers
// and indexed at iisda.government.bg/annual_reports. Each report is a single
// OCR'd PDF; we extract the section II.1 prose totals, Table 1 (count of
// administrative structures by type) and Table II-1 (NSI list-headcount by
// type).
//
// The Доклад aggregates by administration *type* (Министерства, Държавни
// агенции, Областни администрации, …) — it complements the per-ministry
// headcount extracted by headcount.ts and gives the national context that
// individual ministry reports can't.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "../..");
const CACHE_DIR = path.resolve(REPO_ROOT, "raw_data/budget");

// iisda.government.bg/annual_report_file/<id> — resolved from each annual
// report's landing page (iisda.government.bg/annual_report/<reportId>).
// Hand-curated because the ids aren't a dense sequence. Add a row when a new
// Доклад is published.
//
// resolveDokladFile() will fetch the landing page and find the file id when a
// year is requested without a curated mapping — useful for backfills.
export const DOKLAD_FILE_IDS: Record<number, string> = {
  2017: "304_787",
  2018: "364_1067",
  2019: "488_1431",
  2020: "504_2307",
  2021: "564_2747",
  2022: "623_3190",
  2023: "644_3867",
  2024: "664_4187",
  2025: "703_4605",
};

const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget/1.0; +https://electionsbg.com)";

// ---------- types ----------

// All values are щатни бройки (positions). The narrative format shifts
// across years — only `total` is reliably present in every Доклад since
// 2017; the rest are best-effort and null when the year's report doesn't
// publish them or uses a phrasing the regex doesn't recognise.
export interface DokladPositions {
  total: number; // основна щатна численост (positions/slots)
  central: number | null; // централна администрация
  territorial: number | null; // териториална администрация
  municipal: number | null; // общински + районни (subset of territorial)
  municipalOwnRevenue: number | null; // дейност "Общинска администрация" от собствени приходи
  filled: number | null; // заети щатни бройки
  vacant: number | null; // незаети щатни бройки
  vacantOverSixMonths: number | null; // незаети за повече от 6 месеца
}

export interface DokladStructureCounts {
  central: Record<string, number>;
  territorial: Record<string, number>;
}

export interface DokladNsiHeadcount {
  central: Record<string, number>;
  territorial: Record<string, number>;
  total: number;
}

export interface ParsedDoklad {
  year: number;
  positions: DokladPositions;
  structureCounts: DokladStructureCounts;
  nsiHeadcount: DokladNsiHeadcount;
}

// ---------- fetch + cache ----------

export const fetchDokladPdf = async (year: number): Promise<Buffer> => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `doklad-${year}.pdf`);
  if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath);
  const id = DOKLAD_FILE_IDS[year];
  if (!id) throw new Error(`no Доклад file id curated for year ${year}`);
  const url = `https://iisda.government.bg/annual_report_file/${id}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(cachePath, buf);
  return buf;
};

// pdftotext via shell — robust against the encoding quirks of pdfjs-dist on
// this particular PDF (which spews "Unknown font tag" warnings on every page).
const pdfToText = (pdfBytes: Buffer, year: number): string => {
  const cachedTxt = path.join(CACHE_DIR, `doklad-${year}.txt`);
  if (fs.existsSync(cachedTxt)) return fs.readFileSync(cachedTxt, "utf8");
  const tmpPdf = path.join(CACHE_DIR, `doklad-${year}-tmp.pdf`);
  fs.writeFileSync(tmpPdf, pdfBytes);
  execSync(`pdftotext -layout "${tmpPdf}" "${cachedTxt}"`, { stdio: "pipe" });
  fs.unlinkSync(tmpPdf);
  return fs.readFileSync(cachedTxt, "utf8");
};

// "145 802" → 145802 (handles regular spaces + U+00A0 thin spaces).
const toN = (s: string): number => Number(s.replace(/[\s\u00a0]/g, ""));

// ---------- regex-based extractors ----------

const parseSection2Prose = (text: string): DokladPositions => {
  // Anchor on the phrase that's present in every Доклад since 2017 — the
  // prefix word varies ("основната" 2024+, "общата" 2017, none in 2022) so
  // we anchor on the unique tail.
  const sectionStart = text.search(
    /щатна\s+численост\s+по\s+устройствен\s+правилник/i,
  );
  if (sectionStart < 0) {
    throw new Error("Доклад: section II.1 body anchor not found");
  }
  // Walk back ~120 chars to capture the prefix that holds the "total" number.
  const start = Math.max(0, sectionStart - 120);
  const section = text.slice(start, start + 3000);

  // Bulgarian thousands grouping: 1-3 digits, then any number of " 3-digit"
  // groups. Stops at footnote-superscript stray digits ("105 927 5" → "105 927").
  const numTight = "(\\d{1,3}(?:[\\s\\u00a0]\\d{3})*)";
  // Best-effort grab — returns null when the pattern is absent (older
  // reports omit some fields entirely).
  const grab = (re: RegExp): number | null => {
    const m = section.match(re);
    return m ? toN(m[1]) : null;
  };
  const grabRequired = (re: RegExp, label: string): number => {
    const v = grab(re);
    if (v == null) throw new Error(`Доклад: regex miss for "${label}"`);
    return v;
  };
  return {
    total: grabRequired(
      // "общата|основната щатна численост ... e N щ. бр." or just
      // "щатна численост ... е N щ. бр.".
      new RegExp(`щатна\\s+численост[^]*?(?:е|са)\\s+${numTight}\\s*щ\\.`, "i"),
      "total positions",
    ),
    central: grab(
      new RegExp(
        `централната\\s+администрация\\s*\\d*\\s*са\\s+${numTight}`,
        "i",
      ),
    ),
    territorial: grab(
      // "териториалната администрация N." | "са N" | "– N" (en-dash 2022).
      // Period is optional because 2017 has the value followed by "Числеността"
      // with no terminator.
      new RegExp(
        `териториалната\\s+администрация\\s*[-–—]?\\s*(?:са\\s+)?${numTight}`,
        "i",
      ),
    ),
    municipal: grab(
      new RegExp(
        `общинските\\s+и\\s+районни[^]*?е\\s+${numTight}\\s*щ\\.`,
        "i",
      ),
    ),
    municipalOwnRevenue: grab(
      // "собствени приходи (на общините)? са N"
      new RegExp(`собствени\\s+приходи[^]*?са\\s+${numTight}`, "i"),
    ),
    filled: grab(
      // Lookbehind reject "Не" prefix — under /i, "Заетите" inside
      // "Незаетите" would otherwise match.
      new RegExp(
        `(?<!Не)Заетите\\s+щатни\\s+бройки[^]*?са\\s+${numTight}`,
        "i",
      ),
    ),
    vacant: grab(
      // 2017+ phrasing: "Незаетите щатни бройки [в администрацията] са N".
      new RegExp(
        `Незаетите\\s+щатни\\s+бройки(?:\\s+в\\s+администрацията)?\\s+са\\s+${numTight}`,
        "i",
      ),
    ),
    vacantOverSixMonths: grab(
      new RegExp(
        `повече\\s+от\\s+(?:шест|6)\\s+месеца\\s+са\\s+${numTight}`,
        "i",
      ),
    ),
  };
};

const parseStructureCounts = (text: string): DokladStructureCounts => {
  // Older Доклади (2017-2021) lay out Table 1 differently and may not be
  // detectable. Return empty when missing rather than throwing.
  const startIdx = text.search(/Вид администрация\s+Брой/);
  if (startIdx < 0) return { central: {}, territorial: {} };
  const endIdx = text.indexOf("Поради спецификата", startIdx);
  const block = text.slice(startIdx, endIdx > 0 ? endIdx : startIdx + 3000);

  const central: Record<string, number> = {};
  const territorial: Record<string, number> = {};
  let region: "central" | "territorial" | null = null;
  // JS \b doesn't work with Cyrillic; use explicit boundary.
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^Централна(?:\s|$)/.test(line)) region = "central";
    else if (/^Териториална(?:\s|$)/.test(line)) region = "territorial";
    if (!region) continue;
    const m = line.match(/^(.*?)\s+(\d+)\s+(\d+)\s*$/);
    if (!m) continue;
    const label = m[1]
      .replace(/^(Централна|Териториална)\s+администрация\s*/i, "")
      .replace(/^(Централна|Териториална)\s*/i, "")
      .replace(/^администрация\s*/i, "")
      .trim();
    // Require ≥3 Cyrillic letters (rejects stray numbers, dashes, year
    // headers like "Брой 2024") while letting genuine short labels through.
    const cyrillicLetters = (label.match(/[А-Яа-я]/g) ?? []).length;
    if (cyrillicLetters < 3) continue;
    const thisYearCount = Number(m[3]);
    if (thisYearCount === 0 || thisYearCount > 500) continue;
    (region === "central" ? central : territorial)[label] = thisYearCount;
  }
  return { central, territorial };
};

interface NsiRow {
  label: string; // human-readable label used as the output key
  match: string; // unique tail substring used to anchor the regex
  region: "central" | "territorial";
}
const NSI_ROWS: NsiRow[] = [
  {
    region: "central",
    label: "Министерства и администрация на Министерския съвет",
    match: "на Министерския съвет",
  },
  { region: "central", label: "Държавни агенции", match: "Държавни агенции" },
  { region: "central", label: "Държавни комисии", match: "Държавни комисии" },
  {
    region: "central",
    label: "Изпълнителни агенции",
    match: "Изпълнителни агенции",
  },
  {
    region: "central",
    label: "Административни структури — изпълнителна власт",
    match: "осъществяване на изпълнителната власт",
  },
  {
    region: "central",
    label: "Административни структури — Народно събрание",
    match: "отчитащи се пред Народното събрание",
  },
  {
    region: "central",
    label: "Структури по чл. 60 от Закона за администрацията",
    match: "от Закона за администрацията",
  },
  {
    region: "territorial",
    label: "Областни администрации",
    match: "Областни администрации",
  },
  {
    region: "territorial",
    label: "Общински администрации",
    match: "Общински администрации",
  },
  {
    region: "territorial",
    label: "Специализирани териториални администрации",
    match: "Специализирани териториални администрации",
  },
];

const parseNsiHeadcount = (text: string, year: number): DokladNsiHeadcount => {
  // Older Доклади use different NSI table layouts; return empty when missing.
  const headerIdx = text.indexOf(`м. декември ${year} г.`);
  if (headerIdx < 0) return { central: {}, territorial: {}, total: 0 };
  const endIdx = text.indexOf("Общо за цялата администрация", headerIdx);
  if (endIdx < 0) return { central: {}, territorial: {}, total: 0 };
  const block = text.slice(headerIdx, endIdx + 300).replace(/\s+/g, " ");

  const central: Record<string, number> = {};
  const territorial: Record<string, number> = {};
  for (const row of NSI_ROWS) {
    const flexible = row.match
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const re = new RegExp(
      `${flexible}(?:\\d+)?\\s+(\\d{1,3}(?:[\\s\\u00a0]\\d{3})*)`,
    );
    const m = block.match(re);
    if (!m) continue;
    const n = toN(m[1]);
    if (n === 0 || n > 1_000_000) continue;
    (row.region === "central" ? central : territorial)[row.label] = n;
  }
  const totalMatch = text
    .slice(endIdx, endIdx + 300)
    .match(/Общо за цялата администрация:\s*(\d{1,3}(?:[\s\u00a0]\d{3})*)/);
  const total = totalMatch ? toN(totalMatch[1]) : 0;
  return { central, territorial, total };
};

// ---------- public API ----------

export const parseDoklad = async (year: number): Promise<ParsedDoklad> => {
  const pdfBytes = await fetchDokladPdf(year);
  const text = pdfToText(pdfBytes, year);
  return {
    year,
    positions: parseSection2Prose(text),
    structureCounts: parseStructureCounts(text),
    nsiHeadcount: parseNsiHeadcount(text, year),
  };
};
