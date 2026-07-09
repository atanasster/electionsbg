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
import { fileURLToPath } from "url";
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

interface B1Point {
  year: number;
  month: number;
  asOf: string; // "YYYY-MM"
  currencyOfRecord: "BGN" | "EUR";
  revenueEur: number | null;
  expenditureEur: number | null;
}

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

  // Total cash execution lives in col 13 ("ОБЩО КАСОВ ОТЧЕТ"). Anchor on the
  // ЕБК section totals: "А. ОБЩО ПРИХОДИ …" (revenue) and "Б. ОБЩО РАЗХОДИ …"
  // (expenditure). Labels are stable across the monthly files.
  let revenue: number | null = null;
  let expenditure: number | null = null;
  for (const r of rows) {
    if (!r) continue;
    const name = String(r[1] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const actual = num(r[13]);
    if (!name || !Number.isFinite(actual)) continue;
    if (/^А\.\s*ОБЩО ПРИХОДИ/i.test(name)) revenue = asEur(actual);
    else if (/^Б\.\s*ОБЩО РАЗХОДИ/i.test(name)) expenditure = asEur(actual);
  }
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
  const latest = points[points.length - 1];

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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
