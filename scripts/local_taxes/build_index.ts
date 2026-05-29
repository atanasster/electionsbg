// Tier A — build data/local_taxes/index.json from the ИПИ 265obshtini.bg
// per-indicator CSVs.
//
// For each indicator (IPI_INDICATORS) we fetch
// `https://www.265obshtini.bg/downloadCSV/{ipiId}` and parse the wide-format
// rows `Община,YYYY,YYYY,...,YYYY` into a per-município per-year series.
// Each município gets an `ipi` block with values + national rank for the
// latest available year.
//
// Merge behaviour: we read any existing data/local_taxes/index.json first
// and preserve per-município `naredba` blocks that Tier B parsers wrote.
// We only overwrite the `ipi` half of each município entry, plus the
// file-level metadata derived from the CSVs.

import fs from "node:fs";
import path from "node:path";
import {
  IPI_INDICATORS,
  IPI_CSV_URL,
  EUR_PER_BGN,
  CURRENCY_INDICATORS,
  type IpiIndicatorKey,
} from "./ipi";
import { matchObshtina } from "./lib/match_obshtina";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const OUT_DIR = path.join(PROJECT_ROOT, "data/local_taxes");
const OUT_FILE = path.join(OUT_DIR, "index.json");
const SHARD_PATH = (code: string): string => path.join(OUT_DIR, `${code}.json`);

type YearSeries = Record<string, number>;

type IpiPerIndicator = {
  values: YearSeries;
  latestYear: number;
  latestValue: number;
  nationalRank: number; // 1 = lowest rate (cheapest for taxpayer)
};

type NaredbaBlock = {
  year: number;
  url?: string;
  tboResidential?: {
    basis: "promil" | "users" | "area" | "volume";
    rate?: number;
    unit?: string;
    zone?: string;
    note?: string;
  };
  touristTax?: { value: number; unit: string };
  dogTax?: { value: number; unit: string };
};

type ScoreEntry = {
  ipi?: Partial<Record<IpiIndicatorKey, IpiPerIndicator>>;
  naredba?: NaredbaBlock;
};

type Indicator = {
  key: IpiIndicatorKey;
  ipiId: number;
  unit: string;
  direction: "lower-better";
  label: { bg: string; en: string };
};

type TboBasisLabels = Record<
  "promil" | "users" | "area" | "volume",
  { bg: string; en: string }
>;

/** Slim index — everything that's global (meta, indicators, labels,
 *  national averages, rank denominators). ~5-10 KB. The tile reads
 *  this once per session for the indicator labels and rank context. */
type LocalTaxesIndexFile = {
  source: string;
  sourceUrl: string;
  indexName: string;
  latestYear: number;
  indicators: Indicator[];
  tboBasisLabels: TboBasisLabels;
  nationalAverages: Partial<Record<IpiIndicatorKey, number>>;
  /** Rank denominator per indicator — how many municípios are ranked
   *  for this indicator (varies if some indicators have missing data). */
  rankTotals: Partial<Record<IpiIndicatorKey, number>>;
  fetchedAt: string;
};

/** Per-município shard — the actual ipi block + optional naredba block.
 *  ~1-2 KB each. The tile lazy-fetches one shard per município the user
 *  visits; React Query caches them forever. */
type LocalTaxesObshtinaFile = {
  obshtina: string;
  ipi?: Partial<Record<IpiIndicatorKey, IpiPerIndicator>>;
  naredba?: NaredbaBlock;
};

const TBO_BASIS_LABELS: TboBasisLabels = {
  promil: {
    bg: "промил от данъчната оценка",
    en: "promille of tax-assessment value",
  },
  users: {
    bg: "брой ползватели",
    en: "per user-count",
  },
  area: {
    bg: "РЗП (площ на имота)",
    en: "per built area",
  },
  volume: {
    bg: "количество отпадък",
    en: "by waste volume",
  },
};

