import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ElectionInfo, PartyInfo } from "@/data/dataTypes";
import { municipalityReports } from "./municipality_reports";
import { settlementReports } from "./settlement_reports";
import { sectionReports } from "./section_reports";
import { cikPartiesFileName } from "scripts/consts";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory
export const generateReports = (
  dataFolder: string,
  stringify: (o: object) => string,
) => {
  const publicFolder = path.resolve(__dirname, `../../public`);
  const electionsFile = path.resolve(
    __dirname,
    "../../src/data/json/elections.json",
  );
  const elections: ElectionInfo[] = (
    JSON.parse(fs.readFileSync(electionsFile, "utf-8")) as ElectionInfo[]
  ).sort((a, b) => a.name.localeCompare(b.name));
  elections.forEach((e, index) => {
    const reportsFolder = `${publicFolder}/${e.name}/reports`;
    if (!fs.existsSync(reportsFolder)) {
      fs.mkdirSync(reportsFolder);
    }
    const year = e.name;
    const prevYear = index > 0 ? elections[index - 1].name : undefined;
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(`${publicFolder}/${year}/${cikPartiesFileName}`, "utf-8"),
    );
    const prevYearParties: PartyInfo[] | undefined = prevYear
      ? JSON.parse(
          fs.readFileSync(
            `${publicFolder}/${prevYear}/${cikPartiesFileName}`,
            "utf-8",
          ),
        )
      : undefined;
    const params = {
      reportsFolder,
      dataFolder,
      year,
      stringify,
      prevYear,
      parties,
      prevYearParties,
    };
    municipalityReports(params);
    settlementReports(params);
    sectionReports(params);
  });
};
