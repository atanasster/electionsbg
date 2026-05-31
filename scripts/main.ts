import path from "path";
import { command, run, string, option, boolean, optional, flag } from "cmd-ts";
import { fileURLToPath } from "url";
import { runStats } from "./stats/collect_stats";
import { generateReports, generateSummariesOnly } from "./reports";
import { generateCanonicalParties } from "./parsers/canonicalParties";
import { parseElections } from "./parsers/parse_elections";
import { generateAllSearchFIles } from "./search";
import { parseFinancing } from "./smetna_palata";
import { parseFinancialDeclarations } from "./declarations";
import { runPartyStats } from "./party_stats";
import { createPreferencesFiles } from "./preferences";
import { parseMachinesFlashMemory } from "./machines_memory";
import { backfillSectionCoords } from "./parsers/backfill_section_coords";
import { generateVoteFlows } from "./voteFlows";
import { generateLocalVoteFlows } from "./voteFlows/local_index";
import { parseLocalElections } from "./parsers_local/parse_local_elections";
import {
  ingestCycles,
  cycleSlugToRawFolder,
} from "./parsers_local/ingest_cycle";
import { ingestLegacyChmiCycle } from "./parsers_local/ingest_legacy_chmi";
import { downloadCsvBundle } from "./parsers_local/download_csv_bundle";
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
  },
  handler: async ({
    all,
    prod,
    stats,
    date,
    reports,
    search,
    financing,
    parties,
    candidates,
    machines,
    election,
    summary,
    coords,
    declarations,
    flows,
    local,
    localDate,
    localIngest,
    localCsv,
    resolveLocalCanonicals,
    localRollups,
    localFlows,
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
        // The legacy umbrellas (chmi2012-2015 … chmi2019-2023) publish one
        // numbered page per kmetstvo/mayor race rather than per OIK município,
        // so they take a dedicated ingest path.
        if (/^chmi20(12-2015|16-2018|19-2023)\//.test(localIngest)) {
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
    if (resolveLocalCanonicals) {
      resolveCanonicalsForAllLocalCycles({ publicFolder, stringify });
    }
    if (localRollups) {
      buildLocalRollups({ publicFolder, cycle: localDate, stringify });
    }
    if (localFlows) {
      generateLocalVoteFlows({ publicFolder, stringify });
    }
  },
});

run(app, process.argv.slice(2));
