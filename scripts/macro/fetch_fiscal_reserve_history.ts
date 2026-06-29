/**
 * Fiscal-reserve HISTORY backfill (2005–2014) — year-end values that predate the
 * Wayback-based fetch_fiscal_reserve.ts coverage (which starts 2015). The
 * minfin.bg "Фискален резерв" page (statistics/4) is Cloudflare-blocked, so the
 * year-end PDFs are downloaded by hand and dropped into
 * data/_cache/minfin_fr_history/ (see README). This parses them into an annual
 * year-end series, writes data/_cache/fiscal-reserve-history.json (committed),
 * and merges the pre-2015 points into data/macro.json series.fiscalReserve
 * WITHOUT touching the 2015+ data (so the live Wayback series is preserved).
 *
 * Three report layouts appear across the years:
 *   2005–2013: a table whose headline is "Общ баланс на ФР  X млн лв."
 *   2014:      "ІІІ. Фискален резерв* (І+ІІ)  X млн. лв." (the broader I+II
 *              measure introduced with the 2014 Public Finance Act, §1 т.41)
 *   2011:      prose — "фискалният резерв е в размер на X млрд. лв."
 * pdf2array keeps these in reading order but splits numbers into digit-cells
 * ("6 | 011 | . | 8"), so we reconstruct the page text and regex the headline.
 *
 * METHODOLOGY NOTE: the 2014 ЗПФ redefinition broadened the measure (adds part
 * II — EU-fund receivables / National Fund), so pre-2014 "Общ баланс" and the
 * 2014+ "(I+II)" are not strictly comparable. The chart footnotes this.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pdf2array } from "pdf2array";
import { toEur } from "../../src/lib/currency";
import { parseBgNumber as numFrom } from "./lib/bgNumbers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DROP_DIR = path.resolve(__dirname, "../../data/_cache/minfin_fr_history");
const OUT_CACHE = path.resolve(
  __dirname,
  "../../data/_cache/fiscal-reserve-history.json",
);
const MACRO_FILE = path.resolve(__dirname, "../../data/macro.json");

export type FrHistoryPoint = {
  year: number;
  quarter: 4;
  period: string; // "YYYY-Q4"
  value: number | null; // EUR million (year-end)
  nativeBgnMillion: number | null;
  measure: "balance" | "I+II" | "prose";
  sourceMonth: number; // 11 or 12
  sourceFile: string;
};

// Filenames seen: "FRA -12- 2005-BG.pdf", "FRA-12-2012-BG.pdf",
// "FRA–Q4-2011-BG.pdf" (en-dash). Extract the year + the month (11/12) or Q4.
const parseName = (
  fn: string,
): { year: number; sourceMonth: number } | null => {
  if (!/\.pdf$/i.test(fn)) return null;
  const ym = /(20\d{2})/.exec(fn);
  if (!ym) return null;
  const year = Number(ym[1]);
  if (/Q4/i.test(fn)) return { year, sourceMonth: 12 };
  const mm = /[-–]\s*(11|12)\s*[-–]/.exec(fn);
  if (mm) return { year, sourceMonth: Number(mm[1]) };
  return { year, sourceMonth: 12 };
};

// Reconstruct the page text (pdf2array splits numbers into digit-cells) and pull
// the headline reserve figure + its unit, trying the layouts in priority order.
const extract = (
  text: string,
): { bgnMillion: number; measure: FrHistoryPoint["measure"] } | null => {
  const grab = (re: RegExp): { v: number; unit: string } | null => {
    const m = re.exec(text);
    if (!m) return null;
    const v = numFrom(m[1]);
    if (v == null) return null;
    return { v, unit: (m[2] || "").toLowerCase() };
  };
  const toMillion = (g: { v: number; unit: string }): number =>
    g.unit.startsWith("млрд") ? g.v * 1000 : g.v;

  // 1) 2014+ broader measure: "Фискален резерв* (І+ІІ)" or "Общ размер … (I+II)".
  const iiTotal =
    grab(
      /фискален\s*резерв\*?\s*\(\s*[IІ]\s*\+\s*[IІ]+\s*\)\s*([\d.,\s]+?)\s*(млрд|млн)/i,
    ) ||
    grab(
      /общ\s*размер\s*на\s*фискалния\s*резерв\D{0,30}?([\d.,\s]+?)\s*(млрд|млн)/i,
    );
  if (iiTotal) return { bgnMillion: toMillion(iiTotal), measure: "I+II" };

  // 2) 2005–2013 table headline: "Общ баланс на ФР  X млн лв.".
  const balance = grab(/Общ\s*баланс\s*на\s*ФР\s*([\d.,\s]+?)\s*(млрд|млн)/i);
  if (balance) return { bgnMillion: toMillion(balance), measure: "balance" };

  // 3) prose: "фискалният резерв е в размер на X млрд. лв.".
  const prose = grab(
    /фискалният\s*резерв\s*е\s*в\s*размер\s*на\s*([\d.,\s]+?)\s*(млрд|млн)/i,
  );
  if (prose) return { bgnMillion: toMillion(prose), measure: "prose" };

  return null;
};

const parseFile = async (fn: string): Promise<FrHistoryPoint | null> => {
  const meta = parseName(fn);
  if (!meta) return null;
  let rows: unknown[][];
  try {
    rows = await pdf2array(
      new Uint8Array(fs.readFileSync(path.join(DROP_DIR, fn))),
    );
  } catch {
    return null;
  }
  const text = rows
    .flat()
    .map((c) => (c == null ? "" : String(c)))
    .join(" ")
    .replace(/\s+/g, " ");
  const got = extract(text);
  const bgn = got?.bgnMillion ?? null;
  const eur = bgn != null ? toEur(bgn * 1_000_000, "BGN") : null;
  return {
    year: meta.year,
    quarter: 4,
    period: `${meta.year}-Q4`,
    value: eur != null ? Math.round(eur / 1_000_000) : null,
    nativeBgnMillion: bgn,
    measure: got?.measure ?? "balance",
    sourceMonth: meta.sourceMonth,
    sourceFile: fn,
  };
};

export const buildFrHistory = async (): Promise<FrHistoryPoint[]> => {
  if (!fs.existsSync(DROP_DIR)) return [];
  const points: FrHistoryPoint[] = [];
  for (const fn of fs.readdirSync(DROP_DIR)) {
    const p = await parseFile(fn);
    if (p) points.push(p);
  }
  // One point per year (prefer the latest source month if duplicates).
  const byYear = new Map<number, FrHistoryPoint>();
  for (const p of points.sort((a, b) => a.sourceMonth - b.sourceMonth))
    byYear.set(p.year, p);
  return [...byYear.values()].sort((a, b) => a.year - b.year);
};

const patchMacroJson = (clean: FrHistoryPoint[]): boolean => {
  if (!fs.existsSync(MACRO_FILE)) {
    console.warn(`macro.json not found at ${MACRO_FILE}; skipping patch.`);
    return false;
  }
  const macro = JSON.parse(fs.readFileSync(MACRO_FILE, "utf8")) as {
    series: Record<string, Array<{ year: number; quarter?: number }>>;
  };
  const existing = (macro.series.fiscalReserve ?? []) as Array<{
    year: number;
    quarter?: number;
    period?: string;
    value: number;
  }>;
  const yearsPresent = new Set(existing.map((p) => p.year));
  const additions = clean
    .filter((p) => p.value != null && !yearsPresent.has(p.year))
    .map((p) => ({
      year: p.year,
      quarter: 4 as const,
      period: p.period,
      value: p.value as number,
    }));
  const merged = [...additions, ...existing].sort(
    (a, b) => a.year - b.year || (a.quarter ?? 0) - (b.quarter ?? 0),
  );
  macro.series.fiscalReserve = merged;
  fs.writeFileSync(MACRO_FILE, JSON.stringify(macro));
  return true;
};

const isMain =
  process.argv[1] &&
  process.argv[1].endsWith("fetch_fiscal_reserve_history.ts");
if (isMain) {
  buildFrHistory()
    .then((points) => {
      fs.writeFileSync(
        OUT_CACHE,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            source:
              "minfin.bg/bg/statistics/4 — year-end Фискален резерв reports (manually downloaded; Cloudflare blocks automation). 2005–2013 = 'Общ баланс на ФР'; 2014 = 'Фискален резерв (I+II)' (broader post-2014-ЗПФ measure); 2011 = inline prose. Parsed by scripts/macro/fetch_fiscal_reserve_history.ts.",
            unitNote: "value = EUR million, year-end stock",
            annual: points,
          },
          null,
          2,
        ) + "\n",
      );
      const patched = patchMacroJson(points);
      console.log(`Wrote ${OUT_CACHE}: ${points.length} year(s).`);
      for (const p of points)
        console.log(
          `  ${p.year} (${p.measure}, m${p.sourceMonth}): ${p.nativeBgnMillion ?? "—"} млн лв = ${p.value == null ? "—" : `€${p.value}M`}`,
        );
      console.log(
        `\nMerged pre-2015 points into macro.json${patched ? "" : " (patch skipped)"}.`,
      );
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
