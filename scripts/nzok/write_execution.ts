// Fetch + parse НЗОК's latest monthly B1 cash-execution report (fund 5600) and
// write data/budget/nzok/execution.json — a tiny file (revenue + expenditure YTD
// as of the report month) that the budget-bridge tile pairs with the annual
// budget-law plan to show "spent €X of €Y (Z%) by month M".
//
// Usage:
//   tsx scripts/nzok/write_execution.ts            # latest month on the page
//
// Source: nhif.bg/bg/nzok/financial_report/quarter → B1_{YYYY}_{MM}_5600.xls
// (the "_33" sibling is a sub-account; we take the plain 5600). The B1 is the
// standard ЕБК cash-execution template (Sheet1). From 2026 the figures are in
// EUR ("В ЕВРО" in the sheet); earlier years are BGN → converted. The monthly
// file carries only actuals (the annual plan column is blank), so the plan comes
// from the budget law (data/budget/nzok/budget.json).

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

/** Latest B1_{YYYY}_{MM}_5600.xls (not the _33 sub-account) — the page lists
 *  newest-first, so the first match wins. */
const findLatestB1 = (
  html: string,
): { href: string; year: number; month: number } | null => {
  const re = /href="(\/upload\/[^"]*B1_(\d{4})_(\d{2})_5600\.xls)"/gi;
  for (const m of html.matchAll(re)) {
    return { href: m[1], year: Number(m[2]), month: Number(m[3]) };
  }
  return null;
};

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : NaN;

const main = async (): Promise<void> => {
  const page = await fetchText(`${BASE}/bg/nzok/financial_report/quarter`);
  const latest = findLatestB1(page);
  if (!latest)
    throw new Error("no B1_*_5600.xls link on financial_report/quarter");

  const cachePath = path.join(
    RAW_DIR,
    `${latest.year}_${String(latest.month).padStart(2, "0")}_5600.xls`,
  );
  await fetchToFile(BASE + latest.href, cachePath);

  const wb = xlsx.read(fs.readFileSync(cachePath), {
    codepage: 1251,
    type: "buffer",
  });
  const rows = xlsx.utils.sheet_to_json(wb.Sheets["Sheet1"], {
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
    throw new Error("could not find 'Б. ОБЩО РАЗХОДИ' total in the B1");

  const asOf = `${latest.year}-${String(latest.month).padStart(2, "0")}`;
  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Национална здравноосигурителна каса (НЗОК)",
      url: `${BASE}/bg/nzok/financial_report/quarter`,
      description:
        "Месечен отчет за касовото изпълнение на бюджета на НЗОК (форма B1, ЕБК). Кумулативно от началото на годината.",
    },
    year: latest.year,
    month: latest.month,
    asOf,
    currencyOfRecord: currency,
    revenueEur: revenue,
    expenditureEur: expenditure,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  console.log(
    `Wrote ${OUT_FILE}\n  ${asOf}: expenditure €${expenditure.toLocaleString("en")} · revenue €${(revenue ?? 0).toLocaleString("en")}`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
