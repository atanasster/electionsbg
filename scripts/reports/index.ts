import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ElectionInfo, PartyInfo } from "@/data/dataTypes";
import { municipalityReports } from "./municipality_reports";
import { settlementReports } from "./settlement_reports";
import { sectionReports } from "./section_reports";
import {
  buildCoordsLookup,
  buildNeighborhoodSectionCodes,
  generateProblemSections,
  generateProblemSectionsStats,
} from "./problem_sections";
import { cikPartiesFileName } from "scripts/consts";
import { generateNationalSummary } from "./nationalSummary";
import { generateRegionHistory } from "./regionHistory";
import { generateSuspiciousSections } from "./suspiciousSections";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory
export const generateReports = (
  dataFolder: string,
  stringify: (o: object) => string,
  election?: string,
) => {
  const publicFolder = path.resolve(__dirname, `../../public`);
  const electionsFile = path.resolve(
    __dirname,
    "../../src/data/json/elections.json",
  );
  const elections: ElectionInfo[] = (
    JSON.parse(fs.readFileSync(electionsFile, "utf-8")) as ElectionInfo[]
  ).sort((a, b) => a.name.localeCompare(b.name));
  const seatsFile = path.resolve(
    __dirname,
    "../../src/data/json/election_seats.json",
  );
  const seatsByElection = fs.existsSync(seatsFile)
    ? JSON.parse(fs.readFileSync(seatsFile, "utf-8"))
    : {};
  const coordsLookup = buildCoordsLookup(publicFolder);
  const neighborhoodCodes = buildNeighborhoodSectionCodes(publicFolder);
  elections
    .filter((e) => election === e.name || election === undefined)
    .forEach((e) => {
      const reportsFolder = `${publicFolder}/${e.name}/reports`;
      if (!fs.existsSync(reportsFolder)) {
        fs.mkdirSync(reportsFolder);
      }
      const year = e.name;
      const fullIndex = elections.findIndex((x) => x.name === e.name);
      const prevYear =
        fullIndex > 0 ? elections[fullIndex - 1].name : undefined;
      const parties: PartyInfo[] = JSON.parse(
        fs.readFileSync(
          `${publicFolder}/${year}/${cikPartiesFileName}`,
          "utf-8",
        ),
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
        election: e,
      };
      municipalityReports(params);
      settlementReports(params);
      sectionReports(params);
      generateProblemSections({
        publicFolder,
        dataFolder,
        year,
        stringify,
        coordsLookup,
        neighborhoodCodes,
      });
      generateSuspiciousSections({
        publicFolder,
        dataFolder,
        year,
        stringify,
      });
      const priorElection: ElectionInfo | undefined =
        fullIndex > 0 ? elections[fullIndex - 1] : undefined;
      generateNationalSummary({
        publicFolder,
        reportsFolder,
        election: e,
        priorElection,
        parties,
        seatsByElection,
        stringify,
      });
    });
  generateProblemSectionsStats({ publicFolder, stringify });
  generateRegionHistory({ publicFolder, stringify });
};

// Regenerate only the dashboard-facing rollups (national_summary per election +
// per-region history bundle) without re-running the slow section/settlement/
// municipality reports. Requires that the section/* report files already exist
// (anomaly counts read from them); otherwise anomaly counts will be zero.
export const generateSummariesOnly = (
  stringify: (o: object) => string,
  election?: string,
) => {
  const publicFolder = path.resolve(__dirname, `../../public`);
  const electionsFile = path.resolve(
    __dirname,
    "../../src/data/json/elections.json",
  );
  const elections: ElectionInfo[] = (
    JSON.parse(fs.readFileSync(electionsFile, "utf-8")) as ElectionInfo[]
  ).sort((a, b) => a.name.localeCompare(b.name));
  const seatsFile = path.resolve(
    __dirname,
    "../../src/data/json/election_seats.json",
  );
  const seatsByElection = fs.existsSync(seatsFile)
    ? JSON.parse(fs.readFileSync(seatsFile, "utf-8"))
    : {};

  elections
    .filter((e) => election === e.name || election === undefined)
    .forEach((e) => {
      const year = e.name;
      const reportsFolder = `${publicFolder}/${year}/reports`;
      const partiesPath = `${publicFolder}/${year}/${cikPartiesFileName}`;
      if (!fs.existsSync(partiesPath)) return;
      const parties: PartyInfo[] = JSON.parse(
        fs.readFileSync(partiesPath, "utf-8"),
      );
      const fullIndex = elections.findIndex((x) => x.name === year);
      const priorElection =
        fullIndex > 0 ? elections[fullIndex - 1] : undefined;
      generateNationalSummary({
        publicFolder,
        reportsFolder,
        election: e,
        priorElection,
        parties,
        seatsByElection,
        stringify,
      });
    });
  generateRegionHistory({ publicFolder, stringify });
};
