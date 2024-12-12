import fs from "fs";
import {
  ElectionMunicipality,
  ElectionSettlement,
  PartyInfo,
  ReportRow,
  SectionInfo,
  Votes,
} from "@/data/dataTypes";
import { reportValues } from "./reportValues";

export const pickVotes = (
  votes: Votes[],
): Pick<Votes, "partyNum" | "totalVotes">[] => {
  return votes.map((vote) => ({
    partyNum: vote.partyNum,
    totalVotes: vote.totalVotes,
  }));
};

export const saveReport = <
  DType extends ElectionMunicipality | ElectionSettlement | SectionInfo,
>({
  reportFolder,
  stringify,
  votes,
  prevYearFindRow,
  additionalFields,
  parties,
  prevYearParties,
}: {
  reportFolder: string;
  stringify: (o: object) => string;
  votes?: DType[];
  additionalFields?: (row: DType) => Partial<ReportRow>;
  prevYearFindRow: (row: DType) => Votes[] | undefined;
  parties: PartyInfo[];
  prevYearParties?: PartyInfo[];
}) => {
  reportValues.forEach((r) => {
    const rows = votes
      ?.map((row) => {
        const prevVotes = prevYearFindRow(row);
        return {
          oblast: row.oblast,
          obshtina: row.obshtina,
          ...r.calc({
            votes: row.results.votes,
            protocol: row.results.protocol,
            prevYearVotes: prevVotes,
            parties,
            prevYearParties,
          }),
          ...(additionalFields ? additionalFields(row) : {}),
        };
      })
      .filter((v) => {
        return v?.value !== undefined;
      })
      .sort((a, b) => {
        if (r.direction === "asc") {
          return (a?.value || 0) - (b?.value || 0);
        }
        return (b?.value || 0) - (a?.value || 0);
      });
    if (rows) {
      const data = stringify(rows);
      const fileName = `${reportFolder}/${r.name}.json`;
      fs.writeFileSync(fileName, data, "utf8");
      console.log("Successfully added file ", fileName);
    }
  });
};
