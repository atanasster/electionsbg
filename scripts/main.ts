import path from "path";
import { command, run, string, option, boolean, optional, flag } from "cmd-ts";
import { fileURLToPath } from "url";
import { runStats } from "./stats/collect_stats";
import { generateReports, generateSummariesOnly } from "./reports";
import { generateCanonicalParties } from "./parsers/canonicalParties";
import { parseElections } from "./parsers/parse_elections";
import { generateAllSearchFIles } from "./search";
import { parseFinancing } from "./smetna_palata";
import { scrapeErik } from "./smetna_palata/scrape_erik";
import { parseFinancialDeclarations } from "./declarations";
import { runPartyStats } from "./party_stats";
import { createPreferencesFiles } from "./preferences";
import { parseMachinesFlashMemory } from "./machines_memory";
import { backfillSectionCoords } from "./parsers/backfill_section_coords";
import { generateCityRayonData } from "./helpers/gen_city_rayon_data";
import { backfillLocalSectionCoords } from "./parsers_local/backfill_local_section_coords";
import { generateLocalProblemSections } from "./parsers_local/problem_sections_local";
import { generateVoteFlows } from "./voteFlows";
import { generateLocalVoteFlows } from "./voteFlows/local_index";
import { generatePrevoteFlows } from "./voteFlows/parl_local_index";
import { generateLocalPlaceTrends } from "./reports/local/build_local_place_trends";
import { parseLocalElections } from "./parsers_local/parse_local_elections";
import {
  ingestCycles,
  cycleSlugToRawFolder,
} from "./parsers_local/ingest_cycle";
import { ingestLegacyChmiCycle } from "./parsers_local/ingest_legacy_chmi";
import { ingestMi2007 } from "./parsers_local/ingest_mi2007";
import { ingestChmi2009, CHMI2009_SLUG } from "./parsers_local/ingest_chmi2009";
import { downloadCsvBundle } from "./parsers_local/download_csv_bundle";
import { ingestByElectionTurnout } from "./parsers_local/ingest_byelection_turnout";
import { shutdownCikFetch } from "./parsers_local/cik_fetch";
import { resolveCanonicalsForAllLocalCycles } from "./parsers_local/resolve_canonicals";
import { buildLocalRollups } from "./parsers_local/build_region_json";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

let production: boolean | undefined = undefined;
// Election data folders moved out of /public/ to /data/ during the GCS
// migration so they no longer ship through Firebase Hosting. The variable
// keeps the historical name `publicFolder` because every script in this
// pipeline takes a `publicFolder` argument that resolves to the data
// output root — renaming through the entire interface chain would be a
// large unrelated change. See src/data/dataUrl.ts for the runtime seam.
const publicFolder = path.resolve(__dirname, "../data");
const inFolder = path.resolve(__dirname, "../raw_data");

const stringify = (o: object) => stringifyJSON(o, production);

const stringifyJSON = (o: object, production?: boolean) =>
  production ? JSON.stringify(o) : JSON.stringify(o, null, 2);
