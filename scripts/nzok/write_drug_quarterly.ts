// Per-INN QUARTERLY drug-reimbursement series — the multi-period drug trend the
// single-year competitor (Диагноза България) structurally cannot show. The annual
// writer (write_drug_reimbursement.ts) already ships a YoY-movers slice; this adds
// the full quarterly trajectory per molecule (2021→), so a reader can watch a
// therapy's НЗОК spend climb or fall quarter by quarter.
//
// Source: the SAME nhif.bg/bg/medicine_food/quarter-payments/{year} pages, but the
// QUARTERLY files ("… за N-то тримесечие … (Qn YYYY)"). Verified per-quarter, NOT
// cumulative (Q1+Q2+Q3+Q4 ≈ the annual roll-up), same column layout as the annual
// (1=ATC, 2=INN, 9=Реимбурсна сума, BGN → EUR at 1.95583). Row grain is
// (INN × trade × pack); we aggregate to (INN × quarter).
//
// Emits flat rows for the PG loader (load_nzok_drug_quarterly_pg.ts):
//   data/budget/nzok/drug_quarterly.json { quarters[], rows:[{inn,atc,quarter,eur}] }
//
// Usage:  npx tsx scripts/nzok/write_drug_quarterly.ts            # 2021→ newest
//         npx tsx scripts/nzok/write_drug_quarterly.ts --from 2023

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as xlsx from "xlsx";
import { toEur } from "../../src/lib/currency";
import { drugReimbursementLinks } from "./lib/drug_links";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../raw_data/nzok/drug_quarterly");
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/drug_quarterly.json",
);
const BASE = "https://www.nhif.bg";
const UA = "Mozilla/5.0 (compatible; naiasno-data/1.0)";
// The current site's quarterly files are cleanly named from 2023 on (month-range
// "MM - MM YYYY" or an explicit "Qn"); 2021–2022 use irregular day-ranges and
// "_YYYYMM" stems that don't parse reliably, so we start at 2023 (a 3+-year
// trend) rather than ship a mis-dated quarter.
const FIRST_YEAR = 2023;

// Same Cyrillic-homoglyph fold as the annual writer, so an INN spelled with a
// stray Cyrillic "Р" aggregates with its Latin twin across quarters.
const CYR2LAT: Record<string, string> = {
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  У: "Y",
  Х: "X",
};
const normInn = (s: string): string =>
  s
    .trim()
    .toUpperCase()
    .replace(/[АВЕКМНОРСТУХ]/g, (c) => CYR2LAT[c] ?? c)
    .replace(/\s+/g, " ");

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

/** Extract "YYYY-Qn" from a decoded quarterly filename, else null (an annual
 *  roll-up or an unparseable name). Handles the three naming eras the site mixes:
 *  an explicit "Qn", the Bulgarian "N-то тримесечие", and a month range
 *  "MM - MM YYYY" (start month → quarter; the 2023 pattern). The year is taken
 *  independently so "…2023 (Q4)" (year before the Q token) still resolves. */
const quarterOf = (name: string): string | null => {
  const ym = name.match(/\b(20\d{2})\b/);
  if (!ym) return null;
  const year = ym[1];
  const explicit = name.match(/Q\s*([1-4])\b/i);
  if (explicit) return `${year}-Q${explicit[1]}`;
  const bg = name.match(/([1-4])\s*-?\s*[а-я]*\s*тримесеч/i);
  if (bg) return `${year}-Q${bg[1]}`;
  // Month range "MM - MM" (hyphen / en- / em-dash). Map the START month → quarter.
  const range = name.match(
    /(?:^|[^\d])(\d{1,2})\s*[-–—]\s*(\d{1,2})(?:[^\d]|$)/,
  );
  if (range) {
    const start = Number(range[1]);
    if (start >= 1 && start <= 12)
      return `${year}-Q${start <= 3 ? 1 : start <= 6 ? 2 : start <= 9 ? 3 : 4}`;
  }
  return null;
};

/** Aggregate one quarterly workbook to (INN → {eur, atc}). Cols 1=ATC, 2=INN,
 *  9=Реимбурсна сума; data from row 2 (row0 title, row1 header). `currency` is the
 *  source currency: BGN through 2025, EUR from the 2026-Q1 file (Bulgaria adopts
 *  the euro 2026-01-01, so those figures are already euros — converting again
 *  would halve every quarter). Same gate as parse_eeof.ts / parse_hospital_payments. */
