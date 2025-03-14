import fs from "fs";
import {
  ElectionInfo,
  ElectionMunicipality,
  PartyInfo,
} from "@/data/dataTypes";
import { municipalityDataReader } from "scripts/dataReaders";
import { saveReport } from "./saveReport";

export const municipalityReports = ({
  reportsFolder,
  dataFolder,
  year,
  stringify,
  prevYear,
  parties,
  prevYearParties,
  election,
}: {
  reportsFolder: string;
  dataFolder: string;
  year: string;
  stringify: (o: object) => string;
  prevYear?: string;
  parties: PartyInfo[];
  prevYearParties?: PartyInfo[];
  election: ElectionInfo;
}) => {
  const municipalityFolder = `${reportsFolder}/municipality`;
  if (!fs.existsSync(municipalityFolder)) {
    fs.mkdirSync(municipalityFolder);
  }
  const votes = municipalityDataReader(dataFolder, year);
  const prevYearVotes = municipalityDataReader(dataFolder, prevYear);
  saveReport<ElectionMunicipality>({
    reportFolder: municipalityFolder,
    stringify,
    votes,
    parties,
    prevYearParties,
    prevYearFindRow: (row) => {
      const pr = prevYearVotes?.find((r) => r.obshtina === row.obshtina);
      return pr?.results.votes;
    },
    election,
  });
};
