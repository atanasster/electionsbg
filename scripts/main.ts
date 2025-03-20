import path from "path";
import { command, run, string, option, boolean, optional, flag } from "cmd-ts";
import { fileURLToPath } from "url";
import { runStats } from "./stats/collect_stats";
import { generateReports } from "./reports";
import { parseElections } from "./parsers/parse_elections";
import { generateAllSearchFIles } from "./search";
import { parseFinancing } from "./smetna_palata";
import { runPartyStats } from "./party_stats";
import { createPreferencesFiles } from "./preferences";
import { parseMachinesFlashMemory } from "./machines_memory";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

let production: boolean | undefined = undefined;
const publicFolder = path.resolve(__dirname, "../public");
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
  }) => {
    production = prod;
    if (machines) {
      if (!date) {
        throw new Error("Machines suemg file with date parameter");
      }
      await parseMachinesFlashMemory(inFolder, date, stringify);
    }
    await parseElections({ date, all, stringify, publicFolder });
    if (stats) {
      runStats(stringify);
    }
    if (parties) {
      runPartyStats(stringify);
    }
    if (reports) {
      generateReports(inFolder, stringify, election);
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
  },
});

run(app, process.argv.slice(2));
