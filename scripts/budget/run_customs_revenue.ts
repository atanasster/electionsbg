// Customs-revenue breakdown runner. Downloads the Митническа хроника PDF for
// each fiscal year in MITNICHESKA_HRONIKA_REPORTS, extracts the excise / import
// VAT / customs split, and writes data/budget/revenue_breakdown/customs/<YYYY>.json.
//
// Prototype: standalone CLI separate from the main budget ingest until the
// shape and source proves out across multiple years.
//
// Usage:
//   npx tsx scripts/budget/run_customs_revenue.ts             # all known years
//   npx tsx scripts/budget/run_customs_revenue.ts --year 2025 # single year
//   npx tsx scripts/budget/run_customs_revenue.ts --refresh   # bypass cache

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, flag, option, optional, boolean, number } from "cmd-ts";
import {
  MITNICHESKA_HRONIKA_REPORTS,
  parseCustomsHronikaPdf,
} from "./customs_revenue";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const OUTPUT_DIR = path.join(
  PROJECT_ROOT,
  "data/budget/revenue_breakdown/customs",
);
const CACHE_DIR = path.join(PROJECT_ROOT, "raw_data/budget");
const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget/1.0; +https://electionsbg.com)";

const cachePath = (year: number): string =>
  path.join(CACHE_DIR, `mitnicheska-hronika-${year}.pdf`);

const fetchPdf = async (
  url: string,
  year: number,
  refresh: boolean,
): Promise<Uint8Array> => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = cachePath(year);
  if (!refresh && fs.existsSync(cache)) {
    return new Uint8Array(fs.readFileSync(cache));
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(encodeURI(url), {
        headers: { "User-Agent": UA, Accept: "application/pdf,*/*" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (
        bytes.length < 10_000 ||
        bytes[0] !== 0x25 ||
        bytes[1] !== 0x50 ||
        bytes[2] !== 0x44 ||
        bytes[3] !== 0x46
      ) {
        throw new Error(
          `customs.bg ${year}: response is not a PDF ` +
            `(${bytes.length} bytes, starts "${Buffer.from(
              bytes.slice(0, 8),
            ).toString("latin1")}")`,
        );
      }
      fs.writeFileSync(cache, bytes);
      return bytes;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw new Error(`unreachable`);
};

const cmd = command({
  name: "run_customs_revenue",
  args: {
    year: option({
      type: optional(number),
      long: "year",
      description: "Process a single fiscal year only",
    }),
    refresh: flag({
      type: optional(boolean),
      long: "refresh",
      description: "Re-download cached PDFs",
    }),
  },
  handler: async ({ year, refresh }) => {
    const years = year
      ? [year]
      : Object.keys(MITNICHESKA_HRONIKA_REPORTS)
          .map((y) => parseInt(y, 10))
          .sort((a, b) => a - b);

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    for (const fy of years) {
      const url = MITNICHESKA_HRONIKA_REPORTS[fy];
      if (!url) {
        console.warn(`  ${fy}: no source URL in MITNICHESKA_HRONIKA_REPORTS`);
        continue;
      }
      console.log(`  ${fy}: fetching ${url}`);
      const bytes = await fetchPdf(url, fy, refresh);
      console.log(`  ${fy}: ${bytes.length} bytes — parsing`);
      const parsed = await parseCustomsHronikaPdf(bytes, fy, { url });
      const outPath = path.join(OUTPUT_DIR, `${fy}.json`);
      fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2) + "\n");
      const matched = parsed.lines.filter((l) => l.amount != null).length;
      console.log(
        `  ${fy}: matched ${matched}/${parsed.lines.length} lines, ` +
          `${parsed.customsByCountry.length} countries → ${path.relative(PROJECT_ROOT, outPath)}`,
      );
      for (const l of parsed.lines) {
        if (l.amount == null) {
          console.warn(`    [NO MATCH] ${l.id}  (${l.labelBg})`);
        }
      }
    }
  },
});

run(cmd, process.argv.slice(2));
