import fs from "fs";
import { ElectionSettlement, PartyInfo } from "@/data/dataTypes";
import { settlementDataReader } from "scripts/dataReaders";
import { saveReport } from "./saveReport";

export const settlementReports = ({
  reportsFolder,
  dataFolder,
  year,
  stringify,
  prevYear,
  parties,
  prevYearParties,
}: {
  reportsFolder: string;
  dataFolder: string;
  year: string;
  stringify: (o: object) => string;
  prevYear?: string;
  parties: PartyInfo[];
  prevYearParties?: PartyInfo[];
}) => {
  const settlementFolder = `${reportsFolder}/settlement`;
  if (!fs.existsSync(settlementFolder)) {
    fs.mkdirSync(settlementFolder);
  }
  const votes = settlementDataReader(dataFolder, year);
  const prevYearVotes = settlementDataReader(dataFolder, prevYear);
  saveReport<ElectionSettlement>({
    reportFolder: settlementFolder,
    stringify,
    votes,
    additionalFields: (row) => ({ ekatte: row.ekatte }),
    parties,
    prevYearParties,
    prevYearFindRow: (row) =>
      prevYearVotes?.find((r) => r.ekatte === row.ekatte)?.results.votes,
  });
};
