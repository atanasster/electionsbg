import fs from "fs";
import { parse } from "csv-parse";
import unzipper from "unzipper";

type MachineVotes = {
  section: string;
  votes: { partyNum: number; votes: number }[];
};
const parseSectionFile = async (
  zipFileName: string,
  section: string,
): Promise<MachineVotes> => {
  const result: string[][] = [];

  const zipContent = await unzipper.Open.file(zipFileName);
  const csvFile = zipContent.files.find((f) => f.path === `${section}.csv`);
  if (!csvFile) {
    throw new Error("Error reading zip file: " + zipFileName);
  }
  //const outFile = `${outFolder}/${cikPartiesFileName}`;
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
        const sectionVotes: MachineVotes = {
          section,
          votes: [],
        };
        for (let i = 0; i < result.length; i++) {
          const row = result[i];

          const partyNum = parseInt(row[2]);
          if (
            !isNaN(partyNum) &&
            partyNum !== 99 &&
            sectionVotes.votes.find((v) => v.partyNum === partyNum) ===
              undefined
          ) {
            const sNum = row[0];
            if (sNum !== section) {
              throw new Error(`Invalid section file: ${sNum} !== ${section}`);
            }
            const votes = parseInt(row[3]);
            sectionVotes.votes.push({
              partyNum,
              votes,
            });
          }
        }
        //const json = stringify(allParties);
        //fs.writeFileSync(outFile, json, "utf8");
        //console.log("Successfully added file ", outFile);
        resolve(sectionVotes);
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
            const sectionVotes = await parseSectionFile(
              `${regionFolderName}/${zipFile.name}`,
              fNameParts[0],
            );
            allSections.push(sectionVotes);
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
