/**
 * Overdue obligations (просрочени задължения) — the consolidated year-end stock
 * of central-government + social-security + local-government payment arrears
 * (obligations past their statutory payment term). This is the politically
 * charged "hidden bills" metric: a successor cabinet routinely "discovers" the
 * arrears its predecessor left behind. Distinct from the budget deficit (a
 * flow) and from total commitments / задължения за разходи (a broader stock of
 * invoiced-but-not-yet-overdue bills).
 *
 * Source: minfin.bg "Просрочени задължения" statistics page
 * (https://www.minfin.bg/bg/statistics/10), one year-end file per year, as
 * either .xls (2015+) or .pdf (2005–2014), under two filename schemes (see the
 * README in data/_cache/minfin_arrears/). The page sits behind Cloudflare, which
 * 403s every non-browser client (even static /upload/ files) and serves an
 * interactive Turnstile that Playwright-driven Chromium can't clear — so the
 * files are downloaded by hand from a real browser and dropped there. This
 * script parses those drops into an annual EUR-million series.
 *
 * Each file is a one-sheet "Обобщена справка": a `Общо` total row in хил. лева
 * (thousand BGN), broken into central / social-security / local. We read the
 * total (and keep the breakdown for provenance), convert to euro at the locked
 * currency-board rate, and emit one year-end point per fiscal year. The
 * 2005–2008 PDFs tokenise out of order, so for those the total falls back to the
 * largest figure in the report (= the sum of the parts).
 *
 * Output: data/_cache/arrears.json (committed). Also patches data/macro.json in
 * place — adds series.arrears + indicators.arrears — so the feature goes live
 * without a full `fetch_eurostat.ts` regeneration. A later full macro refresh
 * re-bakes the same series via loadArrears() in fetch_eurostat.ts.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { pdf2array } from "pdf2array";
import { toEur } from "../../src/lib/currency";
import { parseBgNumber as parseNum } from "./lib/bgNumbers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DROP_DIR = path.resolve(__dirname, "../../data/_cache/minfin_arrears");
const OUT_CACHE = path.resolve(__dirname, "../../data/_cache/arrears.json");
const MACRO_FILE = path.resolve(__dirname, "../../data/macro.json");

// Consolidated arrears have never exceeded ~1.5 BGN bn (≈ €0.8 bn) in the
// post-2010 series. Anything above this ceiling is a source-file data error
// (e.g. the published 2022 Q4 file lists local arrears as ~€46.5 bn — a stray
// ~500× the neighbouring years), so we flag and exclude it rather than plot a
// nonsense bar that wrecks the chart's y-axis.
const MAX_PLAUSIBLE_EUR_MILLION = 3000;

type ArrearsUnit =
  | "BGN_THOUSAND"
  | "BGN_MILLION"
  | "EUR_THOUSAND"
  | "EUR_MILLION";

export type ArrearsPoint = {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  period: string; // "YYYY"
  value: number | null; // EUR million (year-end consolidated total)
  nativeTotal: number | null; // total as published (in `unit`)
  unit: ArrearsUnit;
  breakdownEurM: {
    central: number | null;
    social: number | null;
    local: number | null;
  };
  sourceFile: string;
  suspect: boolean; // true when the published total fails the sanity ceiling
};

type Drop = {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  lang: "BG" | "EN";
  ext: "xls" | "pdf";
  file: string;
};

// minfin's /upload/ filenames come in two schemes (and both .xls and .pdf):
//   new (2013+):     "Payment arrears Q4 2015_BG.xls" / ".pdf"  (4-digit year)
//   old (2005–2012): "Payment_arrears_4Q12_BG.pdf",
//                    "Payment_arrears_1Q05_BG-new08.pdf",
//                    "Payment_arrears_4Q09_Bg_new.pdf"  (quarter-then-Q,
//                    2-digit year, assorted "-new"/case suffixes).
const FN_NEW =
  /Payment[ _]arrears[ _]Q([1-4])[ _](20\d{2})_(BG|EN).*\.(xls|pdf)$/i;
const FN_OLD = /Payment_arrears_([1-4])Q(\d{2})_(BG|EN).*\.(xls|pdf)$/i;

const enumerateDrops = (): Drop[] => {
  if (!fs.existsSync(DROP_DIR)) return [];
  const out: Drop[] = [];
  for (const fn of fs.readdirSync(DROP_DIR)) {
    const mNew = FN_NEW.exec(fn);
    const mOld = mNew ? null : FN_OLD.exec(fn);
    const m = mNew ?? mOld;
    if (!m) continue;
    out.push({
      quarter: Number(m[1]) as 1 | 2 | 3 | 4,
      // new scheme captures a 4-digit year; old captures a 2-digit one (05→2005).
      year: mNew ? Number(m[2]) : 2000 + Number(m[2]),
      lang: m[3].toUpperCase() as "BG" | "EN",
      ext: m[4].toLowerCase() as "xls" | "pdf",
      file: path.join(DROP_DIR, fn),
    });
  }
  return out;
};

// Read either an .xls (XLSX) or a .pdf (pdf2array) into the same row-of-cells
// shape: [label, value, …]. Both schemes put the label in cell 0 and the figure
// in a later cell.
const readRows = async (entry: Drop): Promise<unknown[][]> => {
  const bytes = new Uint8Array(fs.readFileSync(entry.file));
  if (entry.ext === "pdf") {
    try {
      return await pdf2array(bytes);
    } catch {
      return [];
    }
  }
  try {
    const wb = XLSX.read(bytes, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
    });
  } catch {
    return [];
  }
};

const detectUnit = (blob: string): ArrearsUnit => {
  const b = blob.toLowerCase();
  if (/хил\.?\s*евро|eur\s*thous/.test(b)) return "EUR_THOUSAND";
  if (/млн\.?\s*евро|eur\s*mln/.test(b)) return "EUR_MILLION";
  if (/млн\.?\s*лв/.test(b)) return "BGN_MILLION";
  return "BGN_THOUSAND"; // "в хил. лева" — the historical default
};

const nativeToEurMillion = (
  v: number | null,
  unit: ArrearsUnit,
): number | null => {
  if (v == null || !Number.isFinite(v)) return null;
  let eurUnits: number | null;
  switch (unit) {
    case "BGN_THOUSAND":
      eurUnits = toEur(v * 1_000, "BGN");
      break;
    case "BGN_MILLION":
      eurUnits = toEur(v * 1_000_000, "BGN");
      break;
    case "EUR_THOUSAND":
      eurUnits = v * 1_000;
      break;
    case "EUR_MILLION":
      eurUnits = v * 1_000_000;
      break;
  }
  if (eurUnits == null) return null;
  return Math.round((eurUnits / 1_000_000) * 10) / 10;
};

const parseFile = async (entry: Drop): Promise<ArrearsPoint | null> => {
  const rows = await readRows(entry);
  if (rows.length === 0) return null;

  const blob = rows
    .flat()
    .map((c) => (c == null ? "" : String(c)))
    .join(" ");
  const unit = detectUnit(blob);

  // Each row is [label, value, …]. Pick the first parseable numeric cell after
  // the label so a stray empty column doesn't shift the read.
  const findVal = (re: RegExp): number | null => {
    for (const r of rows) {
      if (!Array.isArray(r)) continue;
      const label = String(r[0] ?? "").trim();
      if (!re.test(label)) continue;
      for (const c of r.slice(1)) {
        const n = parseNum(c);
        if (n != null) return n;
      }
      return null;
    }
    return null;
  };

  // Anchor to the start of the label: the sheet's title row also contains
  // "…централно и местно правителство и социалноосигурителните фондове…", so an
  // un-anchored match would hit that (value-less) row before the real
  // breakdown rows. Older files label the central tier "Консолидирано централно
  // правителство"; newer ones just "Централно правителство".
  let totalNative = findVal(/^общо/i);
  const centralNative = findVal(/^(консолидирано\s+)?централно\s+прав/i);
  const socialNative = findVal(/^социалноосигур/i);
  const localNative = findVal(/^местно\s+прав/i);

  // The 2005–2008 PDFs come out of pdf.js with their cells in scrambled order,
  // so the "Общо" row never reassembles. Fall back to the largest figure in the
  // report — the total is by definition the sum of central+local+social, so it
  // is the maximum value present (footnotes like the EU-account municipal line
  // are far smaller). The sanity ceiling below still guards against junk.
  if (totalNative == null) {
    let mx: number | null = null;
    for (const r of rows) {
      if (!Array.isArray(r)) continue;
      for (const c of r) {
        const n = parseNum(c);
        if (n != null && (mx == null || n > mx)) mx = n;
      }
    }
    totalNative = mx;
  }

  const totalEurM = nativeToEurMillion(totalNative, unit);
  const suspect =
    totalEurM == null || totalEurM < 0 || totalEurM > MAX_PLAUSIBLE_EUR_MILLION;

  return {
    year: entry.year,
    quarter: entry.quarter,
    period: String(entry.year),
    value: totalEurM,
    nativeTotal: totalNative,
    unit,
    breakdownEurM: {
      central: nativeToEurMillion(centralNative, unit),
      social: nativeToEurMillion(socialNative, unit),
      local: nativeToEurMillion(localNative, unit),
    },
    sourceFile: path.basename(entry.file),
    suspect,
  };
};

export const buildArrears = async (): Promise<{
  points: ArrearsPoint[];
  clean: ArrearsPoint[];
}> => {
  const drops = enumerateDrops();
  // Prefer BG over EN, and Q4 (year-end) over earlier quarters, per year.
  const byYear = new Map<number, Drop>();
  for (const d of drops) {
    const prev = byYear.get(d.year);
    if (
      !prev ||
      d.quarter > prev.quarter ||
      (d.quarter === prev.quarter && d.lang === "BG" && prev.lang === "EN")
    ) {
      byYear.set(d.year, d);
    }
  }
  const parsed = await Promise.all([...byYear.values()].map(parseFile));
  const points = parsed
    .filter((p): p is ArrearsPoint => p != null)
    .sort((a, b) => a.year - b.year);
  const clean = points.filter((p) => !p.suspect);
  return { points, clean };
};

const ARREARS_META = {
  titleEn: "Overdue obligations (просрочени задължения)",
  titleBg: "Просрочени задължения",
  unitLabelEn: "EUR million (year-end consolidated stock)",
  unitLabelBg: "млн. евро (натрупан обем към края на годината)",
  cadence: "annual" as const,
  source: "curated" as const,
  sourceUrl: "https://www.minfin.bg/bg/statistics/10",
  attributionEn:
    "Ministry of Finance — Просрочени задължения (year-end Обобщена справка, Общо row), consolidated central + social-security + local government",
  attributionBg:
    "Министерство на финансите — Просрочени задължения (обобщена справка към края на годината, ред „Общо“): консолидирано централно правителство, социалноосигурителни фондове и местно правителство",
};

// Inject series.arrears + indicators.arrears into the committed data/macro.json
// without disturbing any other series, so the feature works without a full
// fetch_eurostat.ts regeneration.
const patchMacroJson = (clean: ArrearsPoint[]): boolean => {
  if (!fs.existsSync(MACRO_FILE)) {
    console.warn(`macro.json not found at ${MACRO_FILE}; skipping patch.`);
    return false;
  }
  const macro = JSON.parse(fs.readFileSync(MACRO_FILE, "utf8")) as {
    indicators: Record<string, unknown>;
    series: Record<string, unknown>;
  };
  macro.indicators.arrears = ARREARS_META;
  macro.series.arrears = clean.map((p) => ({ year: p.year, value: p.value }));
  // Match the assembler's compact (no-indent) JSON layout.
  fs.writeFileSync(MACRO_FILE, JSON.stringify(macro));
  return true;
};

const runCli = async () => {
  const { points, clean } = await buildArrears();
  if (points.length === 0) {
    console.warn(
      `No arrears files found in ${DROP_DIR}. Drop "Payment arrears Q4 YYYY_BG.xls" files there (see README) and re-run.`,
    );
  }
  fs.writeFileSync(
    OUT_CACHE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source:
          "minfin.bg/bg/statistics/10 — year-end Payment arrears Q4 YYYY_BG.xls (Обобщена справка, Общо row); manually downloaded (Cloudflare blocks automation) and parsed by scripts/macro/fetch_arrears.ts",
        unitNote:
          "value = EUR million, year-end consolidated stock (central + social-security + local government)",
        annual: points,
      },
      null,
      2,
    ) + "\n",
  );
  const patched = patchMacroJson(clean);
  console.log(`\nWrote ${OUT_CACHE}: ${points.length} year(s) parsed.`);
  for (const p of points) {
    console.log(
      `  ${p.year}: ${p.value == null ? "—" : `€${p.value}M`}` +
        ` (central €${p.breakdownEurM.central ?? "—"}M, local €${p.breakdownEurM.local ?? "—"}M, social €${p.breakdownEurM.social ?? "—"}M)` +
        (p.suspect ? "  ⚠ SUSPECT — excluded from series" : ""),
    );
  }
  console.log(
    `\n${clean.length} clean year(s) written to macro.json series.arrears${patched ? "" : " (patch skipped)"}.`,
  );
};

const isMain = process.argv[1] && process.argv[1].endsWith("fetch_arrears.ts");
if (isMain) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
