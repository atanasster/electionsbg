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
import { backupFileName } from "scripts/recount/backup_file";
import { sectionVotesFileName } from "scripts/consts";
import { preserveSectionCoords } from "./backfill_section_coords";
import {
  describeSkippedElectionFolders,
  electionFolderKind,
  isParliamentaryFolder,
} from "scripts/lib/electionFolders";

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
  const sectionsBackUpFile = `${inFolder}/${backupFileName(sectionVotesFileName)}`;
  const hasRecount = fs.existsSync(sectionsBackUpFile);
  //const parties =
  const parties = await parseParties(inFolder, outFolder, monthYear, stringify);
  const sections = await parseSections(inFolder, monthYear);
  // Only the 2026+ CEC source carries GPS, so for every older election the
  // coordinates live solely in the generated output this run is about to
  // overwrite — and .gitignore excludes it, so nothing else would notice them
  // going. Carry them across before any writer runs: splitSections,
  // generateVotes and the settlement shards all render from this one array.
  preserveSectionCoords({ inFolder, sections });

  const votes = await parseVotes(inFolder, monthYear, parties, hasRecount);
  const protocols = await parseProtocols(
    inFolder,
    //outFolder,
    monthYear,
    //stringify,
  );

  const aggregated = generateVotes({
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
  const allFolders = dataFolders
    .filter((file) => file.isDirectory())
    .map((f) => f.name);
  // ⚠ PARLIAMENTARY ONLY. This used to map EVERY directory under `raw_data/` —
  // `agri/`, `budget/`, `procurement/`, every `_mi` and `_chmi` — so `--all` handed
  // each one to `parseParties`, whose `createReadStream` on a missing
  // `cik_parties.txt` rejects unhandled. The other kinds have their own ingests
  // (`--local-ingest`, and `--pvr` for presidential per
  // docs/plans/presidential-elections-v1.md T3.4); none of them is parseable here.
  const folders = allFolders
    .filter((name) => isParliamentaryFolder(name))
    .sort((a, b) => b.localeCompare(a));
  // ⚠ Counts OTHER ELECTION KINDS, not every skipped directory: `raw_data/` holds
  // 24 unrelated dataset folders, so a raw difference reports a number nobody can
  // act on and gets scrolled past.
  const skipped = describeSkippedElectionFolders(allFolders);
  if (all && skipped) {
    console.log(
      `[parse_elections] ${folders.length} parliamentary folder(s); skipped ${skipped}`,
    );
  }

  // A `--date` naming a real tree of the WRONG kind is a different mistake from a
  // typo, and saying so is what stops someone concluding the data is missing.
  if (date && !isParliamentaryFolder(date)) {
    const kind = electionFolderKind(date);
    const hint =
      kind === "local" || kind === "chmi"
        ? `it is a ${kind} cycle — use \`npm run data -- --local-ingest <slug>\``
        : kind === "presidential"
          ? "it is a presidential cycle — the `--pvr` ingest is not built yet (presidential-elections-v1 T3.4)"
          : "it is not an election folder";
    throw new Error(
      `Refusing to parse "${date}" as a parliamentary election: ${hint}.`,
    );
  }

  // No third arm: the function returns early unless `date` or `all` is set, so the
  // old `folders[0]` "latest" fallback was unreachable (and, before the filter above,
  // resolved to `water` rather than to any election).
  const selectedFolders = date ? folders.filter((f) => f === date) : folders;
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