// Parse one CSV: `Община,"2021",2022,...,YYYY\nИме,val,val,...,val\n`
// — first column is município name, remaining columns are per-year values.
// Empty cells are treated as missing (no entry added).
const parseCsv = (
  csv: string,
): { years: number[]; rows: Array<{ name: string; values: YearSeries }> } => {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { years: [], rows: [] };
  // Header: split on commas but tolerate quoted year cells (`"2021"`).
  const headerCells = splitCsvRow(lines[0]);
  const years: number[] = [];
  for (let i = 1; i < headerCells.length; i++) {
    const m = headerCells[i].match(/(20\d{2})/);
    if (m) years.push(Number(m[1]));
  }
  const rows: Array<{ name: string; values: YearSeries }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvRow(lines[i]);
    if (cells.length < 2) continue;
    const name = cells[0].replace(/^"|"$/g, "").trim();
    const values: YearSeries = {};
    for (let j = 0; j < years.length; j++) {
      const raw = cells[j + 1];
      if (raw == null || raw.trim() === "") continue;
      const cleaned = raw.replace(/"/g, "").replace(",", ".").trim();
      const num = Number(cleaned);
      if (Number.isFinite(num)) values[String(years[j])] = num;
    }
    if (Object.keys(values).length > 0) rows.push({ name, values });
  }
  return { years, rows };
};

// Minimal CSV-row splitter that handles double-quoted fields. ИПИ's CSVs
// only quote year headers (`"2021"`), but the helper is robust to the
// general case in case future indicators add commas inside município names.
const splitCsvRow = (row: string): string[] => {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells;
};

/** Round to a sensible number of decimals: 2 for values ≥ 1, 3 below. */
const roundEur = (v: number): number =>
  v >= 1 ? Math.round(v * 100) / 100 : Math.round(v * 1000) / 1000;

/** Convert a BGN value to EUR using the fixed eurozone-entry rate. */
const bgnToEur = (v: number): number => roundEur(v * EUR_PER_BGN);

/** Apply BGN→EUR to every year of an indicator's per-município series.
 *  Ratio indicators (promille, percent) are pass-through. */
const convertSeriesToEur = (
  key: IpiIndicatorKey,
  values: YearSeries,
): YearSeries => {
  if (!CURRENCY_INDICATORS.has(key)) return values;
  const out: YearSeries = {};
  for (const [year, v] of Object.entries(values)) out[year] = bgnToEur(v);
  return out;
};

const fetchCsv = async (url: string): Promise<string> => {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; electionsbg-localtaxes/1.0; +https://electionsbg.com)",
      Accept: "text/csv, */*;q=0.5",
      "Accept-Language": "bg,en;q=0.7",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
};

/** Read existing per-município shards so we can carry forward the
 *  `naredba` blocks that Tier B parsers wrote — the Tier A rebuild
 *  shouldn't wipe them. */
const loadExistingShards = (): Record<string, LocalTaxesObshtinaFile> => {
  const out: Record<string, LocalTaxesObshtinaFile> = {};
  if (!fs.existsSync(OUT_DIR)) return out;
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    try {
      const obshtina = f.replace(/\.json$/, "");
      const data = JSON.parse(
        fs.readFileSync(path.join(OUT_DIR, f), "utf-8"),
      ) as LocalTaxesObshtinaFile;
      out[obshtina] = data;
    } catch {
      // skip malformed shards — they'll be rewritten cleanly
    }
  }
  return out;
};

