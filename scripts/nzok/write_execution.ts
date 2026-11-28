// Fetch + parse НЗОК's monthly B1 cash-execution reports (fund 5600) and write
// two files:
//   data/budget/nzok/execution.json          — the latest month (revenue +
//     expenditure YTD) that the budget-bridge tile pairs with the annual
//     budget-law plan to show "spent €X of €Y (Z%) by month M".
//   data/budget/nzok/execution_history.json  — every month the page lists
//     (2022→), so the tile can draw the cumulative plan-vs-actual pace curve —
//     the time dimension no НЗОК report or the single-year competitor shows.
//
// Usage:
//   tsx scripts/nzok/write_execution.ts            # latest + full history
//
// Source: nhif.bg/bg/nzok/financial_report/quarter → B1_{YYYY}_{MM}_5600.xls
// (the "_33" sibling is a sub-account; we take the plain 5600). The B1 is the
// standard ЕБК cash-execution template (Sheet1). From 2026 the figures are in
// EUR ("В ЕВРО" in the sheet); earlier years are BGN → converted. Each monthly
// file is cumulative YTD (resets every January), and carries only actuals (the
// annual plan column is blank), so the plan comes from the budget law
// (data/budget/nzok/budget.json).

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import * as xlsx from "xlsx";
import { toEur } from "../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.resolve(__dirname, "../../raw_data/nzok/b1");
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/execution.json",
);
const HISTORY_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/execution_history.json",
);
// Committed sidecar of hand-verified full-year (December) points for years the
// /quarter page lists only through November (2022-2024). Merged into the history
// below; a real December xls on /quarter supersedes it (the scrape wins per
// (year, month)). Produced by write_execution_annual.ts.
const ANNUAL_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/execution_annual.json",
);
const BASE = "https://www.nhif.bg";
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

interface B1Link {
  href: string;
  year: number;
  month: number;
}

/** Every B1_{YYYY}_{MM}_5600.xls (not the _33 sub-account) on the page, newest-
 *  first. The page occasionally re-issues a corrected month as a new /upload id
 *  while the old one lingers — dedup to one link per (year,month), newest wins. */
