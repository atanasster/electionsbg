import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateVotes } from "./generate_votes";
import { parseProtocols } from "./protocols";
import { parseVotes } from "./votes";
import { parseSections } from "./sections";
import { parseParties } from "./parties";
import { splitSections } from "./split_sections";
import { generateSearch } from "scripts/search";
import { parseCandidates } from "./parse_candidates";
import { candidatesFileName, preferencesFileName } from "scripts/consts";
import { parsePreferences } from "./parse_preferences";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const parseElection = async ({
  publicFolder,
  monthYear,
  stringify,
}: {
  monthYear: string;
  publicFolder: string;
  stringify: (o: object) => string;
}) => {
  const inFolder = path.resolve(__dirname, `../../raw_data/${monthYear}`);
  const outFolder = `${publicFolder}/${monthYear}`;
  if (!fs.existsSync(outFolder)) {
    fs.mkdirSync(outFolder);
  }
  //const parties =
  const parties = await parseParties(inFolder, outFolder, monthYear, stringify);
  const sections = await parseSections(inFolder, monthYear);
  const candidates = await parseCandidates(inFolder, monthYear);
  fs.writeFileSync(
    `${outFolder}/${candidatesFileName}`,
    stringify(candidates),
    "utf-8",
  );
  const preferences = await parsePreferences(inFolder, monthYear);
  fs.writeFileSync(
    `${inFolder}/${preferencesFileName}`,
    stringify(preferences),
    "utf-8",
  );

  const votes = await parseVotes(inFolder, monthYear, parties);
  const protocols = await parseProtocols(
    inFolder,
    //outFolder,
    monthYear,
    //stringify,
  );

  const aggregated = generateVotes({
    preferences,
    outFolder,
    sections,
    votes,
    protocols,
    stringify,
    monthYear,
    inFolder,
  });
  splitSections({
    electionSections: sections,
    inFolder,
    outFolder,
    stringify,
  });
  generateSearch({ publicFolder: outFolder, sections, stringify });
  return aggregated;
};
export const parseElections = async ({
  date,
  all,
  stringify,
  publicFolder,
}: {
  date?: string;
  all?: boolean;
  publicFolder: string;
  stringify: (o: object) => string;
}) => {
  if (!date && !all) {
    return;
  }
  const inFolder = path.resolve(__dirname, `../../raw_data/`);
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
    selectedFolders.map(async (monthYear) => {
      return await parseElection({ monthYear, publicFolder, stringify });
    }),
  );
};
