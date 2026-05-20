import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ElectionInfo, ElectionRegion, PartyInfo } from "@/data/dataTypes";
import { municipalityReports } from "./municipality_reports";
import { settlementReports } from "./settlement_reports";
import { sectionReports } from "./section_reports";
import {
  buildCoordsLookup,
  buildNeighborhoodSectionCodes,
  generateProblemSections,
  generateProblemSectionsStats,
} from "./problem_sections";
import { cikPartiesFileName, regionsVotesFileName } from "scripts/consts";
import { generateNationalSummary } from "./nationalSummary";
import { generateRegionHistory } from "./regionHistory";
import { generateSuspiciousSections } from "./suspiciousSections";
import { regionWastedReport } from "./region_wasted";
import { generateWastedVotesDashboard } from "./wasted_votes_dashboard";
import { generateBenfordReport } from "./benford";
import { generateRiskScoreReport } from "./risk_score";
import { generateRiskHistory } from "./risk_history";
import { generateClusterPersistence } from "./cluster_persistence";

const NATIONAL_THRESHOLD_PCT = 4;

// Compute the set of partyNums that fell below the 4% national threshold
// for a given election by summing per-region totals. Returns an empty set
// if region_votes.json is missing — wasted_votes reports will then skip
// that election.
const computeBelowThresholdSet = (
  publicFolder: string,
  year: string,
): Set<number> => {
  const regionsFile = `${publicFolder}/${year}/${regionsVotesFileName}`;
  if (!fs.existsSync(regionsFile)) return new Set();
  const regions: ElectionRegion[] = JSON.parse(
    fs.readFileSync(regionsFile, "utf-8"),
  );
  const totals = new Map<number, number>();
  let grandTotal = 0;
  for (const r of regions) {
    for (const v of r.results?.votes ?? []) {
      totals.set(v.partyNum, (totals.get(v.partyNum) ?? 0) + v.totalVotes);
      grandTotal += v.totalVotes;
    }
  }
  if (grandTotal === 0) return new Set();
  const below = new Set<number>();
  for (const [partyNum, votes] of totals) {
    if ((100 * votes) / grandTotal < NATIONAL_THRESHOLD_PCT)
      below.add(partyNum);
  }
  return below;
};

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory
export const generateReports = (
  dataFolder: string,
  stringify: (o: object) => string,
  election?: string,
) => {
  const publicFolder = path.resolve(__dirname, `../../data`);
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
      const belowThresholdPartyNums = computeBelowThresholdSet(
        publicFolder,
        year,
      );
      const params = {
        reportsFolder,
        dataFolder,
        year,
        stringify,
        prevYear,
        parties,
        prevYearParties,
        election: e,
        belowThresholdPartyNums,
      };
      municipalityReports(params);
      settlementReports(params);
      sectionReports(params);
      if (belowThresholdPartyNums.size > 0) {
        regionWastedReport({
          publicFolder,
          reportsFolder,
          year,
          parties,
          belowThresholdPartyNums,
          stringify,
        });
        generateWastedVotesDashboard({
          publicFolder,
          reportsFolder,
          year,
          stringify,
        });
      }
      generateBenfordReport({
        publicFolder,
        reportsFolder,
        year,
        parties,
        stringify,
      });
      generateRiskScoreReport({
        publicFolder,
        reportsFolder,
        year,
        prevYear,
        coordsLookup,
        stringify,
      });
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
  // Cross-election section rap sheet — reads every election's freshly
  // written risk_score.json, so it must run after the per-election loop.
  generateRiskHistory({ publicFolder, stringify });
  // Cross-election cluster persistence — reads every election's freshly
  // written risk_clusters.json, so it must run after the loop too.
  generateClusterPersistence({ publicFolder, stringify });
};

// Regenerate only the dashboard-facing rollups (national_summary per election +
// per-region history bundle) without re-running the slow section/settlement/
// municipality reports. Requires that the section/* report files already exist
// (anomaly counts read from them); otherwise anomaly counts will be zero.
export const generateSummariesOnly = (
  stringify: (o: object) => string,
  election?: string,
) => {
  const publicFolder = path.resolve(__dirname, `../../data`);
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
