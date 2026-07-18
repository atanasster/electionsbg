import fs from "fs";
import { parse } from "csv-parse";
import unzipper from "unzipper";

export type MachineVotes = {
  section: string;
  votes: { partyNum: number; votes: number }[];
};

// Column of the party number within a suemg CSV row. The machine export format
// changed after the 2021-07-11 cycle: the leading section id gained an extra
// column, shifting party/votes one to the right. Votes always live at pCol+1.
export const partyNumColumn = (date: string): number =>
  date <= "2021_07_11" ? 1 : 2;

// Parse the already-CSV-split rows of ONE section's machine file into its
// per-party vote tallies. Pure — no IO — so the column/validity contract is
// unit-testable. `section` is the raw file/section id (e.g. "010100001-1");
// the stored `section` drops the trailing "-N" machine suffix.
//
// A row counts only when the party number (row[pCol]) AND the votes cell
// (row[pCol+1] — the value we actually store) both parse as numbers. Guarding
// the real votes column, not a neighbouring one, is what keeps a non-numeric
// votes cell from being stored as NaN (fixed: the guard used to test row[pCol+3]).
export const parseSectionRows = (
  rows: string[][],
  section: string,
  date: string,
): MachineVotes => {
  const sectionParts = section.split("-");
  const sectionVotes: MachineVotes = {
    section: sectionParts[0],
    votes: [],
  };
  const pCol = partyNumColumn(date);
  for (const row of rows) {
    const partyNum = parseInt(row[pCol]);
    if (
      !isNaN(partyNum) &&
      !isNaN(parseInt(row[pCol + 1])) &&
      partyNum !== 99 &&
      sectionVotes.votes.find((v) => v.partyNum === partyNum) === undefined
    ) {
      const sectionNum = row[0];

      if (sectionNum !== section) {
        throw new Error(`Invalid section file: ${sectionNum} !== ${section}`);
      }
      const votes = parseInt(row[pCol + 1]);
      sectionVotes.votes.push({
        partyNum,
        votes,
      });
    }
  }
  return sectionVotes;
};

// Fold one section's votes into the running list. When the section already
// exists (the same section id can appear across region folders / machine
// shards) its votes are SUMMED into the existing entry; only a genuinely new
// section is appended. Appending unconditionally would duplicate the section
// and double-count its votes (fixed).
export const mergeSectionVotes = (
  allSections: MachineVotes[],
  sectionVotes: MachineVotes,
): void => {
  const existing = allSections.find((s) => s.section === sectionVotes.section);
  if (existing) {
    sectionVotes.votes.forEach((vote) => {
      const v = existing.votes.find((e) => e.partyNum === vote.partyNum);
      if (v) {
        v.votes += vote.votes;
      } else {
        existing.votes.push(vote);
      }
    });
  } else {
    allSections.push(sectionVotes);
  }
};

const parseSectionFile = async (
  zipFileName: string,
  section: string,
  date: string,
): Promise<MachineVotes> => {
  const result: string[][] = [];

  const zipContent = await unzipper.Open.file(zipFileName);
  const csvFile = zipContent.files.find((f) => f.path === `${section}.csv`);
  if (!csvFile) {
    throw new Error("Error reading zip file: " + zipFileName);
  }
  return new Promise((resolve) => {
    csvFile
      .stream()
      .pipe(
        parse({ delimiter: ";", relax_column_count: true, relax_quotes: true }),
      )
      .on("data", (data: string[]) => {
        result.push(data);
      })
      .on("end", () => {
        resolve(parseSectionRows(result, section, date));
      });
  });
};

export const parseMachinesFlashMemory = async (
  inFolder: string,
  date: string,
  stringify: (o: object) => string,
) => {
  const year = date;
  const sueFolder = `${inFolder}/${year}/suemg`;
  if (!fs.existsSync(sueFolder)) {
    return false;
  }
  const allSections: MachineVotes[] = [];
  const sueRegionFolders = fs.readdirSync(sueFolder, { withFileTypes: true });
  for (const region of sueRegionFolders) {
    if (region.isDirectory()) {
      const regionFolderName = `${sueFolder}/${region.name}`;
      const sectionZipFiles = fs.readdirSync(regionFolderName, {
        withFileTypes: true,
      });
      for (const zipFile of sectionZipFiles) {
        if (!zipFile.isDirectory()) {
          const fNameParts = zipFile.name.split(".");
          if (fNameParts.length === 2 && fNameParts[1] === "zip") {
            const section = fNameParts[0];
            const zipFileName = `${regionFolderName}/${zipFile.name}`;

            const sectionVotes = await parseSectionFile(
              zipFileName,
              section,
              date,
            );
            mergeSectionVotes(allSections, sectionVotes);
          }
        }
      }
    }
  }
  const json = stringify(allSections);
  const sueFileName = `${inFolder}/${year}/suemg.json`;
  fs.writeFileSync(sueFileName, json, "utf8");
  console.log("Successfully added file ", sueFileName);
};