const main = async () => {
  const existingShards = loadExistingShards();
  const scoresByObshtina: Record<string, ScoreEntry> = {};
  // Carry forward any existing `naredba` blocks Tier B parsers wrote.
  for (const [code, shard] of Object.entries(existingShards)) {
    if (shard.naredba) {
      scoresByObshtina[code] = { naredba: shard.naredba };
    }
  }

  const nationalAverages: Partial<Record<IpiIndicatorKey, number>> = {};
  const rankTotals: Partial<Record<IpiIndicatorKey, number>> = {};
  let overallLatestYear = 0;
  let totalUnmatched = 0;
  const unmatchedNames = new Set<string>();

  for (const indicator of IPI_INDICATORS) {
    const url = IPI_CSV_URL(indicator.ipiId);
    console.log(`fetching ${indicator.key} (id=${indicator.ipiId})…`);
    const csv = await fetchCsv(url);
    const { years, rows } = parseCsv(csv);
    if (years.length === 0 || rows.length === 0) {
      console.warn(`  warning: empty CSV for ${indicator.key}`);
      continue;
    }
    const latestYear = Math.max(...years);
    overallLatestYear = Math.max(overallLatestYear, latestYear);

    // Match each row's município name → obshtina code, then convert the
    // CSV's BGN values to EUR if this is a currency indicator.
    type Resolved = {
      code: string;
      name: string;
      values: YearSeries;
      latestValue: number;
    };
    const resolved: Resolved[] = [];
    for (const r of rows) {
      const code = matchObshtina(r.name);
      if (!code) {
        totalUnmatched++;
        unmatchedNames.add(r.name);
        continue;
      }
      const converted = convertSeriesToEur(indicator.key, r.values);
      const latestValue = converted[String(latestYear)];
      if (latestValue == null) continue;
      resolved.push({
        code,
        name: r.name,
        values: converted,
        latestValue,
      });
    }

    // Rank by latest-year value ascending (1 = lowest rate).
    const ranked = resolved
      .slice()
      .sort((a, b) => a.latestValue - b.latestValue);
    const rankByCode = new Map<string, number>();
    for (let i = 0; i < ranked.length; i++) {
      rankByCode.set(ranked[i].code, i + 1);
    }
    rankTotals[indicator.key] = resolved.length;

    for (const r of resolved) {
      const entry: ScoreEntry = scoresByObshtina[r.code] ?? {};
      const ipi = entry.ipi ?? {};
      ipi[indicator.key] = {
        values: r.values,
        latestYear,
        latestValue: r.latestValue,
        nationalRank: rankByCode.get(r.code) ?? 0,
      };
      entry.ipi = ipi;
      scoresByObshtina[r.code] = entry;
    }

    // National average for the latest year.
    const sum = resolved.reduce((acc, r) => acc + r.latestValue, 0);
    nationalAverages[indicator.key] =
      resolved.length > 0
        ? Math.round((sum / resolved.length) * 1000) / 1000
        : 0;

    console.log(
      `  ${indicator.key}: ${resolved.length}/${rows.length} municípios mapped · latest year ${latestYear} · avg ${nationalAverages[indicator.key]}`,
    );
  }

  if (unmatchedNames.size > 0) {
    console.warn(
      `\n${unmatchedNames.size} unique unmatched município name(s) (added MANUAL_ALIASES in scripts/local_taxes/lib/match_obshtina.ts):`,
    );
    for (const n of Array.from(unmatchedNames).sort()) {
      console.warn(`  · ${n}`);
    }
  }

  const indexOut: LocalTaxesIndexFile = {
    source: "Институт за пазарна икономика — 265 общини",
    sourceUrl: "https://www.265obshtini.bg/",
    indexName: "Местни данъци и такси",
    latestYear: overallLatestYear,
    indicators: IPI_INDICATORS,
    tboBasisLabels: TBO_BASIS_LABELS,
    nationalAverages,
    rankTotals,
    fetchedAt: new Date().toISOString(),
  };

  // Write the slim index plus one shard per município that has any data.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(indexOut, null, 2) + "\n");

  // Track which shards we've written so we can clean up stale ones from
  // previous runs (e.g. if an alias change moves data to a different
  // obshtina code).
  const writtenShards = new Set<string>();
  for (const [code, entry] of Object.entries(scoresByObshtina)) {
    if (!entry.ipi && !entry.naredba) continue;
    const shardOut: LocalTaxesObshtinaFile = { obshtina: code };
    if (entry.ipi) shardOut.ipi = entry.ipi;
    if (entry.naredba) shardOut.naredba = entry.naredba;
    fs.writeFileSync(
      SHARD_PATH(code),
      JSON.stringify(shardOut, null, 2) + "\n",
    );
    writtenShards.add(code);
  }

  // Prune shards that didn't get written this run — keeps the dir clean
  // when an obshtina drops out of all indicators (rare, but possible).
  let pruned = 0;
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    const code = f.replace(/\.json$/, "");
    if (!writtenShards.has(code)) {
      fs.unlinkSync(path.join(OUT_DIR, f));
      pruned++;
    }
  }

  const ipiCount = Object.values(scoresByObshtina).filter(
    (e) => e.ipi && Object.keys(e.ipi).length > 0,
  ).length;
  const naredbaCount = Object.values(scoresByObshtina).filter(
    (e) => e.naredba,
  ).length;
  console.log(
    `\nwrote ${path.relative(PROJECT_ROOT, OUT_FILE)} (slim index) · ${writtenShards.size} per-município shard(s) · ipi: ${ipiCount} municípios · naredba: ${naredbaCount} (preserved) · total unmatched cell-rows: ${totalUnmatched}${pruned > 0 ? ` · pruned ${pruned} stale shard(s)` : ""}`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
