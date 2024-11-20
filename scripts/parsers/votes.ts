import fs from "fs";
import { parse } from "csv-parse";

import { ElectionVotes } from "@/data/dataTypes";

export const parseVotes = (inFolder: string): Promise<ElectionVotes[]> => {
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
          while (j < row.length) {
            const partyNum = parseInt(row[j]);
            const totalVotes = parseInt(row[j + 1]);
            const paperVotes = parseInt(row[j + 2]);
            const machineVotes = parseInt(row[j + 3]);
            votes.votes.push({
              key: partyNum,
              totalVotes,
              paperVotes,
              machineVotes,
            });
            j += 4;
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
