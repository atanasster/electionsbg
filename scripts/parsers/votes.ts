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
          const votes: ElectionVotes = {
            document: parseInt(row[0]),
            section: row[1],
            votes: [],
          };
          const isMachineOnly = isMachineOnlyVote(year);
          while (j < row.length) {
            let partyNum = parseInt(row[j]);
            if (year === "2021_11_14") {
              partyNum = parties[partyNum - 1].number;
            }
            const totalVotes = parseInt(row[j + 1]);
            const vote: Votes = {
              partyNum,
              totalVotes,
            };
            if (!isMachineOnly) {
              vote.paperVotes = parseInt(row[j + 2]);
              vote.machineVotes = parseInt(row[j + 3]);
            }
            votes.votes.push(vote);
            j += isMachineOnly ? 2 : 4;
          }
          allVotes.push(votes);
        }
        //const json = JSON.stringify(allVotes, null, 2);
        //const outFile = `${outFolder}/votes.json`;
        //fs.writeFileSync(outFile, json, "utf8");
        //console.log("Successfully added file ", outFile);
        resolve(allVotes);
      }),
  );
};
