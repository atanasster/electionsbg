// Fetch + parse НЗОК's monthly clinical-activity files
// (nhif.bg/bg/hospitalcare-report/activities/{year}) and write
// data/budget/nzok/activities.json — the CASE-MIX corpus behind the health pack's
// activity tile + the pathway-internal cases-per-bed outlier (Phase 3 of
// docs/plans/nzok-hospital-intelligence-v1.md).
//
// The source is keyed by facility NAME (no Рег.№ ЛЗ), at the
// (facility × procedure × primary-ICD × secondary-ICD) grain, ~104k rows/month.
// parseActivities folds each file to (facility, procedure); this writer sums the
// 12 monthly files of a year to an ANNUAL (facility, procedure) matrix — the grain
// the tiles and the outlier query use, and small enough to commit — while keeping
// a national monthly cases/ЗОЛ series for the trend. The Рег.№→EIK crosswalk is a
// name fold resolved in the loader (which has Postgres), not here.
//
// Procedure NAMES and лв-value are NOT in the source (it carries the code only);
// the code's first letter gives the type (P→КП, A→АПр, K→КПр) and that is stored.
// A pathway price catalogue (НРД) would add value-in-euros — a documented
// follow-up, not shipped here.
//
// Usage:
//   tsx scripts/nzok/write_activities.ts            # latest full year on the page
//   tsx scripts/nzok/write_activities.ts --year 2025

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseActivities, type ActivityRow } from "./parse_activities";
import { BG_MONTHS } from "./bg_months";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../raw_data/nzok/activities");
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/activities.json",
);
// Compact companion (~10 KB, committed) for the AI tool + any static reader — the
// national headline + monthly trend + top procedures, WITHOUT the 20k-row
// facility matrix (that lives in Postgres via the loader). The cases-per-bed
// outlier is NOT here: it needs bed counts the loader attaches, not the writer.
const OVERVIEW_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/activities_overview.json",
);
const BASE = "https://nhif.bg";
const UA = "Mozilla/5.0 (compatible; naiasno-data/1.0)";

const fetchText = async (url: string): Promise<string> => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.text();
};

const fetchToFile = async (url: string, dest: string): Promise<void> => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
};

const argYear = (): number | null => {
  const i = process.argv.indexOf("--year");
  if (i >= 0 && process.argv[i + 1]) return Number(process.argv[i + 1]);
  return null;
};

/** Fold a facility name into the annual grouping key (`facility_fold`): upper-cased,
 *  quotes/punct stripped, whitespace collapsed. This is ONLY the grouping/PK key
 *  for the (facility, procedure) aggregate — it is deliberately NOT the same fold
 *  the loader uses for the EIK/beds crosswalk. The loader applies its own STRONGER
 *  `strongFold` (drops legal-form tokens, collapses СВЕТИ→СВ, strips Д-Р) to bridge
 *  the differently-spelled НЗОК/МЗ source names; do not "reconcile" the two or the
 *  crosswalk match rate regresses (~90% → ~30%). */
