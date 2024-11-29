import fs from "fs";
import { parse } from "csv-parse";
import { ElectionVotes, Votes, PartyInfo } from "@/data/dataTypes";
import { isMachineOnlyVote } from "scripts/utils";

export const parseVotes = (
  inFolder: string,
  parties: PartyInfo[],
  year: string,
): Promise<ElectionVotes[]> => {
  const result: string[][] = [];
  const allVotes: ElectionVotes[] = [];

  return new Promise((resolve) =>
    fs
      .createReadStream(`${inFolder}/votes.txt`)
      .pipe(parse({ delimiter: ";", relax_column_count: true }))
      .on("data", (data) => {
        result.push(data);
      })
      .on("end", () => {
        for (let i = 0; i < result.length; i++) {
          const row = result[i];
          let j = 3;
          const section = row[1];
          const existingVotes = allVotes.find((v) => v.section === section);
          const votes: ElectionVotes = existingVotes
            ? existingVotes
            : {
                document: parseInt(row[0]),
                section,
                votes: [],
              };
          const isMachineOnly = isMachineOnlyVote(year);
          while (j < row.length) {
            const partyNum = parseInt(row[j]);
            const totalVotes = parseInt(row[j + 1]);
            const existingVote = votes.votes.find(
              (v) => v.partyNum === partyNum,
            );
            const vote = existingVote
              ? existingVote
              : ({
                  partyNum,
                } as Votes);
            vote.totalVotes = (vote.totalVotes || 0) + totalVotes;
            if (!isMachineOnly) {
              vote.paperVotes = (vote.paperVotes || 0) + parseInt(row[j + 2]);
              vote.machineVotes =
                (vote.machineVotes || 0) + parseInt(row[j + 3]);
            }
            if (!existingVote) {
              votes.votes.push(vote);
            }
            j += isMachineOnly ? 2 : 4;
          }
          if (!existingVotes) {
            allVotes.push(votes);
          }
        }
        //const json = JSON.stringify(allVotes, null, 2);
        //const outFile = `${outFolder}/votes.json`;
        //fs.writeFileSync(outFile, json, "utf8");
        //console.log("Successfully added file ", outFile);
        resolve(allVotes);
      }),
  );
};
