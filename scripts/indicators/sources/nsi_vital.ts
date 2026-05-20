/**
 * НСИ — natural population change per municipality. Combines three NSI
 * timeseries XLSX (all cached under raw_data/indicators/nsi/):
 *   births:     Pop_1.2.1._birth_DR.xlsx   — live births
 *   deaths:     Pop_2.1._mortality_DR.xlsx — deaths
 *   population: Pop_6.1.1_Pop_DR.xlsx      — denominator (shared with
 *               nsi_population.ts, which caches the same file)
 *
 * Emits the crude rate of natural increase per 1,000 inhabitants:
 *   (births − deaths) / population × 1000
 * Negative = the municipality is shrinking from births/deaths alone
 * (Bulgaria's national rate is ≈ −9‰). A handful of young suburban and
 * Roma-majority municipalities run positive — the electorally interesting
 * outliers.
 *
 * Births/deaths ship as ONE wide sheet (rows = oblast/muni, a 3-column
 * Total/Male/Female block per year). Population ships as one sheet per
 * year. None of the three carries internal codes, and NSI names a few
 * municipalities inconsistently across the files (Добрич city/rural,
 * Сърница). Rather than reconcile names, each file is run through the
 * shared normalize() — which already resolves every name to an obshtina
 * code via _name_aliases.json — and the three are then joined by code.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";

import { normalize, type NormalizeInput } from "../normalize";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.resolve(__dirname, "../../../raw_data/indicators/nsi");
const UA = "Mozilla/5.0 (compatible; electionsbg-indicators/1.0)";
const TS_BASE = "https://www.nsi.bg/sites/default/files/files/data/timeseries";

const BIRTHS_FILE = "Pop_1.2.1._birth_DR.xlsx";
const DEATHS_FILE = "Pop_2.1._mortality_DR.xlsx";
const POP_FILE = "Pop_6.1.1_Pop_DR.xlsx";
const MIGRATION_FILE = "Pop_5.1_Migration_DR.xlsx";

// Oblast names as they appear in the NSI XLSX (used to tell oblast-header
// rows from municipality rows — the file has no programmatic flag, only
// indentation, which sheet_to_json strips). Mirrors nsi_population.ts.
const OBLAST_HEADER_NAMES = new Set<string>([
  "Благоевград",
  "Бургас",
  "Варна",
  "Велико Търново",
  "Видин",
  "Враца",
  "Габрово",
  "Добрич",
  "Кърджали",
  "Кюстендил",
  "Ловеч",
  "Монтана",
  "Пазарджик",
  "Перник",
  "Плевен",
  "Пловдив",
  "Разград",
  "Русе",
  "Силистра",
  "Сливен",
  "Смолян",
  "София",
  "София (столица)",
  "Стара Загора",
  "Търговище",
  "Хасково",
  "Шумен",
  "Ямбол",
]);

type Cell = string | number | null | undefined;
/** A parsed source: one NormalizeInput per (municipality, year). */
type ParsedRows = NormalizeInput[];

const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

