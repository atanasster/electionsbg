/**
 * Orchestrator: pull every indicator source, normalize, write
 * data/indicators.json.
 *
 * Currently one source (AZ unemployment). Adding a new source means:
 *   1. Implement scripts/indicators/sources/<source>.ts that returns
 *      NormalizeInput[] (and downloads/caches raw files under
 *      raw_data/indicators/<source>/).
 *   2. Append an entry to the SOURCES array below.
 *   3. Register its watcher in scripts/watch/sources/index.ts.
 *   4. Add the IndicatorId + formatter rule in
 *      src/data/indicators/useIndicators.tsx.
 *
 * Usage:
 *   npx tsx scripts/indicators/fetch.ts                # all sources
 *   npx tsx scripts/indicators/fetch.ts --force        # re-download XLSX
 *   npx tsx scripts/indicators/fetch.ts --max-years 3  # quick smoke test
 *   npx tsx scripts/indicators/fetch.ts --source az_unemployment
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, option, optional, string, flag, boolean } from "cmd-ts";

import { fetchAzUnemployment } from "./sources/az_unemployment";
import { fetchMonDzi } from "./sources/mon_dzi";
import { fetchNsiPopulation } from "./sources/nsi_population";
import { fetchNsiVital, fetchNsiMigration } from "./sources/nsi_vital";
import {
  normalize,
  type NormalizeInput,
  type NormalizeReport,
} from "./normalize";
import { buildPayload, writeMuniSlices, type IndicatorBuild } from "./build";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_FILE = path.resolve(__dirname, "../../data/indicators.json");
const OUT_SLICE_DIR = path.resolve(__dirname, "../../data/indicators");
const MUNI_FILE = path.resolve(__dirname, "../../data/municipalities.json");

// Per-indicator config. Adding a new indicator → append here.
type SourceSpec = {
  id: string;
  scrape: (opts: ScrapeOpts) => Promise<NormalizeInput[]>;
  meta: {
    labelBg: string;
    labelEn: string;
    unitBg: string;
    unitEn: string;
    cadence: "annual";
    source: { name: string; url: string };
  };
  minMunis: number; // floor — abort if fewer than this many obshtina codes covered
  minYearsPerMuni: number; // floor — abort if median muni has fewer than this many points
};

type ScrapeOpts = {
  forceDownload?: boolean;
  maxYears?: number;
  verbose?: boolean;
};

const SOURCES: SourceSpec[] = [
  {
    id: "unemployment",
    scrape: async (opts) => {
      const result = await fetchAzUnemployment(opts);
      const rows: NormalizeInput[] = [];
      for (const parsed of result.byYear.values()) {
        for (const r of parsed) {
          rows.push({
            year: r.year,
            azCode: r.azCode,
            oblastContext: r.oblastContext,
            muniName: r.muniName,
            value: r.value,
          });
        }
      }
      return rows;
    },
    meta: {
      labelBg: "Регистрирана безработица",
      labelEn: "Registered unemployment",
      unitBg: "%",
      unitEn: "%",
      cadence: "annual",
      source: {
        name: "Агенция по заетостта (годишен обзор)",
        url: "https://www.az.government.bg/stats/4/",
      },
    },
    minMunis: 260, // 265 munis - small slack for transient parse misses
    minYearsPerMuni: 2,
  },
  {
    id: "dzi",
    scrape: async (opts) => {
      const result = await fetchMonDzi(opts);
      const rows: NormalizeInput[] = [];
      for (const r of result.rows) {
        rows.push({
          year: r.year,
          // МОН doesn't ship internal codes — match by name within oblast.
          azCode: undefined,
          oblastContext: r.oblastContext,
          muniName: r.muniName,
          value: r.value,
        });
      }
      return rows;
    },
    meta: {
      labelBg: "Среден успех на ДЗИ по БЕЛ",
      labelEn: "DZI average score — Bulgarian language",
      unitBg: "оценка (2-6)",
      unitEn: "score (2-6)",
      cadence: "annual",
      source: {
        name: "Министерство на образованието и науката",
        url: "https://data.egov.bg/data/view/066b4b04-d81d-444e-a61c-8ca0516079e4",
      },
    },
    // DZI doesn't cover every muni every year — small/rural munis with no
    // upper-secondary school report no value. Floor is intentionally loose.
    minMunis: 150,
    minYearsPerMuni: 1,
  },
  {
    id: "populationChange",
    scrape: async (opts) => {
      const result = await fetchNsiPopulation(opts);
      const rows: NormalizeInput[] = [];
      for (const r of result.rows) {
        rows.push({
          year: r.year,
          azCode: undefined,
          oblastContext: r.oblastContext,
          muniName: r.muniName,
          value: r.value,
        });
      }
      return rows;
    },
    meta: {
      labelBg: "Промяна на населението",
      labelEn: "Population change",
      unitBg: "%",
      unitEn: "%",
      cadence: "annual",
      source: {
        name: "Национален статистически институт",
        url: "https://www.nsi.bg/bg/content/2975/население-по-области-общини-местоживеене-и-пол",
      },
    },
    minMunis: 260,
    minYearsPerMuni: 2,
  },
  {
    id: "naturalIncrease",
    scrape: async (opts) => {
      const result = await fetchNsiVital(opts);
      const rows: NormalizeInput[] = [];
      for (const r of result.rows) {
        // fetchNsiVital already resolved each row to an obshtina code
        // (it joins three NSI files by code); pass it through as azCode.
        rows.push({
          year: r.year,
          azCode: r.obshtinaCode,
          muniName: r.obshtinaCode,
          value: r.value,
        });
      }
      return rows;
    },
    meta: {
      labelBg: "Естествен прираст",
      labelEn: "Natural population change",
      unitBg: "‰",
      unitEn: "‰",
      cadence: "annual",
      source: {
        name: "Национален статистически институт",
        url: "https://www.nsi.bg/bg/content/2987/раждания-умирания-и-естествен-прираст",
      },
    },
    minMunis: 255,
    minYearsPerMuni: 5,
  },
  {
    id: "netMigration",
    scrape: async (opts) => {
      const result = await fetchNsiMigration(opts);
      const rows: NormalizeInput[] = [];
      for (const r of result.rows) {
        rows.push({
          year: r.year,
          azCode: r.obshtinaCode,
          muniName: r.obshtinaCode,
          value: r.value,
        });
      }
      return rows;
    },
    meta: {
      labelBg: "Нетна миграция",
      labelEn: "Net migration",
      unitBg: "‰",
      unitEn: "‰",
      cadence: "annual",
      source: {
        name: "Национален статистически институт",
        url: "https://www.nsi.bg/bg/content/3019/механично-движение-на-населението",
      },
    },
    minMunis: 255,
    minYearsPerMuni: 5,
  },
];

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const writeStable = (file: string, payload: unknown): void => {
  fs.writeFileSync(file, JSON.stringify(payload));
};

const cli = command({
  name: "fetch-indicators",
  description:
    "Fetch annual sub-national indicators and write data/indicators.json",
  args: {
    sourceFilter: option({
      type: optional(string),
      long: "source",
      description:
        "Limit to one source id (e.g. az_unemployment). Default: all.",
    }),
    forceDownload: flag({
      type: boolean,
      long: "force",
      description: "Re-download cached XLSX files",
    }),
    maxYears: option({
      type: optional(string),
      long: "max-years",
      description: "Only ingest the N most recent annual reviews (smoke test)",
    }),
    quiet: flag({
      type: boolean,
      long: "quiet",
      description: "Suppress progress output",
    }),
  },
  handler: async (args) => {
    const verbose = !args.quiet;
    const builds: IndicatorBuild[] = [];

    for (const src of SOURCES) {
      if (args.sourceFilter && src.id !== args.sourceFilter) continue;
      if (verbose) console.log(`\n[${src.id}] scraping...`);
      const rawRows = await src.scrape({
        forceDownload: args.forceDownload,
        maxYears: args.maxYears ? Number(args.maxYears) : undefined,
        verbose,
      });
      if (verbose) console.log(`[${src.id}] parsed ${rawRows.length} raw rows`);
      const report: NormalizeReport = normalize(rawRows);
      if (verbose) {
        console.log(
          `[${src.id}] normalize: ${report.matched.length} matched, ${report.unmatched.length} unmatched`,
        );
        if (report.unmatched.length > 0) {
          const sample = report.unmatched.slice(0, 5);
          for (const u of sample) {
            console.log(
              `  ! ${u.reason} (azCode=${u.input.azCode ?? "-"}, oblast=${u.input.oblastContext ?? "-"}, name=${u.input.muniName})`,
            );
          }
          if (report.unmatched.length > sample.length) {
            console.log(
              `  ... ${report.unmatched.length - sample.length} more`,
            );
          }
        }
      }

      // Safety: must cover the floor and median muni must have enough years.
      const muniCount = new Set(report.matched.map((r) => r.obshtinaCode)).size;
      if (muniCount < src.minMunis) {
        throw new Error(
          `safety check: [${src.id}] covered ${muniCount} obshtina codes (floor ${src.minMunis}). Investigate before re-running.`,
        );
      }
      const perMuniYears = new Map<string, Set<number>>();
      for (const r of report.matched) {
        if (!perMuniYears.has(r.obshtinaCode))
          perMuniYears.set(r.obshtinaCode, new Set());
        perMuniYears.get(r.obshtinaCode)!.add(r.year);
      }
      const medianYears = median(
        Array.from(perMuniYears.values(), (s) => s.size),
      );
      if (medianYears < src.minYearsPerMuni) {
        throw new Error(
          `safety check: [${src.id}] median muni has ${medianYears} years (floor ${src.minYearsPerMuni}).`,
        );
      }

      builds.push({ id: src.id, meta: src.meta, rows: report.matched });
    }

    if (builds.length === 0) {
      throw new Error(
        `no sources scraped — check --source filter or SOURCES configuration`,
      );
    }

    const payload = buildPayload(builds);
    writeStable(OUT_FILE, payload);
    const sliceCodes = writeMuniSlices(payload, OUT_SLICE_DIR, MUNI_FILE);

    if (verbose) {
      const sizeKb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
      console.log(`\nWrote ${OUT_FILE} (${sizeKb} KB)`);
      for (const [id, meta] of Object.entries(payload.indicators)) {
        const muniN = Object.keys(payload.series[id] ?? {}).length;
        console.log(
          `  ${id}: ${muniN} munis, years ${meta.years[0]}..${meta.years[1]}`,
        );
      }
      console.log(
        `Wrote ${sliceCodes.length} per-muni slices to ${OUT_SLICE_DIR}/`,
      );
    }
  },
});

run(cli, process.argv.slice(2));
