import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SectionInfo } from "@/data/dataTypes";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

export const findSectionInOtherElections = (
  section: string,
  yearMonth: string,
): SectionInfo | undefined => {
  const outFolder = path.resolve(__dirname, `../../public/`);

  const elections: string[] = fs
    .readdirSync(outFolder, { withFileTypes: true })
    .filter((file) => file.isDirectory())
    .filter((file) => file.name.startsWith("20") && file.name !== yearMonth)
    .map((f) => f.name)
    .sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < elections.length; i++) {
    const sectionFileName = path.resolve(
      outFolder,
      elections[i],
      `./sections/${section}.json`,
    );
    if (fs.existsSync(sectionFileName)) {
      const data = fs.readFileSync(sectionFileName, "utf-8");
      const s: SectionInfo = JSON.parse(data);
      return {
        section,
        zip_code: s.zip_code,
        settlement: s.settlement,
        address: s.address,
      } as SectionInfo;
    }
  }
  return undefined;
};
