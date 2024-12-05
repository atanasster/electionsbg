import fs from "fs";
import path from "path";
import { parse } from "ts-command-line-args";
import { fileURLToPath } from "url";
import { parseParties } from "./parsers/parties";
import { parseSections } from "./parsers/sections";
import { parseVotes } from "./parsers/votes";
import { parseProtocols } from "./parsers/protocols";
import { aggregateSettlements } from "./aggregateData";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const stringifyJSON = (o: object, production?: boolean) =>
  production ? JSON.stringify(o) : JSON.stringify(o, null, 2);

const parseElections = async (monthYear: string, production?: boolean) => {
  const inFolder = path.resolve(__dirname, `../raw_data/${monthYear}`);
  const outFolder = path.resolve(__dirname, `../public/${monthYear}`);
  const stringify = (o: object) => stringifyJSON(o, production);
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
      votes: s.votes?.filter((v) => v.totalVotes !== 0),
    })),
  );
  const outFile = `${outFolder}/section_votes.json`;
  fs.writeFileSync(outFile, json, "utf8");
  console.log("Successfully added file ", outFile);
  return aggregated;
};

interface CommandLineArguments {
  date?: string;
  production?: boolean;
  prod?: boolean;
  all?: boolean;
}
const args = parse<CommandLineArguments>({
  prod: { type: Boolean, optional: true },
  production: { type: Boolean, optional: true },
  all: { type: Boolean, optional: true },
  date: { type: String, optional: true },
});

const inFolder = path.resolve(__dirname, `../raw_data/`);
const dataFolders = fs.readdirSync(inFolder, { withFileTypes: true });
const folders = dataFolders
  .filter((file) => file.isDirectory())
  .map((f) => f.name)
  .sort((a, b) => b.localeCompare(a));

const selectedFolders = args.date
  ? folders.filter((f) => f === args.date)
  : args.all
    ? folders
    : folders.length
      ? [folders[0]]
      : [];
if (selectedFolders.length === 0) {
  throw new Error(
    `Can not find specified folder: 
    ${args.date}`,
  );
}
const production = args.production || args.prod;
await Promise.all(
  selectedFolders.map(async (f) => {
    return await parseElections(f, production);
  }),
);

const outFolder = path.resolve(__dirname, `../public/`);

const electionFolders = fs
  .readdirSync(outFolder, { withFileTypes: true })
  .filter((file) => file.isDirectory())
  .filter((file) => file.name.startsWith("20"))
  .map((f) => f.name)
  .sort((a, b) => b.localeCompare(a));

const json = stringifyJSON(electionFolders, production);
const outFile = path.resolve(__dirname, "../src/data/json/elections.json");
fs.writeFileSync(outFile, json, "utf8");
console.log("Successfully added file ", outFile);
