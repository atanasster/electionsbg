/**
 * НСИ (Национален статистически институт) — annual population per
 * municipality. Source:
 *   https://www.nsi.bg/sites/default/files/files/data/timeseries/Pop_6.1.1_Pop_DR.xlsx
 *
 * One XLSX, one sheet per year (currently 2010..2025). Each sheet lists:
 *   - row "Общо за страната" — national total
 *   - one row per oblast (name only, total = sum of munis)
 *   - rows per municipality indented under that oblast
 * Columns: [name, total, men, women, urban_total, urban_men, urban_women,
 *           rural_total, rural_men, rural_women]
 *
 * We emit one row per (year, muni) carrying the **year-over-year percent
 * change** in total population. The change is the more electorally
 * interesting signal: shrinking munis (>1% loss per year) and the few that
 * grow (Sofia city + suburbs, some Black-Sea coast munis) explain a lot
 * about how parties' regional bases are evolving.
 *
 * Sofia (столица) appears as both an oblast header AND an implicit muni
 * row (there is no nested "Столична" — Sofia city is a single muni at
 * NSI). We fold it under the synthetic SOF00 city code via normalize.ts.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.resolve(__dirname, "../../../raw_data/indicators/nsi");

const SOURCE_URL =
  "https://www.nsi.bg/sites/default/files/files/data/timeseries/Pop_6.1.1_Pop_DR.xlsx";

const UA = "Mozilla/5.0 (compatible; electionsbg-indicators/1.0)";

// Oblast names as they appear in the NSI XLSX. Used to detect oblast-header
// rows during the walk (since the file has no programmatic oblast/muni flag,
// only indentation that XLSX strips). Matches normalize.ts's OBLAST_BG
// entries — keep in sync.
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

export type PopRow = {
  year: number;
  oblastContext: string;
  muniName: string;
  /** Year-over-year percent change. Positive = growing. */
  value: number;
};

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

const ensureLocalXlsx = async (force: boolean): Promise<string> => {
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  const dest = path.join(RAW_DIR, "Pop_6.1.1_Pop_DR.xlsx");
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 1024)
    return dest;
  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": UA } });
  if (!res.ok)
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${SOURCE_URL}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
};

type AbsRow = { oblast: string; muni: string; year: number; total: number };

/**
 * Walk one yearly sheet and emit (oblast, muni, year, absolute-total) rows.
 * Tracks the current oblast as we descend; switches whenever we hit a row
 * whose name is in OBLAST_HEADER_NAMES — except the special Sofia case
 * where the city is both an oblast header AND a single muni row.
 */
const parseSheet = (ws: XLSX.WorkSheet, year: number): AbsRow[] => {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
  });

  const out: AbsRow[] = [];
  let oblast: string | undefined;
  // Per-sheet set of oblast names already consumed as headers. The first
  // occurrence of each name in OBLAST_HEADER_NAMES is the oblast row;
  // subsequent occurrences (e.g. "Благоевград" the city, inside Благоевград
  // oblast) are munis. NSI relies on indentation to disambiguate but
  // sheet_to_json drops formatting, so we use this positional heuristic.
  const consumed = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const rawName = row[0];
    if (rawName === null || rawName === undefined) continue;
    const name = String(rawName).trim();
    if (!name) continue;
    if (name === "Общо за страната") continue;
    const total = row[1];
    if (typeof total !== "number" || !Number.isFinite(total) || total <= 0)
      continue;

    if (OBLAST_HEADER_NAMES.has(name) && !consumed.has(name)) {
      oblast = name;
      consumed.add(name);
      // "София (столица)" appears once as the oblast header AND represents
      // the single Sofia-city muni (NSI doesn't nest district rows under
      // it). Emit the muni row immediately; normalize.ts routes the
      // столица→столица pair to the synthetic SOF00 city code.
      if (name === "София (столица)") {
        out.push({ oblast: name, muni: name, year, total });
      }
      continue;
    }

    if (!oblast) continue;
    out.push({ oblast, muni: name, year, total });
  }

  // Naming-drift fixup. NSI swapped Добрич oblast's naming in 2025:
  //   pre-2025: "Добрич" = rural muni; "Добрич - град" = city
  //   2025+:    "Добрич - селска" = rural; "Добрич" alone = city
  // Canonicalize so the alias map (which expects "Добрич - град" → DOB28
  // and "Добрич - селска" → DOB15) always finds the right row.
  const hasModernRural = out.some(
    (r) => r.oblast === "Добрич" && r.muni === "Добрич - селска",
  );
  for (const r of out) {
    if (r.oblast === "Добрич" && r.muni === "Добрич") {
      r.muni = hasModernRural ? "Добрич - град" : "Добрич - селска";
    }
  }

  return out;
};

export type NsiPopulationFetchOpts = {
  forceDownload?: boolean;
  maxYears?: number;
  verbose?: boolean;
};

export const fetchNsiPopulation = async (
  opts: NsiPopulationFetchOpts = {},
): Promise<{ rows: PopRow[] }> => {
  const xlsxPath = await ensureLocalXlsx(!!opts.forceDownload);
  const buf = fs.readFileSync(xlsxPath);
  const wb = XLSX.read(buf, { type: "buffer" });

  // Sheets are named "2010", "2011", ..., "2025".
  const yearSheets = wb.SheetNames.filter((n) => /^\d{4}$/.test(n))
    .map((n) => ({ year: Number(n), sheet: n }))
    .sort((a, b) => a.year - b.year);
  const slice = opts.maxYears ? yearSheets.slice(-opts.maxYears) : yearSheets;

  if (opts.verbose) {
    console.log(
      `NSI Pop_6.1.1: ${yearSheets.length} year sheets (${yearSheets[0]?.year}..${yearSheets.at(-1)?.year}), processing ${slice.length}.`,
    );
  }

  // Collect absolute populations indexed by (oblast||muni) → Map<year, total>.
  type Series = Map<number, number>;
  const series = new Map<
    string,
    { oblast: string; muni: string; data: Series }
  >();
  for (const { year, sheet } of slice) {
    const ws = wb.Sheets[sheet];
    const abs = parseSheet(ws, year);
    if (opts.verbose) console.log(`  ${year}: ${abs.length} muni rows`);
    for (const row of abs) {
      const key = `${row.oblast}||${row.muni}`;
      const existing = series.get(key);
      if (existing) {
        existing.data.set(year, row.total);
      } else {
        series.set(key, {
          oblast: row.oblast,
          muni: row.muni,
          data: new Map([[year, row.total]]),
        });
      }
    }
  }

  // Compute YoY % change for every (muni, year) where we have both N and N-1.
  const rows: PopRow[] = [];
  for (const { oblast, muni, data } of series.values()) {
    const years = Array.from(data.keys()).sort((a, b) => a - b);
    for (let i = 1; i < years.length; i++) {
      const y = years[i];
      const prev = data.get(years[i - 1]);
      const curr = data.get(y);
      if (
        prev === undefined ||
        curr === undefined ||
        prev <= 0 ||
        !Number.isFinite(prev) ||
        !Number.isFinite(curr)
      )
        continue;
      // Skip non-consecutive years to avoid biasing the change rate.
      if (years[i] - years[i - 1] !== 1) continue;
      const pct = ((curr - prev) / prev) * 100;
      rows.push({
        year: y,
        oblastContext: oblast,
        muniName: muni,
        value: round(pct, 2),
      });
    }
  }

  return { rows };
};
