/**
 * Refresh data/landuse/index.json from the NSI LANDUSE annex PDF(s).
 *
 * Usage:
 *   npx tsx scripts/landuse/fetch.ts            # process every year in LANDUSE_REPORTS
 *   npx tsx scripts/landuse/fetch.ts --year 2024
 *   npx tsx scripts/landuse/fetch.ts --refresh  # re-download cached PDFs
 *
 * Source: NSI press-release annex "Land use distribution of the Republic
 * of Bulgaria as of 31.12.YYYY" (https://www.nsi.bg/bg/content/2536).
 * NSI computes the figures from the digital cadastral map (АГКК) in the
 * BGS2005 UTM35N projection. Granularity: 28 oblasts; the município-level
 * figures NSI mentions in the methodology are NOT publicly released.
 *
 * Output schema (see scripts/landuse/parse.ts for the per-row shape):
 *   {
 *     source: { name, nameEn, url },
 *     fetchedAt, latestYear,
 *     categories: [{key,bg,en}, ...],
 *     years: { "<year>": { publishedAt, pdfUrl, national, oblasts } }
 *   }
 *
 * Bulgarian display names come from scripts/lib/oblast_names.ts; English
 * names come straight from the parsed PDF row. Per-oblast Sofia ambiguity
 * (NSI publishes one "SOF" row for the capital; the app fans it out to
 * S23/S24/S25 МИРs) is resolved by the frontend hook — the data file
 * keeps NSI's canonical 28-code grain.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, option, optional, number, flag, boolean } from "cmd-ts";

import { OBLAST_BG } from "../lib/oblast_names";
import {
  LANDUSE_REPORTS,
  CATEGORIES,
  type LandUseReport,
  type CategoryKey,
} from "./sources";
import { parseLandUsePdf, type OblastRow } from "./parse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const RAW_DIR = path.join(ROOT, "raw_data/landuse");
const OUT_FILE = path.join(ROOT, "data/landuse/index.json");
const UA = "electionsbg.com data pipeline";

interface OutputOblast {
  nameBg: string;
  nameEn: string;
  totalKm2: number;
  byCategoryKm2: Record<CategoryKey, number>;
  byCategoryPct: Record<CategoryKey, number>;
  popDensityTotal: number;
  popDensityUrbanized: number;
  popDensityExclWater: number;
}

interface OutputYear {
  publishedAt: string;
  pdfUrl: string;
  national: OutputOblast;
  oblasts: Record<string, OutputOblast>;
}

interface OutputFile {
  source: { name: string; nameEn: string; url: string };
  fetchedAt: string;
  latestYear: number;
  categories: typeof CATEGORIES;
  years: Record<string, OutputYear>;
}

const ensureDir = (p: string) => {
  fs.mkdirSync(p, { recursive: true });
};

const localPathFor = (report: LandUseReport): string =>
  path.join(RAW_DIR, `LANDUSE_${report.year}_EN.pdf`);

const downloadPdf = async (
  report: LandUseReport,
  refresh: boolean,
): Promise<string> => {
  ensureDir(RAW_DIR);
  const file = localPathFor(report);
  if (!refresh && fs.existsSync(file)) {
    return file;
  }
  console.log(`  fetching ${report.pdfUrl}`);
  const res = await fetch(report.pdfUrl, { headers: { "User-Agent": UA } });
  if (!res.ok)
    throw new Error(
      `HTTP ${res.status} ${res.statusText} for ${report.pdfUrl}`,
    );
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100_000)
    throw new Error(
      `LANDUSE ${report.year}: downloaded payload is suspiciously small (${buf.length} bytes)`,
    );
  fs.writeFileSync(file, buf);
  return file;
};

const toOutputOblast = (row: OblastRow, nameBg: string): OutputOblast => ({
  nameBg,
  nameEn: row.name,
  totalKm2: row.totalKm2,
  byCategoryKm2: row.byCategoryKm2,
  byCategoryPct: row.byCategoryPct,
  popDensityTotal: row.popDensityTotal,
  popDensityUrbanized: row.popDensityUrbanized,
  popDensityExclWater: row.popDensityExclWater,
});

const cli = command({
  name: "landuse-fetch",
  description:
    "Parse the NSI LANDUSE annex PDF(s) and rewrite data/landuse/index.json",
  args: {
    year: option({
      type: optional(number),
      long: "year",
      description: "Process only this reference year (default: all)",
    }),
    refresh: flag({
      type: boolean,
      long: "refresh",
      description: "Re-download cached PDFs even if present",
    }),
  },
  handler: async (args) => {
    const reports = args.year
      ? LANDUSE_REPORTS.filter((r) => r.year === args.year)
      : LANDUSE_REPORTS;
    if (reports.length === 0) {
      console.error(
        `No LANDUSE report catalogued for year ${args.year ?? "(all)"} — update LANDUSE_REPORTS in scripts/landuse/sources.ts.`,
      );
      process.exit(1);
    }

    // Preserve already-ingested years that the current run isn't touching
    // (e.g. running with --year 2024 should not drop 2023).
    let existing: OutputFile | null = null;
    if (fs.existsSync(OUT_FILE)) {
      try {
        existing = JSON.parse(fs.readFileSync(OUT_FILE, "utf-8")) as OutputFile;
      } catch {
        existing = null;
      }
    }
    const years: Record<string, OutputYear> = existing?.years ?? {};

    for (const report of reports) {
      console.log(`[landuse ${report.year}]`);
      const pdfPath = await downloadPdf(report, args.refresh);
      const parsed = parseLandUsePdf(pdfPath);
      if (parsed.year !== report.year)
        throw new Error(
          `LANDUSE ${report.year}: parsed PDF reports year ${parsed.year}`,
        );

      const out: OutputYear = {
        publishedAt: report.publishedAt,
        pdfUrl: report.pdfUrl,
        national: toOutputOblast(parsed.national, "България"),
        oblasts: {},
      };
      for (const [code, row] of Object.entries(parsed.oblasts)) {
        const bgName = OBLAST_BG[code];
        if (!bgName)
          throw new Error(
            `LANDUSE ${report.year}: unknown oblast code ${code} (extend scripts/lib/oblast_names.ts)`,
          );
        out.oblasts[code] = toOutputOblast(row, bgName);
      }
      years[String(report.year)] = out;
      console.log(
        `  parsed ${Object.keys(out.oblasts).length} oblasts; national total ${out.national.totalKm2.toFixed(2)} sq.km`,
      );
    }

    const latestYear = Math.max(...Object.keys(years).map(Number));
    const payload: OutputFile = {
      source: {
        name: "НСИ — Разпределение на земята по начин на трайно ползване",
        nameEn:
          "NSI — Land use distribution of the Republic of Bulgaria (digital cadastral map)",
        url: "https://www.nsi.bg/bg/content/2536",
      },
      fetchedAt: new Date().toISOString(),
      latestYear,
      categories: CATEGORIES,
      years,
    };

    ensureDir(path.dirname(OUT_FILE));
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload) + "\n");
    const sz = fs.statSync(OUT_FILE).size;
    console.log(
      `\nWrote ${path.relative(ROOT, OUT_FILE)} (${sz} bytes; latest year ${latestYear}; ${Object.keys(years).length} year(s) tracked)`,
    );
  },
});

run(cli, process.argv.slice(2));
