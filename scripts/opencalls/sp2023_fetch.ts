// Download the ДФЗ / Стратегически план indicative intake schedule and write its snapshot.
//
//   npm run opencalls:sp2023            # fetch + write data/opencalls/sp2023.json
//   npm run opencalls:sp2023 -- --dry   # fetch, report, write nothing
//
// THE URL IS NEVER HARDCODED. The file is „Актуализиран_ИГГ_2026.xlsx": the name carries a year
// AND the word „updated", so it changes at least annually and again whenever the schedule is
// revised. Hardcoding it means the ingest quietly keeps re-reading last year's plan. Instead the
// schedule page is scraped for .xlsx links and the HIGHEST YEAR wins, with every candidate
// logged — so when 2027 appears the switch is visible rather than silent.
//
// Two requests total (page + file), so there is no politeness budget to speak of; sp2023.bg's
// robots.txt disallows only Joomla's admin directories.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as cheerio from "cheerio";
import * as XLSX from "xlsx";
import { parseSp2023 } from "./sp2023_parse";
import { writeSnapshot } from "./write_snapshot";

/** The schedule page. EXPORTED so the watcher (scripts/watch/sources/sp2023_indicative.ts) probes
 *  the same URL this fetcher downloads from — two copies of a CMS path is how a watcher ends up
 *  reporting „unchanged" about a page nothing reads any more. */
export const SP2023_PAGE =
  "https://www.sp2023.bg/index.php/bg/proceduri/indikativen-grafik";
const PAGE = SP2023_PAGE;
const ORIGIN = "https://www.sp2023.bg";
const UA = "electionsbg-opencalls/1.0 (+https://electionsbg.com)";
const TIMEOUT_MS = 90_000;
const RAW_DIR = "raw_data/opencalls/sp2023";

export interface XlsxCandidate {
  url: string;
  /** From the filename, e.g. „…ИГГ_2026.xlsx" → 2026. Null when none can be read. */
  year: number | null;
}

/** Every .xlsx link on the schedule page, with the year read out of its (URL-decoded) name. */
export const findXlsxCandidates = (html: string): XlsxCandidate[] => {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: XlsxCandidate[] = [];
  $('a[href$=".xlsx"], a[href$=".XLSX"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `${ORIGIN}${href}`;
    if (seen.has(url)) return;
    seen.add(url);
    // Read the year from the FILENAME ONLY, never the whole URL. The host is `sp2023.bg`, so
    // matching against the URL gives every relative link a phantom year of 2023 — which on a
    // page of genuinely undated files would make them all tie, and would mask the "no year
    // anywhere" case this parser is supposed to refuse.
    const last = url.split("/").pop() ?? url;
    let name = last;
    try {
      name = decodeURIComponent(last);
    } catch {
      /* a malformed escape must not lose the candidate */
    }
    const years = [...name.matchAll(/(20\d{2})/gu)].map((m) => Number(m[1]));
    out.push({ url, year: years.length ? Math.max(...years) : null });
  });
  return out;
};

/** Pick the schedule to ingest. Throws rather than guessing. */
export const pickCandidate = (cands: XlsxCandidate[]): XlsxCandidate => {
  if (cands.length === 0)
    throw new Error(
      `no .xlsx link found on ${PAGE} — the page changed; refusing to fall back to a hardcoded URL`,
    );
  const dated = cands.filter((c) => c.year !== null);
  if (dated.length === 0)
    throw new Error(
      `found ${cands.length} .xlsx link(s) but no year in any filename; cannot tell which schedule is current:\n  ${cands
        .map((c) => c.url)
        .join("\n  ")}`,
    );
  return dated.reduce((a, b) => ((b.year ?? 0) > (a.year ?? 0) ? b : a));
};

const fetchBuf = async (url: string, accept: string): Promise<Buffer> => {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

const gridOf = (ws: XLSX.WorkSheet): unknown[][] =>
  XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    // blankrows:false drops spacer rows; defval:null keeps every column present so indices
    // stay aligned even when a cell is empty or part of a merged range.
    blankrows: false,
    defval: null,
  });

const hasHeader = (grid: unknown[][]): boolean =>
  grid.some((r) =>
    (r ?? []).some((c) =>
      String(c ?? "")
        .replace(/\s+/gu, " ")
        .trim()
        .toUpperCase()
        .startsWith("ИНТЕРВЕНЦИЯ"),
    ),
  );

/** The schedule sheet as a value matrix.
 *
 *  Picks the sheet that CONTAINS THE HEADER rather than sheet 0 unconditionally. The 2026 file
 *  happens to carry one sheet („ЕЗФРСР"), but the workbook is hand-maintained: a cover sheet or
 *  a second fund's tab added in front would otherwise make the parser throw "layout changed"
 *  while the real table sat one tab over. */
export const sheetToGrid = (buf: Buffer): unknown[][] => {
  const wb = XLSX.read(buf, { type: "buffer" });
  if (wb.SheetNames.length === 0) throw new Error("workbook has no sheets");
  for (const name of wb.SheetNames) {
    const grid = gridOf(wb.Sheets[name]);
    if (hasHeader(grid)) return grid;
  }
  throw new Error(
    `no sheet carries an ИНТЕРВЕНЦИЯ header (sheets: ${wb.SheetNames.join(", ")})`,
  );
};

const main = async (): Promise<void> => {
  const dry = process.argv.includes("--dry");

  const page = await fetchBuf(PAGE, "text/html");
  const cands = findXlsxCandidates(page.toString("utf-8"));
  for (const c of cands)
    console.log(`  candidate: ${c.year ?? "?"} ${decodeURIComponent(c.url)}`);
  const chosen = pickCandidate(cands);
  console.log(`chose ${chosen.year}: ${decodeURIComponent(chosen.url)}`);

  const xlsx = await fetchBuf(
    chosen.url,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  try {
    mkdirSync(RAW_DIR, { recursive: true });
    writeFileSync(path.join(RAW_DIR, `igg_${chosen.year}.xlsx`), xlsx);
  } catch {
    /* the cache is a debugging aid, never fatal */
  }

  const rows = parseSp2023(sheetToGrid(xlsx), chosen.year ?? 0);
  console.log(`parsed ${rows.length} intervention(s)`);

  // Print every declined figure. These are EXPECTED — most cells are prose — but a sudden jump
  // in the count is how a layout change announces itself.
  const skipped = rows.flatMap((r) => r.skipped);
  console.log(`figures declined: ${skipped.length}`);
  for (const s of skipped) console.log(`  - ${s}`);

  const calls = rows.map((r) => r.call);
  const withBudget = calls.filter((c) => c.budgetEur !== null).length;
  const withRate = calls.filter((c) => c.aidRatePct !== null).length;
  const withCeiling = calls.filter((c) => c.grantMaxEur !== null).length;
  console.log(
    `money: budget ${withBudget}/${calls.length} · rate ${withRate} · ceiling ${withCeiling}`,
  );

  if (dry) {
    console.log("--dry: nothing written");
    return;
  }
  console.log(`wrote ${writeSnapshot("sp2023", calls)}`);
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
