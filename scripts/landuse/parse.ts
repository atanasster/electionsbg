// Parse the NSI LANDUSE annex (English version) into a per-oblast record.
//
// The annex carries three tables we care about:
//   • Table 1: Land use distribution by districts (sq. km) — 9 columns
//     (total + 8 category area).
//   • Table 2: Land use distribution by districts (%) — same 9 columns,
//     national total = 100.00, per-row totals = 100.00 ± 0.01 rounding.
//   • Table 3: Population density by types of territory by districts —
//     3 columns (total area, urbanized areas, total minus water).
//
// Each row prefixes with a 2- or 3-letter code: `BG` for the national
// row, then the 28 oblast codes (`BLG`, `BGS`, ..., `JAM`) NSI uses
// throughout its publications. These match the codebase's own oblast
// codes in `data/municipalities.json` 1:1, with two aggregation quirks
// the frontend hook resolves (SOF → S23/S24/S25, PDV → PDV + PDV-00).
//
// The parser is layout-driven (`pdftotext -layout`) and locates the
// three tables by their header strings, so it survives minor changes
// in pagination across years.

import { execFileSync } from "child_process";
import { CATEGORY_KEYS, type CategoryKey } from "./sources";

const PDFTOTEXT = "pdftotext";

export interface OblastRow {
  code: string; // NSI 3-letter code (or 'BG' for national)
  name: string; // English name as printed
  totalKm2: number;
  byCategoryKm2: Record<CategoryKey, number>;
  byCategoryPct: Record<CategoryKey, number>;
  popDensityTotal: number;
  popDensityUrbanized: number;
  popDensityExclWater: number;
}

export interface ParsedReport {
  year: number;
  national: OblastRow;
  oblasts: Record<string, OblastRow>;
}

const runPdftotext = (pdfPath: string): string =>
  execFileSync(PDFTOTEXT, ["-layout", pdfPath, "-"], {
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });

const findLine = (lines: string[], probe: string): number => {
  const i = lines.findIndex((l) => l.includes(probe));
  if (i < 0)
    throw new Error(`LANDUSE parser: cannot locate marker "${probe}" in PDF`);
  return i;
};

// Match a districts-table row, irrespective of how many spaces sit
// between columns. The 2- or 3-letter code anchors the regex.
const ROW_RX = /^\s+([A-Z]{2,3})\s{2,}(.+)$/;

const splitColumns = (tail: string): string[] =>
  tail
    .split(/\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

const parseFloatStrict = (s: string): number => {
  const n = Number(s.replace(/\s+/g, "").replace(",", "."));
  if (!Number.isFinite(n))
    throw new Error(`LANDUSE parser: expected number, got "${s}"`);
  return n;
};

interface RawRow {
  code: string;
  name: string;
  nums: number[];
}

const parseBlock = (
  lines: string[],
  start: number,
  end: number,
  ncols: number,
): RawRow[] => {
  const out: RawRow[] = [];
  for (let i = start; i < end; i++) {
    const m = ROW_RX.exec(lines[i]);
    if (!m) continue;
    const code = m[1];
    const cols = splitColumns(m[2]);
    if (cols.length < ncols + 1) continue;
    const name = cols.slice(0, cols.length - ncols).join(" ");
    const numTokens = cols.slice(cols.length - ncols);
    let nums: number[];
    try {
      nums = numTokens.map(parseFloatStrict);
    } catch {
      continue;
    }
    out.push({ code, name, nums });
  }
  return out;
};

const toCategoryRecord = (nums: number[]): Record<CategoryKey, number> => {
  if (nums.length !== CATEGORY_KEYS.length)
    throw new Error(
      `LANDUSE parser: expected ${CATEGORY_KEYS.length} category values, got ${nums.length}`,
    );
  const out = {} as Record<CategoryKey, number>;
  CATEGORY_KEYS.forEach((k, i) => {
    out[k] = nums[i];
  });
  return out;
};

const detectYear = (text: string): number => {
  const m = /AS\s+OF\s+31\.12\.(\d{4})/.exec(text);
  if (!m) throw new Error("LANDUSE parser: cannot detect reference year");
  return Number(m[1]);
};

export const parseLandUsePdf = (pdfPath: string): ParsedReport => {
  const text = runPdftotext(pdfPath);
  const lines = text.split(/\r?\n/);
  const year = detectYear(text);

  const t1 = findLine(lines, "Table 1. Land use distribution by districts");
  const t2 = findLine(lines, "Table 2. Land use distribution by districts");
  const t3 = findLine(lines, "Table 3. Population density");

  const block1 = parseBlock(lines, t1 + 1, t2, 9);
  const block2 = parseBlock(lines, t2 + 1, t3, 9);
  const block3 = parseBlock(lines, t3 + 1, lines.length, 3);

  if (block1.length < 29)
    throw new Error(
      `LANDUSE parser: Table 1 returned ${block1.length} rows (expected 29 = 1 national + 28 oblasts)`,
    );

  const byCode: Record<string, OblastRow> = {};
  const codeToName: Record<string, string> = {};
  for (const r of block1) codeToName[r.code] = r.name;

  for (const r1 of block1) {
    const r2 = block2.find((x) => x.code === r1.code);
    const r3 = block3.find((x) => x.code === r1.code);
    if (!r2 || !r3)
      throw new Error(
        `LANDUSE parser: missing row in Table 2/3 for ${r1.code}`,
      );
    byCode[r1.code] = {
      code: r1.code,
      name: codeToName[r1.code],
      totalKm2: r1.nums[0],
      byCategoryKm2: toCategoryRecord(r1.nums.slice(1)),
      byCategoryPct: toCategoryRecord(r2.nums.slice(1)),
      popDensityTotal: r3.nums[0],
      popDensityUrbanized: r3.nums[1],
      popDensityExclWater: r3.nums[2],
    };
  }

  const national = byCode["BG"];
  if (!national)
    throw new Error("LANDUSE parser: national BG row missing from Table 1");

  const oblasts: Record<string, OblastRow> = {};
  for (const [code, row] of Object.entries(byCode)) {
    if (code === "BG") continue;
    oblasts[code] = row;
  }

  if (Object.keys(oblasts).length !== 28)
    throw new Error(
      `LANDUSE parser: expected 28 oblast rows, got ${Object.keys(oblasts).length}`,
    );

  // Sanity: every oblast's category-% should sum to ~100. Tolerate ±0.05
  // for rounding (NSI publishes to 2 decimals).
  for (const r of Object.values(oblasts)) {
    const pctSum = CATEGORY_KEYS.reduce((s, k) => s + r.byCategoryPct[k], 0);
    if (Math.abs(pctSum - 100) > 0.05)
      throw new Error(
        `LANDUSE parser: ${r.code} category-% sum = ${pctSum.toFixed(3)} (expected 100 ± 0.05)`,
      );
  }

  return { year, national, oblasts };
};