const foldName = (name: string): string =>
  name
    .toUpperCase()
    .replace(/[«»"'`„“”‘’]/g, "")
    .replace(/[^0-9A-ZА-Я]+/g, " ")
    .trim();

/** Procedure type from the code's first letter. P→КП (clinical pathway),
 *  A→АПр (ambulatory procedure), K→КПр (clinical procedure). Anything else → "".*/
const procType = (code: string): "КП" | "АПр" | "КПр" | "" => {
  const c = code.trim().toUpperCase()[0];
  return c === "P" ? "КП" : c === "A" ? "АПр" : c === "K" ? "КПр" : "";
};

/** Resolve the 12 monthly "Брой случаи и брой ЗОЛ по КП/АПр/КПр …" file links for
 *  a year from the listing HTML, keyed by the month embedded in the anchor text
 *  ("… за <Месец> <Year> г."). The href basenames are opaque /upload/NNNN/… paths,
 *  so the caption is the reliable key. */
interface FileRef {
  month: number;
  href: string;
}

const resolveFiles = (html: string, year: number): FileRef[] => {
  const out: FileRef[] = [];
  const seen = new Set<number>();
  const re = /<a[^>]*href="(\/upload\/[^"]*\.xlsx)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1];
    const text = m[2]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // Must be the case-count file (not "Брой прегледи", "Дентални дейности", …)
    // and carry a "за <месец> <year>" span.
    if (!/Брой\s+отчетени\s+дейности|Брой\s+случаи/i.test(text)) continue;
    const monthName = Object.keys(BG_MONTHS).find((mo) =>
      new RegExp(`за\\s+${mo}\\s+${year}`, "i").test(text),
    );
    if (!monthName) continue;
    const month = BG_MONTHS[monthName];
    if (seen.has(month)) continue;
    seen.add(month);
    out.push({ month, href });
  }
  out.sort((a, b) => a.month - b.month);
  return out;
};

interface FacilityProc {
  rzok: string;
  facility: string;
  facilityFold: string;
  procedure: string;
  procType: string;
  cases: number;
  zol: number;
}