const ensureXlsx = async (file: string, force: boolean): Promise<string> => {
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  const dest = path.join(RAW_DIR, file);
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 1024)
    return dest;
  const url = `${TS_BASE}/${file}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok)
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
};

// Births / deaths: a single wide sheet. One row N holds the year header (a
// year integer every 3 columns); each municipality row carries the Total
// value in the first column of that year's 3-column block.
const parseWide = (xlsxPath: string): ParsedRows => {
  const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true });

  let yearRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const nums = (rows[i] ?? []).filter(
      (c) => typeof c === "number" && c >= 2005 && c <= 2100,
    );
    if (nums.length >= 8) {
      yearRowIdx = i;
      break;
    }
  }
  if (yearRowIdx < 0)
    throw new Error(`nsi_vital: no year-header row in ${xlsxPath}`);
  const yearCols: { year: number; col: number }[] = [];
  (rows[yearRowIdx] ?? []).forEach((c, col) => {
    if (typeof c === "number" && c >= 2005 && c <= 2100)
      yearCols.push({ year: c, col });
  });

  const out: ParsedRows = [];
  let oblast: string | undefined;
  const consumed = new Set<string>();

  for (let i = yearRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const raw = row[0];
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name || name === "Общини" || name === "Области") continue;
    if (name === "Общо за страната") continue;
    // Sub-header / blank rows have no number in the first year column.
    if (typeof row[yearCols[0].col] !== "number") continue;

    const emit = (ob: string, mu: string) => {
      for (const { year, col } of yearCols) {
        const v = row[col];
        if (typeof v === "number" && Number.isFinite(v))
          out.push({ year, oblastContext: ob, muniName: mu, value: v });
      }
    };

    if (OBLAST_HEADER_NAMES.has(name) && !consumed.has(name)) {
      oblast = name;
      consumed.add(name);
      // Sofia city is both the oblast header and a single municipality.
      if (name === "София (столица)") emit(name, name);
      continue;
    }
    if (!oblast) continue;
    emit(oblast, name);
  }
  return out;
};

// Population: one sheet per year, name in col 0, total in col 1.
const parsePopulation = (xlsxPath: string): ParsedRows => {
  const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: "buffer" });
  const out: ParsedRows = [];
  for (const sheet of wb.SheetNames.filter((n) => /^\d{4}$/.test(n))) {
    const year = Number(sheet);
    const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[sheet], {
      header: 1,
      raw: true,
    });
    let oblast: string | undefined;
    const consumed = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const raw = row[0];
      if (typeof raw !== "string") continue;
      const name = raw.trim();
      if (!name || name === "Общо за страната") continue;
      const total = row[1];
      if (typeof total !== "number" || !Number.isFinite(total) || total <= 0)
        continue;
      if (OBLAST_HEADER_NAMES.has(name) && !consumed.has(name)) {
        oblast = name;
        consumed.add(name);
        if (name === "София (столица)")
          out.push({ year, oblastContext: name, muniName: name, value: total });
        continue;
      }
      if (!oblast) continue;
      out.push({ year, oblastContext: oblast, muniName: name, value: total });
    }
  }
  return out;
};

// Internal migration: one sheet per year. Column 7 is "Механичен прираст —
// всичко" (net migration = arrivals − departures); the national row is
// labelled "България". The net figure is routinely negative.
const parseMigration = (xlsxPath: string): ParsedRows => {
  const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: "buffer" });
  const out: ParsedRows = [];
  for (const sheet of wb.SheetNames.filter((n) => /^\d{4}$/.test(n))) {
    const year = Number(sheet);
    const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[sheet], {
      header: 1,
      raw: true,
    });
    let oblast: string | undefined;
    const consumed = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const raw = row[0];
      if (typeof raw !== "string") continue;
      const name = raw.trim();
      if (
        !name ||
        name === "България" ||
        name === "Общини" ||
        name === "Области"
      )
        continue;
      const net = row[7];
      if (typeof net !== "number" || !Number.isFinite(net)) continue;
      if (OBLAST_HEADER_NAMES.has(name) && !consumed.has(name)) {
        oblast = name;
        consumed.add(name);
        if (name === "София (столица)")
          out.push({ year, oblastContext: name, muniName: name, value: net });
        continue;
      }
      if (!oblast) continue;
      out.push({ year, oblastContext: oblast, muniName: name, value: net });
    }
  }
  return out;
};

// Resolve a parsed file to obshtina codes via the shared name→code
// normalizer, returning code → year → value.
const toCodeSeries = (rows: ParsedRows): Map<string, Map<number, number>> => {
  const report = normalize(rows);
  const out = new Map<string, Map<number, number>>();
  for (const r of report.matched) {
    let m = out.get(r.obshtinaCode);
    if (!m) {
      m = new Map();
      out.set(r.obshtinaCode, m);
    }
    m.set(r.year, r.value);
  }
  return out;
};

export type VitalRow = {
  year: number;
  obshtinaCode: string;
  /** Crude rate per 1,000 inhabitants — natural increase or net migration. */
  value: number;
};

export type NsiVitalFetchOpts = {
  forceDownload?: boolean;
  maxYears?: number;
  verbose?: boolean;
};

const applyMaxYears = (rows: VitalRow[], maxYears?: number): VitalRow[] => {
  if (!maxYears) return rows;
  const years = Array.from(new Set(rows.map((r) => r.year))).sort(
    (a, b) => b - a,
  );
  const keep = new Set(years.slice(0, maxYears));
  return rows.filter((r) => keep.has(r.year));
};

/** Crude rate of natural increase ‰ = (births − deaths) / population × 1000. */
export const fetchNsiVital = async (
  opts: NsiVitalFetchOpts = {},
): Promise<{ rows: VitalRow[] }> => {
  const force = !!opts.forceDownload;
  const births = toCodeSeries(parseWide(await ensureXlsx(BIRTHS_FILE, force)));
  const deaths = toCodeSeries(parseWide(await ensureXlsx(DEATHS_FILE, force)));
  const population = toCodeSeries(
    parsePopulation(await ensureXlsx(POP_FILE, force)),
  );

  if (opts.verbose) {
    console.log(
      `NSI vital: births ${births.size} munis, deaths ${deaths.size}, population ${population.size}`,
    );
  }

  const rows: VitalRow[] = [];
  for (const [code, birthYears] of births) {
    const deathYears = deaths.get(code);
    const popYears = population.get(code);
    if (!deathYears || !popYears) continue;
    for (const [year, b] of birthYears) {
      const d = deathYears.get(year);
      const pop = popYears.get(year);
      if (d === undefined || pop === undefined || pop <= 0) continue;
      rows.push({
        year,
        obshtinaCode: code,
        value: round(((b - d) / pop) * 1000, 1),
      });
    }
  }

  return { rows: applyMaxYears(rows, opts.maxYears) };
};

/** Net internal migration rate ‰ = net migration / population × 1000. */
export const fetchNsiMigration = async (
  opts: NsiVitalFetchOpts = {},
): Promise<{ rows: VitalRow[] }> => {
  const force = !!opts.forceDownload;
  const migration = toCodeSeries(
    parseMigration(await ensureXlsx(MIGRATION_FILE, force)),
  );
  const population = toCodeSeries(
    parsePopulation(await ensureXlsx(POP_FILE, force)),
  );

  if (opts.verbose) {
    console.log(
      `NSI migration: ${migration.size} munis, population ${population.size}`,
    );
  }

  const rows: VitalRow[] = [];
  for (const [code, migYears] of migration) {
    const popYears = population.get(code);
    if (!popYears) continue;
    for (const [year, net] of migYears) {
      const pop = popYears.get(year);
      if (pop === undefined || pop <= 0) continue;
      rows.push({
        year,
        obshtinaCode: code,
        value: round((net / pop) * 1000, 1),
      });
    }
  }

  return { rows: applyMaxYears(rows, opts.maxYears) };
};
