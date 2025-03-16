import fs from "fs";
import { parse } from "csv-parse";
import {
  ElectionVotes,
  PartyInfo,
  Votes,
  isMachineOnlyVote,
} from "@/data/dataTypes";
import { MachineVotes } from "scripts/machines_memory";

export const parseVotes = (
  inFolder: string,
  year: string,
  parties: PartyInfo[],
): Promise<ElectionVotes[]> => {
  const result: string[][] = [];
  const allVotes: ElectionVotes[] = [];
  const suemgFile = `${inFolder}/suemg.json`;
  const machineVotes: MachineVotes[] | undefined = fs.existsSync(suemgFile)
    ? JSON.parse(fs.readFileSync(suemgFile, "utf-8"))
    : undefined;
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

          const sectionRow =
            year === "2013_05_12" ? 1 : year <= "2021_04_04" ? 0 : 1;
          let section = row[sectionRow];
          if (section.startsWith("*")) {
            section = section.substring(1);
          }
          const existingVotes = allVotes.find((v) => v.section === section);
          const votes: ElectionVotes = existingVotes
            ? existingVotes
            : {
                section,
                votes: [],
              };
          const isMachineOnly = isMachineOnlyVote(year);

          if (year <= "2009_07_05") {
            let j = 1;
            while (j < row.length) {
              if (parties.length < j) {
                break;
              }
              if (row[j] !== "") {
                const partyNum = parties[j - 1].number;

                const existingVote = votes.votes.find(
                  (v) => v.partyNum === partyNum,
                );
                const vote = existingVote
                  ? existingVote
                  : ({
                      partyNum,
                    } as Votes);
                const totalVotes = parseInt(row[j]);
                if (!existingVote) {
                  vote.paperVotes = totalVotes;
                  vote.totalVotes = totalVotes;
                } else {
                  vote.machineVotes = totalVotes;
                  vote.totalVotes = vote.totalVotes + vote.machineVotes;
                }
                votes.votes.push(vote);
              }
              j += 1;
            }
          } else if (year === "2013_05_12") {
            let j = 2;
            while (j < row.length) {
              if (row[j] !== "") {
                const partyNum = parseInt(row[j]);
                const totalVotes = parseInt(row[j + 1]);
                const vote: Votes = {
                  partyNum,
                  totalVotes,
                  machineVotes: 0,
                  paperVotes: totalVotes,
                };
                votes.votes.push(vote);
              }
              j += 2;
            }
          } else if (year === "2014_10_05") {
            let j = 1;
            while (j < row.length) {
              if (row[j] !== "") {
                const partyNum = Math.floor(1 + j / 2);
                const totalVotes = parseInt(row[j]);
                const vote: Votes = {
                  partyNum,
                  totalVotes,
                  machineVotes: 0,
                  paperVotes: totalVotes,
                };
                votes.votes.push(vote);
              }
              j += 2;
            }
          } else {
            let j = year <= "2021_04_04" ? 2 : 3;
            const isOld = year <= "2017_03_26";
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

              if (isMachineOnly) {
                vote.totalVotes = (vote.totalVotes || 0) + totalVotes;
                if (!existingVote) {
                  vote.totalVotes = totalVotes;
                  //paper votes in a machine-only election
                  if (["24", "26", "27", "28"].includes(row[0])) {
                    vote.paperVotes = vote.totalVotes;
                    vote.machineVotes = 0;
                  } else {
                    vote.machineVotes = vote.totalVotes;
                    vote.paperVotes = 0;
                  }
                } else {
                  vote.machineVotes = (vote.machineVotes || 0) + totalVotes;
                }
              } else {
                if (isOld) {
                  vote.machineVotes = 0;
                  vote.paperVotes = vote.totalVotes;
                } else {
                  if (row[j + 2] !== "") {
                    vote.paperVotes =
                      (vote.paperVotes || 0) + parseInt(row[j + 2]);
                  }
                  if (row[j + 3] !== "") {
                    vote.machineVotes =
                      (vote.machineVotes || 0) + parseInt(row[j + 3]);
                  }
                  vote.totalVotes =
                    (vote.machineVotes || 0) + (vote.paperVotes || 0);
                }
              }
              if (!existingVote) {
                votes.votes.push(vote);
              }
              j += isOld ? 3 : isMachineOnly ? 2 : 4;
            }
          }
          if (!existingVotes) {
            votes.section = section;
            if (machineVotes) {
              const machineVote = machineVotes.find(
                (m) => m.section === section,
              );

              if (machineVote) {
                votes.votes.forEach((v) => {
                  const vote = machineVote.votes.find(
                    (m) => m.partyNum === v.partyNum,
                  );
                  v.suemgVotes = vote?.votes || 0;
                });
              }
            }
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
