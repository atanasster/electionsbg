/**
 * Cash budget balance (касов дефицит/излишък по КФП) — the Ministry of Finance
 * "Консолидирана фискална програма" headline balance, on a CASH basis. This is
 * the number Bulgarian politicians actually quote ("дефицитът беше X% от БВП"),
 * and it differs from the Eurostat ESA balance the scorecard already plots:
 * cash counts money in/out when it moves, ESA accrues it to the period it
 * belongs to, so the two diverge in any given year (sometimes a lot — 2022 was
 * −0.8% cash vs −3.0% ESA). Showing both lets a reader see the gap rather than
 * argue past it.
 *
 * Source — the authoritative МФ annual КФП file. The "Данни по консолидираната
 * фискална програма (годишни)" page (minfin.bg/bg/statistics/13) publishes a
 * consolidated workbook (e.g. `Cons_2014-2024_BG.xls`) with years as columns
 * and a `Бюджетно салдо (Дефицит(-) / Излишък(+))` row in млн. лв. — THE
 * canonical cash balance. The page sits behind Cloudflare (same wall as the
 * arrears/reserve pages — see those scripts), so the workbook is downloaded by
 * hand from a real browser and dropped into `data/_cache/minfin_kfp/` (the
 * *.xls is gitignored; this parser reads it). We do NOT use the egov monthly
 * КФП feed (data/budget/index.json) for this column — its annual roll-up is a
 * different consolidation basis and diverges materially from the МФ headline
 * (e.g. 2022: egov −3.4% vs МФ −0.8%), so mixing the two would be misleading.
 *
 * An OPTIONAL sidecar `data/_cache/minfin_kfp/cash-manual.json` (committed only
 * if you create it; see the README there) can supply additional years by hand
 * (e.g. pre-2014, or a current year not yet on the annual page), and
 * `override: true` lets it correct a year the workbook also carries. It's absent
 * by default, so cash currently covers the workbook's range (2014–2024).
 *
 * Output: data/_cache/cash-balance.json (committed) + an in-place patch of
 * data/macro.json (series.cashBalance + indicators.cashBalance) so the feature
 * goes live without a full fetch_eurostat.ts regeneration. Values are stored as
 * the annual balance in EUR million; the scorecard divides by the SAME
 * macro.series.nominalGdp the ESA balance uses, so the cash and ESA %-of-GDP
 * columns share one denominator and are directly comparable.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { toEur } from "../../src/lib/currency";
import { parseBgNumber as parseNum } from "./lib/bgNumbers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DROP_DIR = path.resolve(__dirname, "../../data/_cache/minfin_kfp");
const MANUAL_FILE = path.join(DROP_DIR, "cash-manual.json");
const OUT_CACHE = path.resolve(
  __dirname,
  "../../data/_cache/cash-balance.json",
);
const MACRO_FILE = path.resolve(__dirname, "../../data/macro.json");

export type CashBalancePoint = {
  year: number;
  value: number | null; // EUR million, full-year consolidated КФП balance
  source: "minfin-annual" | "manual";
  note?: string;
};

type ManualEntry = {
  year: number;
  eurMillion?: number; // year-end balance already in EUR million
  bgnMillion?: number; // …or in BGN million (converted at the board rate)
  override?: boolean; // replace a workbook year (default: only fill gaps)
  source?: string;
  note?: string;
};

const round1 = (v: number): number => Math.round(v * 10) / 10;

const bgnMillionToEurMillion = (bgnMillion: number): number | null => {
  const eur = toEur(bgnMillion * 1_000_000, "BGN");
  return eur == null ? null : round1(eur / 1_000_000);
};

// Parse one МФ consolidated annual workbook: locate the year-header row (the
// "млн.лв." row whose later cells are 4-digit years) and the "Бюджетно салдо"
// row, then pair each year column with its balance.
const parseAnnualWorkbook = (file: string): CashBalancePoint[] => {
  let rows: unknown[][];
  try {
    const wb = XLSX.read(new Uint8Array(fs.readFileSync(file)), {
      type: "buffer",
    });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return [];
    rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
    });
  } catch {
    return [];
  }

  // Year header: the row with the most 4-digit-year cells (handles a trailing
  // space like "2021 ").
  let yearCols: { col: number; year: number }[] = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const found: { col: number; year: number }[] = [];
    r.forEach((c, col) => {
      const s = String(c ?? "").trim();
      if (/^(19|20)\d{2}$/.test(s)) found.push({ col, year: Number(s) });
    });
    if (found.length > yearCols.length) yearCols = found;
  }
  if (yearCols.length === 0) return [];

  // Match the absolute (млн лв) balance row, explicitly excluding any "% от БВП"
  // variant — МФ workbooks list the absolute row first today, but a future
  // layout could add a percentage row that must not masquerade as the balance.
  const balanceRow = rows.find(
    (r) =>
      Array.isArray(r) &&
      /^бюджетно салдо/i.test(String(r[0] ?? "")) &&
      !/%\s*от\s*бвп/i.test(String(r[0] ?? "")),
  );
  if (!balanceRow) return [];

  const out: CashBalancePoint[] = [];
  for (const { col, year } of yearCols) {
    const bgnMillion = parseNum(balanceRow[col]);
    if (bgnMillion == null) continue;
    // Sanity bound: the млн-лв balance is in the hundreds-to-thousands; a stray
    // percentage row (|value| < ~10) would slip through otherwise.
    if (Math.abs(bgnMillion) >= 100_000) continue;
    const value = bgnMillionToEurMillion(bgnMillion);
    if (value == null) continue;
    out.push({ year, value, source: "minfin-annual" });
  }
  return out;
};

// All *.xls in the drop dir are treated as МФ consolidated annual workbooks.
// Later files win on overlapping years, so a newer range (e.g. 2015-2025)
// supersedes an older one (2014-2024).
const loadFromAnnualWorkbooks = (): CashBalancePoint[] => {
  if (!fs.existsSync(DROP_DIR)) return [];
  const out = new Map<number, CashBalancePoint>();
  const files = fs
    .readdirSync(DROP_DIR)
    .filter((f) => /\.xls$/i.test(f))
    .sort(); // deterministic; later filename wins
  for (const f of files) {
    for (const p of parseAnnualWorkbook(path.join(DROP_DIR, f))) {
      out.set(p.year, p);
    }
  }
  return [...out.values()];
};

const loadManual = (): ManualEntry[] => {
  if (!fs.existsSync(MANUAL_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(MANUAL_FILE, "utf8")) as {
      annual?: ManualEntry[];
    };
    return raw.annual ?? [];
  } catch (err) {
    console.warn(`Could not parse ${MANUAL_FILE}:`, err);
    return [];
  }
};

const manualToEurMillion = (e: ManualEntry): number | null => {
  if (e.eurMillion != null && Number.isFinite(e.eurMillion))
    return round1(e.eurMillion);
  if (e.bgnMillion != null && Number.isFinite(e.bgnMillion))
    return bgnMillionToEurMillion(e.bgnMillion);
  return null;
};

export const buildCashBalance = (): CashBalancePoint[] => {
  const byYear = new Map<number, CashBalancePoint>();
  for (const p of loadFromAnnualWorkbooks()) byYear.set(p.year, p);
  for (const e of loadManual()) {
    if (byYear.has(e.year) && !e.override) continue; // workbook wins unless told otherwise
    const value = manualToEurMillion(e);
    if (value == null) continue;
    byYear.set(e.year, { year: e.year, value, source: "manual", note: e.note });
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
};

// Exported so fetch_eurostat.ts can reuse the exact same attribution when it
// re-bakes the series during a routine macro refresh — the two can't drift.
export const CASH_META = {
  titleEn: "Cash budget balance (КФП)",
  titleBg: "Касов бюджетен баланс (КФП)",
  unitLabelEn: "EUR million (full-year consolidated cash balance)",
  unitLabelBg: "млн. евро (годишен касов баланс по КФП)",
  cadence: "annual" as const,
  source: "curated" as const,
  sourceUrl: "https://www.minfin.bg/bg/statistics/13",
  attributionEn:
    "Ministry of Finance — Консолидирана фискална програма (cash basis), annual workbook, row „Бюджетно салдо (Дефицит(-) / Излишък(+))“",
  attributionBg:
    "Министерство на финансите — Консолидирана фискална програма (касова основа), годишен файл, ред „Бюджетно салдо (Дефицит(-) / Излишък(+))“",
};

const patchMacroJson = (points: CashBalancePoint[]): boolean => {
  if (!fs.existsSync(MACRO_FILE)) {
    console.warn(`macro.json not found at ${MACRO_FILE}; skipping patch.`);
    return false;
  }
  const macro = JSON.parse(fs.readFileSync(MACRO_FILE, "utf8")) as {
    indicators: Record<string, unknown>;
    series: Record<string, unknown>;
  };
  macro.indicators.cashBalance = CASH_META;
  macro.series.cashBalance = points
    .filter((p) => p.value != null)
    .map((p) => ({ year: p.year, value: p.value }));
  fs.writeFileSync(MACRO_FILE, JSON.stringify(macro));
  return true;
};

const runCli = () => {
  const points = buildCashBalance();
  if (points.length === 0) {
    console.warn(
      `No cash-balance data. Drop the МФ consolidated annual workbook ` +
        `(e.g. Cons_2014-2024_BG.xls) into ${DROP_DIR} (see README) and re-run.`,
    );
  }
  fs.writeFileSync(
    OUT_CACHE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source:
          "МФ Консолидирана фискална програма (годишни), row „Бюджетно салдо“ — minfin.bg/bg/statistics/13, manually downloaded (Cloudflare blocks automation) and parsed by scripts/macro/fetch_cash_balance.ts; pre-2014 / current-year gaps via data/_cache/minfin_kfp/cash-manual.json",
        unitNote: "value = EUR million, full-year consolidated cash balance",
        annual: points,
      },
      null,
      2,
    ) + "\n",
  );
  const patched = patchMacroJson(points);
  console.log(`\nWrote ${OUT_CACHE}: ${points.length} year(s).`);
  for (const p of points) {
    console.log(
      `  ${p.year}: ${p.value == null ? "—" : `€${p.value}M`} (${p.source})`,
    );
  }
  console.log(
    `\nPatched macro.json series.cashBalance${patched ? "" : " (skipped)"}.`,
  );
};

const isMain =
  process.argv[1] && process.argv[1].endsWith("fetch_cash_balance.ts");
if (isMain) {
  try {
    runCli();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
