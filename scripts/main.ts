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
  },
});

run(app, process.argv.slice(2));
