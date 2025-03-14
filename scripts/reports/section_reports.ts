import fs from "fs";
import { ElectionInfo, PartyInfo, SectionInfo } from "@/data/dataTypes";
import { sectionDataReader } from "scripts/dataReaders";
import { saveReport } from "./saveReport";

export const sectionReports = ({
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
  const sectionFolder = `${reportsFolder}/section`;
  if (!fs.existsSync(sectionFolder)) {
    fs.mkdirSync(sectionFolder);
  }
  const votes = sectionDataReader(dataFolder, year);
  const prevYearVotes = sectionDataReader(dataFolder, prevYear);
  saveReport<SectionInfo>({
    reportFolder: sectionFolder,
    stringify,
    votes,
    additionalFields: (row) => ({ ekatte: row.ekatte, section: row.section }),
    parties,
    prevYearParties,
    prevYearFindRow: (row) =>
      prevYearVotes?.find((r) => r.section === row.section)?.results.votes,
    election,
  });
};
