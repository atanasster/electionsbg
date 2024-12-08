import fs from "fs";
import path from "path";
import { parse } from "ts-command-line-args";
import { fileURLToPath } from "url";
import { parseParties } from "./parsers/parties";
import { parseSections } from "./parsers/sections";
import { parseVotes } from "./parsers/votes";
import { parseProtocols } from "./parsers/protocols";
import { aggregateSettlements } from "./aggregateData";
import { ElectionInfo } from "@/data/dataTypes";
import { collectStats } from "./collect_stats";

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
  stats?: boolean;
}
const args = parse<CommandLineArguments>({
  prod: { type: Boolean, optional: true },
  production: { type: Boolean, optional: true },
  all: { type: Boolean, optional: true },
  date: { type: String, optional: true },
  stats: { type: Boolean, optional: true },
});

const production = args.production || args.prod;
if (args.stats !== true) {
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
  await Promise.all(
    selectedFolders.map(async (f) => {
      return await parseElections(f, production);
    }),
  );
}

const outFolder = path.resolve(__dirname, `../public/`);

const electionsFile = path.resolve(
  __dirname,
  "../src/data/json/elections.json",
);
const elections: ElectionInfo[] = JSON.parse(
  fs.readFileSync(electionsFile, "utf-8"),
);

const updatedElections: ElectionInfo[] = fs
  .readdirSync(outFolder, { withFileTypes: true })
  .filter((file) => file.isDirectory())
  .filter((file) => file.name.startsWith("20"))
  .map((f) => ({
    name: f.name,
    ...elections.find((p) => p.name === f.name),
  }))
  .sort((a, b) => b.name.localeCompare(a.name));
const publicFolder = path.resolve(__dirname, `../public`);
const { country, byRegion, byMunicipality } = collectStats(
  updatedElections,
  publicFolder,
);
const json = stringifyJSON(country, production);

fs.writeFileSync(electionsFile, json, "utf8");
console.log("Successfully added file ", electionsFile);
Object.keys(byRegion).forEach((regionName) => {
  const data = stringifyJSON(byRegion[regionName], production);
  fs.writeFileSync(
    `${publicFolder}/regions/${regionName}_stats.json`,
    data,
    "utf8",
  );
});
Object.keys(byMunicipality).forEach((muniName) => {
  const data = stringifyJSON(byMunicipality[muniName], production);
  fs.writeFileSync(
    `${publicFolder}/municipalities/${muniName}_stats.json`,
    data,
    "utf8",
  );
});
