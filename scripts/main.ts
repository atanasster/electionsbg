import path from "path";
import { command, run, string, option, boolean, optional, flag } from "cmd-ts";
import { fileURLToPath } from "url";
import { runStats } from "./collect_stats";
import { generateReports } from "./reports";
import { parseElections } from "./parsers/parse_elections";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

let production: boolean | undefined = undefined;
const dataFolder = path.resolve(__dirname, "../public");

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
  },
  handler: async ({ all, prod, stats, date, reports }) => {
    production = prod;
    await parseElections({ date, all, stringify, dataFolder });
    if (stats) {
      runStats(stringify);
    }
    if (reports) {
      generateReports(dataFolder, stringify);
    }
  },
});

run(app, process.argv.slice(2));