const app = command({
  name: "commands",
  args: {
    all: flag({
      type: optional(boolean),
      long: "all",
      short: "a",
      defaultValue: () => false,
    }),
    prod: flag({
      type: optional(boolean),
      long: "prod",
      short: "p",
      defaultValue: () => false,
    }),
    date: option({
      type: optional(string),
      long: "date",
      short: "d",
    }),
    election: option({
      type: optional(string),
      long: "election",
      short: "e",
    }),
    reports: flag({
      type: optional(boolean),
      long: "reports",
      short: "r",
      defaultValue: () => false,
    }),
    stats: flag({
      type: optional(boolean),
      long: "stats",
      short: "s",
      defaultValue: () => false,
    }),
    search: flag({
      type: optional(boolean),
      long: "search",
      short: "c",
      defaultValue: () => false,
    }),
    financing: flag({
      type: optional(boolean),
      long: "financing",
      short: "f",
      defaultValue: () => false,
    }),
    erik: flag({
      type: optional(boolean),
      long: "erik",
      defaultValue: () => false,
    }),
    parties: flag({
      type: optional(boolean),
      long: "parties",
      short: "r",
      defaultValue: () => false,
    }),
    machines: flag({
      type: optional(boolean),
      long: "machines",
      short: "m",
      defaultValue: () => false,
    }),
    candidates: flag({
      type: optional(boolean),
      long: "candidates",
      short: "n",
      defaultValue: () => false,
    }),
    summary: flag({
      type: optional(boolean),
      long: "summary",
      short: "u",
      defaultValue: () => false,
    }),
    coords: flag({
      type: optional(boolean),
      long: "coords",
      short: "g",
      defaultValue: () => false,
    }),
    // Rebuild the Пловдив/Варна район layer (geometry + per-election results +
    // município shards) from the parliamentary section data. Derived, so folded
    // into `--all`; runs after the section coords backfill it depends on.
    cityRayons: flag({
      type: optional(boolean),
      long: "city-rayons",
      defaultValue: () => false,
    }),
    declarations: flag({
      type: optional(boolean),
      long: "declarations",
      defaultValue: () => false,
    }),
    flows: flag({
      type: optional(boolean),
      long: "flows",
      short: "w",
      defaultValue: () => false,
    }),
    // Local elections are parsed by a separate tree under scripts/parsers_local/
    // because the data shape diverges substantially from parliamentary
    // (per-OIK party numbering, multiple race types per município, two
    // mayor rounds). `--all` does NOT auto-include locals — invoke with
    // `--local --all` to rebuild every cycle in raw_data/*_mi/*_chmi.
    local: flag({
      type: optional(boolean),
      long: "local",
      short: "L",
      defaultValue: () => false,
    }),
    localDate: option({
      type: optional(string),
      long: "local-date",
    }),
    // `--local-ingest <cycleSlug>` runs the automated end-to-end ingest:
    // download csv.zip via Playwright-warmed Cloudflare cookie, extract with
    // CP866 fix, mirror per-município HTML pages, then run the parser.
    // The slug uses the CIK URL form, e.g. "mi2023" or
    // "chmi2024-2026/2024-10-20_chastichen".
    localIngest: option({
      type: optional(string),
      long: "local-ingest",
    }),
    // `--local-csv <cycleSlug>` downloads the section-level CSV bundle
    // (votes.txt / sections.txt / protocols.txt) via the CF-clearing headed
    // Playwright session, extracts it (CP866) under raw_data/<folder>/ТУР1/,
    // then re-parses the cycle so council vote share + per-station section
    // shards get backfilled. Flag-gated operator step (pops a browser window).
    localCsv: option({
      type: optional(string),
      long: "local-csv",
    }),
    // `--local-byelection-turnout <cycleSlug>` backfills exact turnout onto a
    // chmi cycle's район/община-mayor bundles from ЦИК's "Числови данни от
    // протокол" HTML (the rezultati summary carries vote tallies only). Without
    // it the dashboard can only estimate by-election активност. Flag-gated
    // operator step (pops a browser window via the CF-clearing session).
    localByElectionTurnout: option({
      type: optional(string),
      long: "local-byelection-turnout",
    }),
    // Re-resolve `primaryCanonicalId` on every already-ingested local-cycle
    // bundle against the current canonical_parties.json, without re-fetching
    // CIK HTML. Fast, idempotent — use after editing manualCanonicals,
    // partyOverrides, or local_coalition_overrides.
    resolveLocalCanonicals: flag({
      type: optional(boolean),
      long: "resolve-local-canonicals",
      defaultValue: () => false,
    }),
    // Additive bundle-only pass: rebuild per-oblast region rollups
    // (data/<cycle>/region/<oblast>.json) + the national regions_summary.json
    // from already-ingested município bundles. Scope to one cycle with
    // --local-date, else every regular cycle. Never re-fetches CIK HTML.
    localRollups: flag({
      type: optional(boolean),
      long: "local-rollups",
      defaultValue: () => false,
    }),
    // Estimated council vote-flow ("where did the votes go") between every
    // consecutive pair of regular local cycles. Reads the already-ingested
    // per-município section shards; writes data/transitions_local/. Council
    // ballot only, national + oblast scope. Flag-gated — local cycles land
    // every ~4 years, so it's not part of `--all`.
    localFlows: flag({
      type: optional(boolean),
      long: "local-flows",
      defaultValue: () => false,
    }),
    // Additive pass: stamp lat/lon (+ building address) onto every local-cycle
    // section shard from the latest parliamentary election that ships GPS
    // (shared 9-digit CIK section codes). Powers the local section map +
    // top-sections tiles. Idempotent; reads no network. Run after a fresh
    // parliamentary cycle adds coordinates, or after re-ingesting local
    // sections. Also folded into `--all`.
    localCoords: flag({
      type: optional(boolean),
      long: "local-coords",
      defaultValue: () => false,
    }),
    // Additive pass: flag the curated Roma-neighborhood polling sections inside
    // the local council data — the council-ballot analogue of the parliamentary
    // problem_sections report. Reads the already-ingested section shards + the
    // per-station detail files and writes data/<cycle>/problem_sections.json for
    // every regular `_mi` cycle. Must run AFTER --local-coords (the address
    // keyword match relies on the `address` field that backfill stamps onto the
    // shards). Idempotent, no network. Also folded into `--all`.
    localProblemSections: flag({
      type: optional(boolean),
      long: "local-problem-sections",
      defaultValue: () => false,
    }),
    // Per-place cross-cycle trends (council party share + mayoral winner per
    // cycle) for the settlement and район dashboards. Reads the per-município
    // section detail files; writes data/local_place_trends/<obshtina>.json.
    // Flag-gated — local cycles land every ~4 years, so not part of `--all`.
    localPlaceTrends: flag({
      type: optional(boolean),
      long: "local-place-trends",
      defaultValue: () => false,
    }),
    // Estimated pre-vote flow: the most recent parliamentary vote before each
    // local cycle → that cycle's council ballot. Writes data/transitions_prevote/.
    // Flag-gated — local cycles land every ~4 years, so not part of `--all`.
    prevoteFlows: flag({
      type: optional(boolean),
      long: "prevote-flows",
      defaultValue: () => false,
    }),
  },
  handler: async ({
    all,
    prod,
    stats,
    date,
    reports,
    search,
    financing,
    erik,
    parties,
    candidates,
    machines,
    election,
    summary,
    coords,
    cityRayons,
    declarations,
    flows,
    local,
    localDate,
    localIngest,
    localCsv,
    localByElectionTurnout,
    resolveLocalCanonicals,
    localRollups,
    localFlows,
    localCoords,
    localProblemSections,
    localPlaceTrends,
    prevoteFlows,
  }) => {
    production = prod;
    if (machines) {
      if (!date) {
        throw new Error("Machines suemg file with date parameter");
      }
      await parseMachinesFlashMemory(inFolder, date, stringify);
    }
    await parseElections({ date, all, stringify, publicFolder });
    if (coords || all) {
      backfillSectionCoords({
        publicFolder,
        dataFolder: inFolder,
        stringify,
      });
    }
    // Пловдив/Варна район layer (geometry + per-election results + município
    // shards). Derived from the section data + the coords backfilled just
    // above, so it runs here and is folded into `--all` — never stale after a
    // parliamentary re-ingest. Output is bucket-served (run bucket:sync:all).
    if (cityRayons || all) {
      generateCityRayonData();
    }
    // Transfer the (now backfilled) parliamentary GPS/address onto the local
    // section shards — shared 9-digit CIK section codes. Runs after the
    // parliamentary backfill so the freshest coordinates are available.
    if (localCoords || all) {
      backfillLocalSectionCoords({ publicFolder, stringify });
    }
    // Roma-neighborhood "problem sections" for local councils. Runs AFTER the
    // coords/address backfill above — the address keyword match depends on the
    // `address` field that backfillLocalSectionCoords stamps onto the shards.
    if (localProblemSections || all) {
      generateLocalProblemSections({ publicFolder, stringify });
    }
    if (stats) {
      runStats(stringify);
    }
    if (parties) {
      runPartyStats(stringify);
    }
    // `--all` (npm run prod) regenerates reports too: they are derived
    // from the freshly-parsed election data, so the full pipeline must
    // not leave them stale (risk score, clusters, benford, summaries, …).
    if (reports || all) {
      generateReports(inFolder, stringify, election);
    }
    if (summary) {
      generateSummariesOnly(stringify, election);
      generateCanonicalParties({ publicFolder, stringify });
      // Canonical regen → refresh every local cycle's baked primaryCanonicalId
      // so they pick up new manualCanonicals / partyOverrides additions
      // without a CIK re-fetch.
      resolveCanonicalsForAllLocalCycles({ publicFolder, stringify });
    }
    if (search) {
      generateAllSearchFIles({
        dataFolder: inFolder,
        publicFolder,
        stringify,
      });
    }
    if (erik) {
      // Scrape ЕРИК campaign-finance data into the raw_data layout the parser
      // reads. `-e <election>` targets a specific election; default = latest.
      await scrapeErik({
        electionKey: election,
        rawFolder: inFolder,
        dataFolder: publicFolder,
        stringify,
      });
    }
    if (financing) {
      await parseFinancing({
        dataFolder: inFolder,
        publicFolder,
        stringify,
      });
    }
    if (candidates) {
      await createPreferencesFiles(stringify, election);
    }
    if (declarations) {
      await parseFinancialDeclarations({
        publicFolder,
        dataFolder: inFolder,
        stringify,
      });
    }
    if (flows || all) {
      generateVoteFlows({ publicFolder, stringify });
    }
    if (local || localDate) {
      await parseLocalElections({
        date: localDate,
        all: local && !localDate,
        publicFolder,
        stringify,
      });
    }
    if (localIngest) {
      try {
        // 2007 (mi2007) is a separate ЦИКМИ archive (mi2007.cik.bg) with a
        // per-place static-HTML model — its own end-to-end ingest.
        if (localIngest === "mi2007") {
          await ingestMi2007({ publicFolder, stringify });
        }
        // The single pre-2012 partial (2009-11-15 Sofia by-election) is a
        // caption-based single page, not the numbered-page legacy model.
        else if (localIngest === CHMI2009_SLUG) {
          await ingestChmi2009({ publicFolder, stringify });
        }
        // The legacy umbrellas (chmi2012-2015 … chmi2019-2023) publish one
        // numbered page per kmetstvo/mayor race rather than per OIK município,
        // so they take a dedicated ingest path.
        else if (/^chmi20(12-2015|16-2018|19-2023)\//.test(localIngest)) {
          await ingestLegacyChmiCycle({
            cycleSlug: localIngest,
            publicFolder,
            stringify,
          });
        } else {
          await ingestCycles({
            cycleSlugs: [localIngest],
            publicFolder,
            stringify,
          });
          // A current-style chmi partial (e.g. chmi2024-2026/<date>_chastichen)
          // re-parses bundles with a zeroed protocol; immediately backfill the
          // exact by-election turnout from ЦИК's числови-данни HTML so it
          // survives the re-ingest. Regular mi cycles already carry turnout
          // from the CSV bundle, so skip them.
          const isCurrentChmi =
            /^chmi/.test(localIngest) &&
            !/^chmi20(12-2015|16-2018|19-2023)\//.test(localIngest);
          if (isCurrentChmi) {
            await ingestByElectionTurnout({
              cycleSlug: localIngest,
              publicFolder,
              rawDataRoot: inFolder,
              stringify,
            });
          }
        }
      } finally {
        // Keep the headless Chromium from blocking process exit.
        await shutdownCikFetch();
      }
    }
    if (localCsv) {
      try {
        const result = await downloadCsvBundle(localCsv);
        if (result) {
          // Re-parse the cycle so the freshly-extracted section CSV backfills
          // council vote share + emits per-station section shards.
          await parseLocalElections({
            date: cycleSlugToRawFolder(localCsv),
            publicFolder,
            stringify,
          });
        }
      } finally {
        await shutdownCikFetch();
      }
    }
    if (localByElectionTurnout) {
      await ingestByElectionTurnout({
        cycleSlug: localByElectionTurnout,
        publicFolder,
        rawDataRoot: inFolder,
        stringify,
      });
    }
    if (resolveLocalCanonicals) {
      resolveCanonicalsForAllLocalCycles({ publicFolder, stringify });
    }
    if (localRollups) {
      buildLocalRollups({ publicFolder, cycle: localDate, stringify });
    }
    if (localFlows) {
      generateLocalVoteFlows({ publicFolder, stringify });
    }
    if (localPlaceTrends) {
      generateLocalPlaceTrends({ publicFolder, stringify });
    }
    if (prevoteFlows) {
      generatePrevoteFlows({ publicFolder, stringify });
    }
  },
});

run(app, process.argv.slice(2));
