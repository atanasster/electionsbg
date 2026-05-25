// НАП annual-report runner. Fetches the PDF, parses Table 3 (VAT-by-sector)
// + Tables 8/10 (PIT by income type) + the final-tax narrative, and writes
//   data/budget/revenue_breakdown/vat/<year>.json
//   data/budget/revenue_breakdown/pit/<year>.json
//
// Usage:
//   npx tsx scripts/budget/run_nap_annual.ts             # all known years
//   npx tsx scripts/budget/run_nap_annual.ts --year 2024 # single year
//   npx tsx scripts/budget/run_nap_annual.ts --refresh   # bypass cache

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, flag, option, optional, boolean, number } from "cmd-ts";
import { NAP_ANNUAL_REPORTS, parseNapAnnualPdf } from "./nap_annual";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const VAT_OUTPUT_DIR = path.join(
  PROJECT_ROOT,
  "data/budget/revenue_breakdown/vat",
);
const PIT_OUTPUT_DIR = path.join(
  PROJECT_ROOT,
  "data/budget/revenue_breakdown/pit",
);
const CACHE_DIR = path.join(PROJECT_ROOT, "raw_data/budget");
const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget/1.0; +https://electionsbg.com)";

const cachePath = (year: number): string =>
  path.join(CACHE_DIR, `nap-annual-${year}.pdf`);

const fetchPdf = async (
  url: string,
  year: number,
  refresh: boolean,
): Promise<string> => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = cachePath(year);
  if (!refresh && fs.existsSync(cache)) return cache;
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
          `nra.bg ${year}: response is not a PDF (${bytes.length} bytes)`,
        );
      }
      fs.writeFileSync(cache, bytes);
      return cache;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw new Error("unreachable");
};

const cmd = command({
  name: "run_nap_annual",
  args: {
    year: option({
      type: optional(number),
      long: "year",
      description: "Single fiscal year",
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
      : Object.keys(NAP_ANNUAL_REPORTS)
          .map((y) => parseInt(y, 10))
          .sort((a, b) => a - b);

    fs.mkdirSync(VAT_OUTPUT_DIR, { recursive: true });
    fs.mkdirSync(PIT_OUTPUT_DIR, { recursive: true });

    for (const fy of years) {
      const url = NAP_ANNUAL_REPORTS[fy];
      if (!url) {
        console.warn(`  ${fy}: no URL in NAP_ANNUAL_REPORTS`);
        continue;
      }
      console.log(`  ${fy}: fetching ${url}`);
      const pdfPath = await fetchPdf(url, fy, refresh === true);
      console.log(`  ${fy}: parsing ${path.relative(PROJECT_ROOT, pdfPath)}`);
      const { vat, pit } = parseNapAnnualPdf(pdfPath, fy, { url });
      const vatOut = path.join(VAT_OUTPUT_DIR, `${fy}.json`);
      const pitOut = path.join(PIT_OUTPUT_DIR, `${fy}.json`);
      fs.writeFileSync(vatOut, JSON.stringify(vat, null, 2) + "\n");
      fs.writeFileSync(pitOut, JSON.stringify(pit, null, 2) + "\n");

      const vatMatched = vat.sectors.filter(
        (s) => s.declaredNet != null,
      ).length;
      const pitMatched = pit.lines.filter((l) => l.amount != null).length;
      console.log(
        `  ${fy}: VAT ${vatMatched}/${vat.sectors.length} sectors, ` +
          `PIT ${pitMatched}/${pit.lines.length} lines → ${path.relative(PROJECT_ROOT, vatOut)}, ${path.relative(PROJECT_ROOT, pitOut)}`,
      );
    }
  },
});

run(cmd, process.argv.slice(2));
