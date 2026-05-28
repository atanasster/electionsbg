// Council ingest — Phase 1 orchestrator CLI.
//
// Reads data/council/sources.json, picks the per-município parser, runs
// it for the requested obshtina(s) within the requested time window, and
// merges results back via lib/index_writer.ts. Each obshtina key in the
// recipes file maps to ONE entry in the dispatcher below — new munis
// land here when their per-município parser ships.
//
// Usage:
//   npx tsx scripts/council/scrape.ts                           # all wired munis, since last ingest
//   npx tsx scripts/council/scrape.ts --only VTR01              # one município
//   npx tsx scripts/council/scrape.ts --only VTR01 --since-year 2025 --max 3
//   npx tsx scripts/council/scrape.ts --only VTR01 --dry        # parse, don't write index/shards
//
// State watermark: state/ingest/council_<obshtina>.json carries
// `lastSuccessfulIngest` (set via scripts/stamp-ingest.ts) and an
// optional `sinceDate` watermark this script reads to decide what's new.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { command, flag, number, optional, option, run, string } from "cmd-ts";
import type { MuniRecipe, SourcesFile, MuniScrapeResult } from "./lib/types";
import { mergeMuniResult } from "./lib/index_writer";
import { scrapeVTR } from "./parsers/vtr";
import { scrapeSZR } from "./parsers/szr";

const STATE_DIR = join(process.cwd(), "state/ingest");
const SOURCES_PATH = join(process.cwd(), "data/council/sources.json");

type Dispatcher = (
  recipe: MuniRecipe,
  opts: {
    sinceYear?: number;
    sinceDate?: string;
    maxProtocols?: number;
    perCouncillor?: boolean;
    ocr?: boolean;
  },
) => Promise<MuniScrapeResult>;

/**
 * One entry per município that has a working parser. Munis present in
 * sources.json but absent here are skipped with a warning — that's the
 * signal that their parser hasn't shipped yet.
 */
const DISPATCHERS: Record<string, Dispatcher> = {
  VTR01: scrapeVTR,
  SZR01: scrapeSZR,
  // SOF, RSE01, PVN01, VAR01, BGS01, PDV01, SLV01 land here as each parser ships.
};

type IngestState = {
  skill: string;
  lastSuccessfulIngest: string;
  summary?: string;
  // Optional per-município date watermark; the parser uses this as
  // `sinceDate`. When absent we fall back to a one-year lookback.
  sinceDate?: string;
};

const readIngestState = async (
  obshtina: string,
): Promise<IngestState | null> => {
  const path = join(STATE_DIR, `council_${obshtina}.json`);
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as IngestState;
  } catch {
    return null;
  }
};

const writeIngestStamp = async (
  obshtina: string,
  summary: string,
  sinceDate: string,
): Promise<void> => {
  await mkdir(STATE_DIR, { recursive: true });
  const state: IngestState = {
    skill: `council_${obshtina}`,
    lastSuccessfulIngest: new Date().toISOString(),
    summary,
    sinceDate,
  };
  await writeFile(
    join(STATE_DIR, `council_${obshtina}.json`),
    JSON.stringify(state, null, 2) + "\n",
    "utf8",
  );
};

const cli = command({
  name: "council-scrape",
  description: "Council resolutions + vote tally ingest (Phase 1)",
  args: {
    only: option({
      type: optional(string),
      long: "only",
      description:
        "Run a single município key from sources.json (e.g. VTR01). Default: all wired munis.",
    }),
    sinceYear: option({
      type: optional(number),
      long: "since-year",
      description:
        "Earliest year of protocols to consider (default: prev year + current).",
    }),
    sinceDate: option({
      type: optional(string),
      long: "since-date",
      description:
        "ISO date filter (YYYY-MM-DD); only protocols newer than this are touched. Defaults to watermark from state/ingest/council_{muni}.json.",
    }),
    max: option({
      type: optional(number),
      long: "max",
      description: "Cap protocols per município (testing aid).",
    }),
    perCouncillor: flag({
      long: "per-councillor",
      description:
        "Phase 2 — extract per-councillor named-vote blocks and join to the data/officials/municipal/ roster. Slower; adds tally.perCouncillor[].",
    }),
    ocr: flag({
      long: "ocr",
      description:
        "Phase 3 — opt in to Gemini Vision OCR fallback for scanned PDFs. Costs real money per page; only used when pdftotext returns near-zero text. Requires GEMINI_API_KEY in .env.local.",
    }),
    dry: flag({
      long: "dry",
      description:
        "Parse and report — do NOT write index/shards or stamp ingest state.",
    }),
  },
  handler: async (args) => {
    const raw = await readFile(SOURCES_PATH, "utf8");
    const sources = JSON.parse(raw) as SourcesFile;

    const allKeys = Object.keys(sources.munisByObshtina);
    const targets = args.only ? [args.only] : allKeys;

    let totalAdded = 0;
    let totalUpdated = 0;
    let totalTouched = 0;
    const skipped: string[] = [];
    const errors: Array<{ key: string; url: string; message: string }> = [];

    for (const key of targets) {
      const recipe = sources.munisByObshtina[key];
      if (!recipe) {
        console.warn(`! unknown município key: ${key}`);
        continue;
      }
      if (recipe.phase1Defer) {
        console.log(
          `- skip ${key} (${recipe.name}) — phase1Defer: ${recipe.deferReason ?? ""}`,
        );
        skipped.push(key);
        continue;
      }
      const dispatcher = DISPATCHERS[key];
      if (!dispatcher) {
        console.log(
          `- skip ${key} (${recipe.name}) — parser not yet shipped (tier ${recipe.tier})`,
        );
        skipped.push(key);
        continue;
      }

      const prev = await readIngestState(key);
      const sinceDate = args.sinceDate ?? prev?.sinceDate;
      console.log(
        `→ ${key} ${recipe.name} (sinceDate=${sinceDate ?? "n/a"}, sinceYear=${args.sinceYear ?? "auto"})`,
      );

      try {
        const result = await dispatcher(recipe, {
          sinceYear: args.sinceYear,
          sinceDate,
          maxProtocols: args.max,
          perCouncillor: args.perCouncillor,
          ocr: args.ocr,
        });
        for (const e of result.errors) errors.push({ key, ...e });
        if (args.dry) {
          console.log(
            `  [DRY] ${key}: ${result.resolutions.length} resolution(s) parsed across ${result.protocolsTouched} protocol(s); index/shards NOT written`,
          );
          continue;
        }
        const merge = await mergeMuniResult(result, recipe.name);
        const latestDate =
          result.resolutions
            .map((r) => r.date)
            .sort()
            .pop() ??
          sinceDate ??
          "";
        await writeIngestStamp(
          key,
          `${result.protocolsTouched} prot(s) → ${merge.added}+/${merge.updated}=/${merge.total} total`,
          latestDate,
        );
        totalAdded += merge.added;
        totalUpdated += merge.updated;
        totalTouched += result.protocolsTouched;
        console.log(
          `  ${key}: +${merge.added} new, ${merge.updated} updated, ${merge.total} total in index`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`! ${key} failed: ${msg}`);
        errors.push({ key, url: recipe.indexUrl, message: msg });
      }
    }

    console.log(
      `\n→ done · ${totalAdded} new · ${totalUpdated} updated · ${totalTouched} protocol(s) touched · ${skipped.length} skipped · ${errors.length} error(s)`,
    );
    if (errors.length > 0) {
      console.log("  errors:");
      for (const e of errors)
        console.log(`    ${e.key} ${e.url}: ${e.message}`);
    }
  },
});

run(cli, process.argv.slice(2));
