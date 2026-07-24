/**
 * Fetch БНБ monthly foreign-direct-investment flows (balance of payments,
 * BPM6) and write data/macro_fdi.json.
 *
 * Source: БНБ statistical database, "Поток на преките чуждестранни инвестиции
 * по вид инвестиция - месечни данни" (monthly FDI flow by investment type).
 * The download endpoint returns an Excel-2003 SpreadsheetML (.xls that is
 * actually XML) with periods as columns (2010-01 …) and one row per series.
 * SheetJS reads that format natively.
 *
 * This is the canonical monthly FDI release the press picks up — e.g. the
 * SegaBG "евро привлякло 7 пъти повече инвестиции" story is the cumulative
 * Jan–Apr 2026 line plus the reinvested-earnings component. The annual
 * Eurostat `fdiInward` in macro.json stops at the prior full year; this fills
 * the recent-month gap and adds the equity / reinvested-earnings / debt split
 * the annual series doesn't carry.
 *
 * Usage:
 *   tsx scripts/macro/fetch_bnb_fdi.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { Agent, fetch as undiciFetch } from "undici";

// bnb.bg serves an incomplete certificate chain — Node's bundled CA list
// rejects it while curl/browsers accept it. Same permissive dispatcher the
// watcher's `insecureTls` uses; read-only public download.
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_FILE = path.resolve(__dirname, "../../data/macro_fdi.json");

// БНБ statistical-database export of the monthly FDI-by-investment-type table.
// pageId=544 + the five series ids are stable identifiers on bnb.bg; the
// FILTERSANDVALUES segment narrows to net flows (NI), transactions (T), whole
// world (W1), EUR, total activity (FDI_T), monthly (FREQ=M). `download=true`
// + TRANSFORMATION=SDMX_TABLE returns the SpreadsheetML file. If БНБ ever
// renumbers these, the parse below yields zero rows and the guard throws.
const SOURCE_PAGE =
  "https://www.bnb.bg/Statistics/StExternalSector/StDirectInvestments/StDIBulgaria/index.htm";
const DOWNLOAD_URL =
  `${SOURCE_PAGE}?FILTERSANDVALUES=FREQ=M;ACCOUNTING_ENTRY=NI;FLOW_STOCK_ENTRY=T;COUNTERPART_AREA=W1;UNIT_MEASURE=EUR;ACTIVITY_N=FDI_T` +
  `&download=true&pageId=544&series=670,1285,672,674,671&KEYFAMILY=FDI_BPM6&TRANSFORMATION=SDMX_TABLE`;

type ComponentKey = "total" | "equity" | "reinvested" | "debt";

// The instrument segment of the SDMX series code (…M.NI.T.<instr>.W1.EUR…)
// identifies each row regardless of column order in the response.
//  F   — total net FDI (= equity + reinvested + debt)
//  F5A — equity excluding reinvested earnings (the press "Equity" line)
//  F5B — reinvestment of earnings
//  FL  — debt instruments
// F5 (equity incl. reinvested = F5A + F5B) is also returned but we decompose
// into F5A/F5B to match the press-release breakdown, so F5 is ignored.
const INSTR_TO_KEY: Record<string, ComponentKey> = {
  F: "total",
  F5A: "equity",
  F5B: "reinvested",
  FL: "debt",
};

const LABELS: Record<ComponentKey, { bg: string; en: string }> = {
  total: { bg: "Общо ПЧИ (нетен поток)", en: "Total FDI (net flow)" },
  equity: { bg: "Дялов капитал", en: "Equity" },
  reinvested: { bg: "Реинвестирана печалба", en: "Reinvestment of earnings" },
  debt: { bg: "Дългови инструменти", en: "Debt instruments" },
};

const MONTHS_BG = [
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
];
const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type FdiPoint = { period: string; value: number };
type YtdSide = {
  year: number;
  total: number;
  equity: number;
  reinvested: number;
  debt: number;
};

type LatestMonth = {
  period: string; // "YYYY-MM"
  total: number;
  equity: number;
  reinvested: number;
  debt: number;
  priorYearTotal: number | null; // same month one year earlier (the press's monthly callout)
};

type Payload = {
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  unit: "EUR million";
  frequency: "monthly";
  latestPeriod: string;
  labels: Record<ComponentKey, { bg: string; en: string }>;
  series: Record<ComponentKey, FdiPoint[]>;
  latest: LatestMonth;
  ytd: {
    month: number; // 1..12 — the latest reported month
    rangeBg: string; // e.g. "януари – април"
    rangeEn: string; // e.g. "January – April"
    current: YtdSide;
    prior: YtdSide;
    totalRatio: number | null; // current.total / prior.total (null if prior ≤ 0)
    reinvestedGrowthPct: number | null; // (cur − prior) / prior · 100
  };
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

// Extract the instrument segment from "FDI_BPM6.M.NI.T.F5B.W1.EUR.FDI_T".
const instrFromCode = (code: string): string | null => {
  const parts = code.split(".");
  return parts.length >= 5 ? parts[4] : null;
};

const fetchSheet = async (): Promise<unknown[][]> => {
  const res = await undiciFetch(DOWNLOAD_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; electionsbg-watch/1.0; +https://electionsbg.com)",
      "Accept-Language": "bg,en;q=0.7",
    },
    dispatcher: insecureAgent,
  });
  if (!res.ok) throw new Error(`БНБ FDI download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    blankrows: false,
    defval: null,
  });
};

const parse = (rows: unknown[][]) => {
  // The header row carries the period labels from column 2 onward.
  const headerRow = rows.find((r) => r[0] === "Наименование на серия");
  if (!headerRow) throw new Error("БНБ FDI: period header row not found");
  const periods = headerRow
    .slice(2)
    .map((p) => (typeof p === "string" ? p : null));

  const series = {
    total: [] as FdiPoint[],
    equity: [] as FdiPoint[],
    reinvested: [] as FdiPoint[],
    debt: [] as FdiPoint[],
  };

  for (const row of rows) {
    const code = row[1];
    if (typeof code !== "string" || !code.startsWith("FDI_BPM6.M")) continue;
    const instr = instrFromCode(code);
    const key = instr ? INSTR_TO_KEY[instr] : undefined;
    if (!key) continue; // skip F5 and anything unexpected
    const vals = row.slice(2);
    for (let i = 0; i < periods.length; i++) {
      const period = periods[i];
      const raw = vals[i];
      if (!period || raw == null || raw === "") continue;
      const value = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(value)) continue;
      series[key].push({ period, value: round1(value) });
    }
  }
  return series;
};

const ytdSum = (
  points: FdiPoint[],
  year: number,
  uptoMonth: number,
): number => {
  let sum = 0;
  for (let m = 1; m <= uptoMonth; m++) {
    const period = `${year}-${String(m).padStart(2, "0")}`;
    const hit = points.find((p) => p.period === period);
    if (hit) sum += hit.value;
  }
  return round1(sum);
};

const buildYtdSide = (
  series: Payload["series"],
  year: number,
  uptoMonth: number,
): YtdSide => ({
  year,
  total: ytdSum(series.total, year, uptoMonth),
  equity: ytdSum(series.equity, year, uptoMonth),
  reinvested: ytdSum(series.reinvested, year, uptoMonth),
  debt: ytdSum(series.debt, year, uptoMonth),
});

const main = async () => {
  const rows = await fetchSheet();
  const series = parse(rows);

  // Guard: refuse to clobber a good file with a parse that lost the data.
  if (series.total.length < 100) {
    throw new Error(
      `БНБ FDI: only ${series.total.length} monthly total points parsed — refusing to write`,
    );
  }

  const latestPeriod = series.total[series.total.length - 1].period;
  const [latestYearStr, latestMonthStr] = latestPeriod.split("-");
  const latestYear = Number(latestYearStr);
  const latestMonth = Number(latestMonthStr);

  const current = buildYtdSide(series, latestYear, latestMonth);
  const prior = buildYtdSide(series, latestYear - 1, latestMonth);

  const rangeBg =
    latestMonth === 1
      ? MONTHS_BG[0]
      : `${MONTHS_BG[0]} – ${MONTHS_BG[latestMonth - 1]}`;
  const rangeEn =
    latestMonth === 1
      ? MONTHS_EN[0]
      : `${MONTHS_EN[0]} – ${MONTHS_EN[latestMonth - 1]}`;

  const valAt = (points: FdiPoint[], period: string): number | null =>
    points.find((p) => p.period === period)?.value ?? null;
  const priorYearSameMonth = `${latestYear - 1}-${latestMonthStr}`;
  const latest: LatestMonth = {
    period: latestPeriod,
    total: valAt(series.total, latestPeriod) ?? 0,
    equity: valAt(series.equity, latestPeriod) ?? 0,
    reinvested: valAt(series.reinvested, latestPeriod) ?? 0,
    debt: valAt(series.debt, latestPeriod) ?? 0,
    priorYearTotal: valAt(series.total, priorYearSameMonth),
  };

  const payload: Payload = {
    source: "БНБ — Преки чуждестранни инвестиции в България (РПБ6/BPM6)",
    sourceUrl: SOURCE_PAGE,
    fetchedAt: new Date().toISOString(),
    unit: "EUR million",
    frequency: "monthly",
    latestPeriod,
    labels: LABELS,
    series,
    latest,
    ytd: {
      month: latestMonth,
      rangeBg,
      rangeEn,
      current,
      prior,
      totalRatio: prior.total > 0 ? round1(current.total / prior.total) : null,
      reinvestedGrowthPct:
        prior.reinvested !== 0
          ? round1(
              ((current.reinvested - prior.reinvested) / prior.reinvested) *
                100,
            )
          : null,
    },
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload));

  const ratio = payload.ytd.totalRatio;
  console.log(
    `Wrote ${OUT_FILE}\n` +
      `  ${series.total.length} monthly points · latest ${latestPeriod}\n` +
      `  YTD ${rangeEn} ${latestYear}: total €${current.total}M vs ${
        latestYear - 1
      } €${prior.total}M` +
      `${ratio != null ? ` (${ratio}×)` : ""}\n` +
      `  Reinvested earnings: €${current.reinvested}M vs €${prior.reinvested}M` +
      `${
        payload.ytd.reinvestedGrowthPct != null
          ? ` (${payload.ytd.reinvestedGrowthPct > 0 ? "+" : ""}${payload.ytd.reinvestedGrowthPct}%)`
          : ""
      }`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
