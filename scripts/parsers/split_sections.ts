import fs from "fs";
import { SectionInfo } from "@/data/dataTypes";
import { sectionVotesFileName } from "scripts/consts";
import { saveSplitObject } from "scripts/dataReaders";

export const splitSections = ({
  inFolder,
  outFolder,
  electionSections,
  stringify,
}: {
  inFolder: string;
  outFolder: string;
  electionSections: SectionInfo[];
  stringify: (o: object) => string;
}) => {
  const backupFileName = `${inFolder}/${sectionVotesFileName}`;
  fs.writeFileSync(backupFileName, stringify(electionSections), "utf8");
  console.log("Successfully added file ", backupFileName);
  const outDataFolder = `${outFolder}/sections`;
  if (!fs.existsSync(outDataFolder)) {
    fs.mkdirSync(outDataFolder);
  }

  const byKey = electionSections.reduce((acc, m) => {
    return { ...acc, [m.section]: m };
  }, {});
  saveSplitObject(byKey, stringify, outDataFolder);
};
