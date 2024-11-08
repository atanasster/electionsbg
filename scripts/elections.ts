import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse";
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const result: string[][] = [];
type ElectionVotes = {
  document: number;
  section: string;
  [key: number]: {
    totalVotes: number;
    paperVotes: number;
    machineVotes: number;
  };
};
const allVotes: ElectionVotes[] = [];

fs.createReadStream(path.resolve(__dirname, "../raw_data/2024_10/votes.txt"))
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
      };
      while (j < row.length) {
        const partyNum = parseInt(row[j]);
        const totalVotes = parseInt(row[j + 1]);
        const paperVotes = parseInt(row[j + 2]);
        const machineVotes = parseInt(row[j + 3]);
        votes[partyNum] = {
          totalVotes,
          paperVotes,
          machineVotes,
        };
        j += 4;
      }
      allVotes.push(votes);
    }
    const json = JSON.stringify(allVotes, null, 2);
    const outFile = path.resolve(__dirname, "../public/2024_10/votes.json");
    fs.writeFileSync(outFile, json, "utf8");
    console.log("Successfully added file ", outFile);
  });