const parseQuarter = (
  buf: Buffer,
  currency: "BGN" | "EUR",
): {
  byInn: Map<string, { eur: number; atc: string }>;
  totalEur: number;
  rows: number;
} => {
  const wb = xlsx.read(buf, { type: "buffer", codepage: 1251 });
  const grid = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: null,
  }) as unknown[][];
  const byInn = new Map<string, { eur: number; atc: string }>();
  let totalEur = 0;
  let rows = 0;
  for (let i = 2; i < grid.length; i++) {
    const r = grid[i];
    if (!r) continue;
    const inn = normInn(String(r[2] ?? ""));
    const atc = String(r[1] ?? "").trim();
    const native = Number(r[9]);
    if (!inn || !Number.isFinite(native) || native <= 0) continue;
    const eur = Math.round((toEur(native, currency) ?? 0) * 100) / 100;
    totalEur += eur;
    rows++;
    const e = byInn.get(inn);
    if (!e) byInn.set(inn, { eur, atc });
    else e.eur += eur;
  }
  return { byInn, totalEur, rows };
};

const main = async (): Promise<void> => {
  const fromArg = process.argv.indexOf("--from");
  const fromYear =
    fromArg >= 0 && process.argv[fromArg + 1]
      ? Number(process.argv[fromArg + 1])
      : FIRST_YEAR;

  // Discover the newest year the site lists (its 2026 nav links every year).
  const hub = await fetchText(`${BASE}/bg/medicine_food/quarter-payments/2026`);
  const years = [...hub.matchAll(/quarter-payments\/(\d{4})/g)].map((m) =>
    Number(m[1]),
  );
  const newest = years.length ? Math.max(...years) : 2026;

  // One row per (inn, quarter): the summed EUR + the ATC (last non-empty wins).
  const rowMap = new Map<
    string,
    { inn: string; atc: string; quarter: string; eur: number }
  >();
  const quarters = new Set<string>();
  let filesParsed = 0;

  for (let year = fromYear; year <= newest; year++) {
    const html = await fetchText(
      `${BASE}/bg/medicine_food/quarter-payments/${year}`,
    );
    // Quarterly files only — a quarterly name resolves to a YYYY-Qn; the annual
    // roll-up ("Брутни разходи за YYYY г") does not, so quarterOf(null) drops it.
    const links = drugReimbursementLinks(html).filter(
      (l) => quarterOf(l.name) != null,
    );
    for (const l of links) {
      const quarter = quarterOf(l.name);
      if (!quarter || !quarter.startsWith(String(year))) continue; // guard cross-year names
      const ext = l.href.toLowerCase().endsWith(".xlsx") ? "xlsx" : "xls";
      const cache = path.join(RAW_DIR, `${quarter}.${ext}`);
      if (!fs.existsSync(cache) || fs.statSync(cache).size < 10_000)
        await fetchToFile(BASE + l.href, cache);
      // Euro adoption is 2026-01-01, so the 2026 files are EUR-native.
      const currency = Number(quarter.slice(0, 4)) >= 2026 ? "EUR" : "BGN";
      const { byInn, totalEur, rows } = parseQuarter(
        fs.readFileSync(cache),
        currency,
      );
      // Plausibility gate per file: a quarter is ~€350–420M across ~2,200 INN
      // rows; a shifted layout would collect ~0. Skip (don't ship) a bad parse.
      if (rows < 300 || totalEur < 100_000_000) {
        console.warn(
          `  ! ${quarter}: implausible parse (${rows} rows, €${Math.round(totalEur)}) — skipped`,
        );
        continue;
      }
      quarters.add(quarter);
      for (const [inn, e] of byInn) {
        const key = `${inn}|${quarter}`;
        rowMap.set(key, {
          inn,
          atc: e.atc,
          quarter,
          eur: Math.round(e.eur),
        });
      }
      filesParsed++;
      console.log(
        `  ${quarter}: €${Math.round(totalEur).toLocaleString("en")} · ${byInn.size} INN`,
      );
    }
  }

  if (filesParsed < 4)
    throw new Error(`only ${filesParsed} quarterly files parsed — aborting`);

  const rows = [...rowMap.values()].sort(
    (a, b) => a.inn.localeCompare(b.inn) || a.quarter.localeCompare(b.quarter),
  );
  const qList = [...quarters].sort();

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Национална здравноосигурителна каса (НЗОК)",
      url: `${BASE}/bg/medicine_food/quarter-payments/${newest}`,
      description:
        "Брутен разход (реимбурсна сума) за лекарствени продукти по INN, ТРИМЕСЕЧНО (за тримесечие, не кумулативно). Сумите са в лева, конвертирани в евро при 1 EUR = 1.95583 BGN.",
    },
    quarterRange: {
      first: qList[0] ?? null,
      last: qList[qList.length - 1] ?? null,
      count: qList.length,
    },
    quarters: qList,
    rows,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  const distinctInn = new Set(rows.map((r) => r.inn)).size;
  console.log(
    `\nWrote ${OUT_FILE}\n  ${filesParsed} quarters (${out.quarterRange.first} → ${out.quarterRange.last}) · ${rows.length} (inn×quarter) rows · ${distinctInn} distinct INN`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
