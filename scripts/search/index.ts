import fs from "fs";
import path from "path";
import { ElectionInfo, SectionIndex, SectionInfo } from "@/data/dataTypes";
import { sectionVotesFileName } from "scripts/consts";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

export const generateSearch = ({
  publicFolder,
  sections,
  stringify,
}: {
  publicFolder: string;
  sections: SectionInfo[];
  stringify: (o: object) => string;
}) => {
  const sectionsIndex: SectionIndex[] = sections.map((s) => ({
    section: s.section,
    settlement: s.settlement,
  }));
  const indexFileName = `${publicFolder}/sections_index.json`;
  fs.writeFileSync(indexFileName, stringify(sectionsIndex), "utf8");
  console.log("Successfully added file ", indexFileName);
};

export const generateAllSearchFIles = ({
  publicFolder,
  dataFolder,
  stringify,
}: {
  publicFolder: string;
  dataFolder: string;
  stringify: (o: object) => string;
}) => {
  const electionsFile = path.resolve(
    __dirname,
    "../../src/data/json/elections.json",
  );
  const elections: ElectionInfo[] = (
    JSON.parse(fs.readFileSync(electionsFile, "utf-8")) as ElectionInfo[]
  ).sort((a, b) => a.name.localeCompare(b.name));

  elections.forEach((e) => {
    const sectionFileName = `${dataFolder}/${e.name}/${sectionVotesFileName}`;
    const sections: SectionInfo[] = JSON.parse(
      fs.readFileSync(sectionFileName, "utf-8"),
    );
    generateSearch({
      stringify,
      sections,
      publicFolder: `${publicFolder}/${e.name}`,
    });
  });
};