const main = async (): Promise<void> => {
  // Which year? The caller's --year, else the newest year that has all 12 months.
  let year = argYear();
  if (year == null) {
    // Probe the current and previous calendar year; pick the newest with ≥12 files.
    const nowY = new Date().getUTCFullYear();
    for (const y of [nowY, nowY - 1, nowY - 2]) {
      const html = await fetchText(
        `${BASE}/bg/hospitalcare-report/activities/${y}`,
      );
      if (resolveFiles(html, y).length >= 12) {
        year = y;
        break;
      }
    }
    if (year == null) year = nowY - 1;
  }

  const html = await fetchText(
    `${BASE}/bg/hospitalcare-report/activities/${year}`,
  );
  const files = resolveFiles(html, year);
  if (files.length < 12)
    throw new Error(
      `only ${files.length}/12 monthly activity files resolved for ${year} — page layout may have changed`,
    );
  console.log(`Resolved ${files.length} monthly files for ${year}.`);

  // (facilityFold \x00 procedure) → annual aggregate; monthly national totals.
  const facProc = new Map<string, FacilityProc>();
  const monthlyNational: { period: string; cases: number; zol: number }[] = [];
  const periods: string[] = [];
  let sourceRows = 0;

  for (const f of files) {
    const period = `${String(f.month).padStart(2, "0")}.${year}`;
    const cache = path.join(
      RAW_DIR,
      `${year}_${String(f.month).padStart(2, "0")}.xlsx`,
    );
    if (!fs.existsSync(cache) || fs.statSync(cache).size < 10_000)
      await fetchToFile(BASE + f.href, cache);
    const { period: sheetPeriod, rows } = parseActivities(
      fs.readFileSync(cache),
    );
    // Integrity check: the sheet name's own month ("Данни за <Месец> <Year>")
    // should agree with the listing caption we keyed the file by. A mismatch means
    // the листинг and the file disagree — likely a wrong link or a reshuffled page,
    // so fail loudly rather than mislabel a month's data.
    if (sheetPeriod && sheetPeriod !== period)
      throw new Error(
        `activity file month mismatch: caption says ${period} but the sheet says ${sheetPeriod} (${f.href})`,
      );
    periods.push(period);
    let mCases = 0;
    let mZol = 0;
    for (const r of rows as ActivityRow[]) {
      sourceRows++;
      mCases += r.cases;
      mZol += r.zol;
      const fold = foldName(r.facility);
      const key = `${fold}\x00${r.procedure}`;
      let g = facProc.get(key);
      if (!g) {
        g = {
          rzok: r.rzok,
          facility: r.facility,
          facilityFold: fold,
          procedure: r.procedure,
          procType: procType(r.procedure),
          cases: 0,
          zol: 0,
        };
        facProc.set(key, g);
      }
      g.cases += r.cases;
      g.zol += r.zol;
    }
    monthlyNational.push({ period, cases: mCases, zol: mZol });
    console.log(
      `  ${period}: ${rows.length} (fac,proc) rows · ${mCases.toLocaleString("en")} cases`,
    );
  }

  const facilityProcedures = [...facProc.values()].sort(
    (a, b) =>
      a.facilityFold.localeCompare(b.facilityFold) ||
      a.procedure.localeCompare(b.procedure),
  );

  // National per-procedure roll-up (for logging + reconciliation; PG recomputes it).
  const byProc = new Map<
    string,
    {
      procedure: string;
      procType: string;
      cases: number;
      zol: number;
      facilities: Set<string>;
    }
  >();
  for (const g of facilityProcedures) {
    let p = byProc.get(g.procedure);
    if (!p)
      byProc.set(
        g.procedure,
        (p = {
          procedure: g.procedure,
          procType: g.procType,
          cases: 0,
          zol: 0,
          facilities: new Set(),
        }),
      );
    p.cases += g.cases;
    p.zol += g.zol;
    p.facilities.add(g.facilityFold);
  }
  const procedures = [...byProc.values()]
    .map((p) => ({
      procedure: p.procedure,
      procType: p.procType,
      cases: p.cases,
      zol: p.zol,
      facilityCount: p.facilities.size,
    }))
    .sort(
      (a, b) => b.cases - a.cases || a.procedure.localeCompare(b.procedure),
    );

  const totalCases = facilityProcedures.reduce((s, g) => s + g.cases, 0);
  const facilityCount = new Set(facilityProcedures.map((g) => g.facilityFold))
    .size;

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Национална здравноосигурителна каса (НЗОК)",
      url: `${BASE}/bg/hospitalcare-report/activities/${year}`,
      title:
        "Брой отчетени дейности по клинични пътеки/амбулаторни процедури/клинични процедури и брой ЗОЛ, по код на лечебно заведение и код на диагноза",
      description:
        "Месечни отчети на НЗОК за броя случаи и броя здравноосигурени лица (ЗОЛ) по клинична пътека (КП), амбулаторна процедура (АПр) и клинична процедура (КПр) по лечебно заведение. Агрегирано годишно на ниво (лечебно заведение, процедура). Източникът съдържа само кода на процедурата — типът е изведен по първата буква (P→КП, A→АПр, K→КПр); наименования и стойност по НРД не са налични в този източник.",
    },
    year,
    periods,
    monthlyNational,
    procedures,
    facilityProcedures,
    totals: {
      periodCount: periods.length,
      sourceRows,
      facilityProcedureRows: facilityProcedures.length,
      distinctProcedures: procedures.length,
      distinctFacilities: facilityCount,
      totalCases,
    },
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  // Compact committed companion for the AI tool / static readers.
  fs.writeFileSync(
    OVERVIEW_FILE,
    JSON.stringify(
      {
        generatedAt: out.generatedAt,
        source: out.source,
        year,
        totals: out.totals,
        monthlyNational,
        topProcedures: procedures.slice(0, 40),
      },
      null,
      2,
    ),
  );

  const bytes = fs.statSync(OUT_FILE).size;
  console.log(
    `\nWrote ${OUT_FILE} (${(bytes / 1024 / 1024).toFixed(1)} MB)\n` +
      `  year ${year} · ${periods.length} months\n` +
      `  ${sourceRows.toLocaleString("en")} source (fac,proc,month) rows → ${facilityProcedures.length.toLocaleString("en")} annual (fac,proc) rows\n` +
      `  ${procedures.length} distinct procedures · ${facilityCount} facilities · ${totalCases.toLocaleString("en")} total cases\n` +
      `  top procedure: ${procedures[0]?.procedure} (${procedures[0]?.procType}) — ${procedures[0]?.cases.toLocaleString("en")} cases @ ${procedures[0]?.facilityCount} facilities`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
