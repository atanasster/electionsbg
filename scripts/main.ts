import fs from "fs";
import path from "path";
import { command, run, string, option, boolean, optional, flag } from "cmd-ts";
import { fileURLToPath } from "url";
import { parseParties } from "./parsers/parties";
import { parseSections } from "./parsers/sections";
import { parseVotes } from "./parsers/votes";
import { parseProtocols } from "./parsers/protocols";
import { aggregateSettlements } from "./aggregateData";
import { sectionVotesFileName } from "./consts";
import { runStats } from "./collect_stats";
import { generateReports } from "./reports";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

let production: boolean | undefined = undefined;
const dataFolder = path.resolve(__dirname, "../public");
const parseElections = async (
  monthYear: string,
  stringify: (o: object) => string,
) => {
  const inFolder = path.resolve(__dirname, `../raw_data/${monthYear}`);
  const outFolder = `${dataFolder}/${monthYear}`;
  if (!fs.existsSync(outFolder)) {
    fs.mkdirSync(outFolder);
  }
  //const parties =
  await parseParties(inFolder, outFolder, monthYear, stringify);
  const sections = await parseSections(inFolder, monthYear);
  const votes = await parseVotes(inFolder, monthYear);
  const protocols = await parseProtocols(
    inFolder,
    //outFolder,
    monthYear,
    //stringify,
  );
  const aggregated = aggregateSettlements(
    outFolder,
    sections,
    votes,
    protocols,
    stringify,
    monthYear,
  );
  const json = stringify(
    sections.map((s) => ({
      ...s,
      votes: s.results.votes?.filter((v) => v.totalVotes !== 0),
    })),
  );
  const outFile = `${outFolder}/${sectionVotesFileName}`;
  fs.writeFileSync(outFile, json, "utf8");
  console.log("Successfully added file ", outFile);
  return aggregated;
};
const runAggregate = async (date?: string, all?: boolean) => {
  if (!date && !all) {
    return;
  }
  const inFolder = path.resolve(__dirname, `../raw_data/`);
  const dataFolders = fs.readdirSync(inFolder, { withFileTypes: true });
  const folders = dataFolders
    .filter((file) => file.isDirectory())
    .map((f) => f.name)
    .sort((a, b) => b.localeCompare(a));

  const selectedFolders = date
    ? folders.filter((f) => f === date)
    : all
      ? folders
      : folders.length
        ? [folders[0]]
        : [];
  if (date && selectedFolders.length === 0) {
    throw new Error(
      `Can not find specified folder: 
    ${date}`,
    );
  }
  await Promise.all(
    selectedFolders.map(async (f) => {
      return await parseElections(f, stringify);
    }),
  );
};

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
    await runAggregate(date, all);
    if (stats) {
      runStats(stringify);
    }
    if (reports) {
      generateReports(dataFolder, stringify);
    }
  },
});

run(app, process.argv.slice(2));