const findAllB1 = (html: string): B1Link[] => {
  const re = /href="(\/upload\/[^"]*B1_(\d{4})_(\d{2})_5600\.xls)"/gi;
  const seen = new Set<string>();
  const out: B1Link[] = [];
  for (const m of html.matchAll(re)) {
    const year = Number(m[2]);
    const month = Number(m[3]);
    const key = `${year}-${month}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href: m[1], year, month });
  }
  return out;
};

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : NaN;

// ⚠ revenueEur IS NOT THE FUND'S INCOME, and reading it as such invents a
// deficit. Section А of the ЕБК form is OWN revenue —
// contributions and the like. The state-budget transfer that funds most of НЗОК
// is in section В („ОБЩО ТРАНСФЕРИ И ЗАЕМИ М/У БЮДЖЕТНИ ОРГАНИЗАЦИИ"), net of
// what the fund passes on. Measured on the 2025 annual: А − Б alone reads as a
// ~€1.8bn hole, while the form's own balance (section Г) is −52.2M лв, ≈ −€26.7M.
// So the series carries В and Г beside А and Б, and a balance is only ever
// rendered from balanceEur — never derived as revenue − expenditure.
export interface B1Point {
  year: number;
  month: number;
  asOf: string; // "YYYY-MM"
  currencyOfRecord: "BGN" | "EUR";
  revenueEur: number | null;
  expenditureEur: number | null;
  /** Section В, net transfers between budget organisations. Absent on a point
   *  written before this field existed (the annual sidecar), never 0 for it. */
  transfersEur?: number | null;
  /** Section Г, the form's own budget balance (surplus +, deficit −). */
  balanceEur?: number | null;
}

/** ЕБК section totals from one B1 sheet's rows (col 1 = label, col 13 = the
 *  „ОБЩО КАСОВ ОТЧЕТ" total). Values are in the sheet's currency. Exported for
 *  the unit test — the label anchors are the whole parser. */
export const b1SectionTotals = (
  rows: unknown[][],
): {
  revenue: number | null;
  expenditure: number | null;
  transfers: number | null;
  balance: number | null;
} => {
  let revenue: number | null = null;
  let expenditure: number | null = null;
  let transfers: number | null = null;
  let balance: number | null = null;
  for (const r of rows) {
    if (!r) continue;
    const name = String(r[1] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const actual = num(r[13]);
    if (!name || !Number.isFinite(actual)) continue;
    // First match wins for each: the section total precedes any sub-row that
    // repeats its wording.
    if (revenue == null && /^А\.\s*ОБЩО ПРИХОДИ/i.test(name)) revenue = actual;
    else if (expenditure == null && /^Б\.\s*ОБЩО РАЗХОДИ/i.test(name))
      expenditure = actual;
    else if (transfers == null && /^В\.\s*ОБЩО ТРАНСФЕРИ/i.test(name))
      transfers = actual;
    else if (balance == null && /^Г\.\s*БЮДЖЕТНО САЛДО/i.test(name))
      balance = actual;
  }
  return { revenue, expenditure, transfers, balance };
};

/** The form's own identity: А − Б + В = Г. It holds to the unit on all 38
 *  cached months (2022-04 → 2026-08), so a miss means an anchor matched the
 *  wrong row — refuse rather than publish a balance that is not the form's.
 *  A section that is absent skips the check (nothing to contradict). */
export const assertB1Identity = (
  t: ReturnType<typeof b1SectionTotals>,
  label: string,
): void => {
  if (
    t.revenue != null &&
    t.expenditure != null &&
    t.transfers != null &&
    t.balance != null &&
    Math.abs(t.revenue - t.expenditure + t.transfers - t.balance) > 1
  )
    throw new Error(
      `B1 ${label}: А − Б + В ≠ Г — a section anchor matched the wrong row`,
    );
};

/** Parse one cached B1 xls into its ЕБК revenue/expenditure YTD totals. */
const parseB1 = (cachePath: string, year: number, month: number): B1Point => {
  const wb = xlsx.read(fs.readFileSync(cachePath), {
    codepage: 1251,
    type: "buffer",
  });
  const sheet = wb.Sheets["Sheet1"];
  if (!sheet)
    throw new Error(
      `B1 sheet "Sheet1" not found in ${cachePath} (sheets: ${wb.SheetNames.join(", ")}) — layout may have changed`,
    );
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  }) as unknown[][];

  const sheetText = rows
    .flat()
    .map((c) => String(c ?? ""))
    .join(" ");
  const currency: "BGN" | "EUR" = /в\s*евро/i.test(sheetText) ? "EUR" : "BGN";
  const asEur = (v: number): number =>
    currency === "EUR" ? Math.round(v) : Math.round(toEur(v, "BGN") ?? 0);

  // Total cash execution lives in col 13 ("ОБЩО КАСОВ ОТЧЕТ"), anchored on the
  // ЕБК section totals — see b1SectionTotals. Labels are stable across files.
  const t = b1SectionTotals(rows);
  assertB1Identity(t, `${year}-${month}`);
  const conv = (v: number | null): number | null =>
    v == null ? null : asEur(v);
  const revenue = conv(t.revenue);
  const expenditure = conv(t.expenditure);
  if (expenditure == null)
    throw new Error(
      `could not find 'Б. ОБЩО РАЗХОДИ' total in the B1 for ${year}-${month}`,
    );

  return {
    year,
    month,
    asOf: `${year}-${String(month).padStart(2, "0")}`,
    currencyOfRecord: currency,
    revenueEur: revenue,
    expenditureEur: expenditure,
    transfersEur: conv(t.transfers),
    balanceEur: conv(t.balance),
  };
};

const main = async (): Promise<void> => {
  const page = await fetchText(`${BASE}/bg/nzok/financial_report/quarter`);
  const links = findAllB1(page);
  if (links.length === 0)
    throw new Error("no B1_*_5600.xls link on financial_report/quarter");

  // Parse every listed month. A single unparseable month must not abort the
  // whole run (older-era layout drift) — skip it and keep the series; but a
  // transport error already threw in fetchToFile.
  const points: B1Point[] = [];
  const skipped: string[] = [];
  for (const l of links) {
    const cachePath = path.join(
      RAW_DIR,
      `${l.year}_${String(l.month).padStart(2, "0")}_5600.xls`,
    );
    await fetchToFile(BASE + l.href, cachePath);
    try {
      points.push(parseB1(cachePath, l.year, l.month));
    } catch (e) {
      skipped.push(
        `${l.year}-${l.month}: ${(e as Error).message.slice(0, 60)}`,
      );
    }
  }
  if (points.length === 0) throw new Error("no B1 month parsed");
  points.sort((a, b) => (a.asOf < b.asOf ? -1 : 1));
  // `latest` (for execution.json + history.latest) is the newest SCRAPED month —
  // never a backfilled December — so compute it before merging the sidecar.
  const latest = points[points.length - 1];

  // Merge the hand-verified full-year backfill for years /quarter lists only
  // through November. The scrape WINS: only add a sidecar (year, month) the
  // scrape doesn't already have, so a real December xls automatically supersedes.
  if (fs.existsSync(ANNUAL_FILE)) {
    const annual = JSON.parse(fs.readFileSync(ANNUAL_FILE, "utf-8")) as {
      points: B1Point[];
    };
    const have = new Set(points.map((p) => `${p.year}-${p.month}`));
    let added = 0;
    for (const p of annual.points ?? []) {
      if (have.has(`${p.year}-${p.month}`)) continue;
      points.push(p);
      added++;
    }
    if (added) points.sort((a, b) => (a.asOf < b.asOf ? -1 : 1));
    console.log(
      `Merged ${added} full-year backfill point(s) from execution_annual.json`,
    );
  }

  const source = {
    publisher: "Национална здравноосигурителна каса (НЗОК)",
    url: `${BASE}/bg/nzok/financial_report/quarter`,
    description:
      "Месечен отчет за касовото изпълнение на бюджета на НЗОК (форма B1, ЕБК). Кумулативно от началото на годината.",
  };

  const out = {
    generatedAt: new Date().toISOString(),
    source,
    year: latest.year,
    month: latest.month,
    asOf: latest.asOf,
    currencyOfRecord: latest.currencyOfRecord,
    revenueEur: latest.revenueEur,
    expenditureEur: latest.expenditureEur,
    transfersEur: latest.transfersEur ?? null,
    balanceEur: latest.balanceEur ?? null,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  const history = {
    generatedAt: new Date().toISOString(),
    source,
    latest: { year: latest.year, month: latest.month, asOf: latest.asOf },
    points,
  };
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

  console.log(
    `Wrote ${OUT_FILE}\n  ${latest.asOf}: expenditure €${(latest.expenditureEur ?? 0).toLocaleString("en")} · revenue €${(latest.revenueEur ?? 0).toLocaleString("en")}`,
  );
  console.log(
    `Wrote ${HISTORY_FILE}\n  ${points.length} months (${points[0].asOf} → ${latest.asOf})` +
      (skipped.length
        ? `\n  skipped ${skipped.length}: ${skipped.join("; ")}`
        : ""),
  );
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
