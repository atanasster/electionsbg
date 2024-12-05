import fs from "fs";
import { parse } from "csv-parse";
import { SectionProtocol, isMachineOnlyVote } from "@/data/dataTypes";

export type FullSectionProtocol = {
  //Пълен код на секция(код на район(2), община(2), адм. район(2), секция(3))
  section: string;
  //Код на РИК
  rik?: string;
} & SectionProtocol;

export const parseProtocols = async (
  inFolder: string,
  //outFolder: string,
  year: string,
  //stringify: (o: object) => string,
): Promise<FullSectionProtocol[]> => {
  const result: string[][] = [];
  const fileName = "protocols";
  return new Promise((resolve) =>
    fs
      .createReadStream(`${inFolder}/${fileName}.txt`)
      .pipe(parse({ delimiter: ";", relax_column_count: true }))
      .on("data", (data) => {
        result.push(data);
      })
      .on("end", () => {
        const allProtocols: FullSectionProtocol[] = [];
        for (let i = 0; i < result.length; i++) {
          const row = result[i];
          const sectionRow = year === "2014_10_05" ? 0 : 1;
          const section = row[sectionRow];
          const existingProtocol = allProtocols.find(
            (p) => p.section == section,
          );
          const protocol: FullSectionProtocol =
            existingProtocol || ({} as FullSectionProtocol);
          protocol.section = section;
          if (year <= "2013_05_12") {
            protocol.ballotsReceived = parseInt(row[3]);
            protocol.numRegisteredVoters = parseInt(row[4]);
            protocol.numAdditionalVoters = parseInt(row[5]) + parseInt(row[6]);
            protocol.totalActualVoters = parseInt(row[7]);
            protocol.numUnusedPaperBallots = parseInt(row[19]);
            protocol.numInvalidAndDestroyedPaperBallots = parseInt(row[20]);
            protocol.numPaperBallotsFound = parseInt(row[24]);
            protocol.numInvalidBallotsFound = parseInt(row[32]);
            protocol.numValidVotes = parseInt(row[33]);
          } else if (year <= "2014_10_05") {
            const fieldsIdx = year === "2014_10_05" ? 2 : 3;
            protocol.ballotsReceived = parseInt(row[fieldsIdx]);
            protocol.numRegisteredVoters = parseInt(row[fieldsIdx + 1]);
            protocol.numAdditionalVoters = parseInt(row[fieldsIdx + 2]);
            //protocol.totalActualVoters = parseInt(row[fieldsIdx + 3]);
            protocol.numUnusedPaperBallots = parseInt(row[fieldsIdx + 7]);
            protocol.numInvalidAndDestroyedPaperBallots = parseInt(
              row[fieldsIdx + 8],
            );
            protocol.numValidVotes = parseInt(row[fieldsIdx + 13]);
            protocol.numPaperBallotsFound = protocol.numValidVotes;
            protocol.numInvalidBallotsFound = parseInt(row[fieldsIdx + 14]);
            protocol.totalActualVoters = parseInt(row[fieldsIdx + 15]);
            protocol.numValidNoOnePaperVotes = parseInt(row[fieldsIdx + 16]);
          } else {
            const document = row[0];
            protocol.rik = row[2];
            if (year === "2017_03_26") {
              protocol.ballotsReceived = parseInt(row[4]);
              protocol.numRegisteredVoters = parseInt(row[5]);
              protocol.numAdditionalVoters = parseInt(row[6]);
              protocol.totalActualVoters = parseInt(row[7]);
              protocol.numUnusedPaperBallots = parseInt(row[8]);
              protocol.numInvalidAndDestroyedPaperBallots = parseInt(row[9]);
              protocol.numValidVotes = parseInt(row[14]);
              protocol.numPaperBallotsFound = parseInt(row[14]);
              protocol.numInvalidBallotsFound = parseInt(row[15]);
              protocol.totalActualVoters = parseInt(row[16]);
              protocol.numValidNoOnePaperVotes = parseInt(row[18]);
            } else if (year === "2021_04_04") {
              protocol.ballotsReceived = parseInt(row[4]);
              protocol.numRegisteredVoters = parseInt(row[5]);
              protocol.totalActualVoters = parseInt(row[6]);
              protocol.numAdditionalVoters = 0;
              protocol.numUnusedPaperBallots = 0;
              protocol.numInvalidAndDestroyedPaperBallots = parseInt(row[7]);
              protocol.numInvalidBallotsFound = parseInt(row[11]);
              if (document === "8") {
                protocol.numPaperBallotsFound = parseInt(row[8]);
                protocol.numValidVotes = parseInt(row[12]);
                protocol.numValidNoOnePaperVotes = parseInt(row[18]);
                protocol.numMachineBallots = parseInt(row[13]);
                protocol.numValidMachineVotes = parseInt(row[16]);
                protocol.numValidNoOneMachineVotes = parseInt(row[19]);
              } else {
                protocol.numPaperBallotsFound = parseInt(row[10]);
                protocol.numValidVotes = parseInt(row[14]);
                protocol.numValidNoOnePaperVotes = parseInt(row[20]);
              }
            } else if (year === "2021_07_11") {
              if (document === "26" || document === "25" || document === "24") {
                protocol.ballotsReceived = parseInt(row[4]);
                protocol.numRegisteredVoters = parseInt(row[5]);
                protocol.numAdditionalVoters = parseInt(row[6]);
                protocol.numUnusedPaperBallots = 0;
                protocol.numInvalidAndDestroyedPaperBallots = parseInt(row[9]);
                protocol.totalActualVoters = parseInt(row[12]);
              }
              if (row[14] !== "" && row[16] !== "") {
                protocol.numMachineBallots =
                  (protocol.numMachineBallots || 0) + parseInt(row[14]);
                protocol.numValidNoOneMachineVotes =
                  (protocol.numValidNoOneMachineVotes || 0) + parseInt(row[16]);
                protocol.numValidMachineVotes =
                  (protocol.numValidMachineVotes || 0) +
                  (row[15] !== ""
                    ? parseInt(row[15])
                    : protocol.totalActualVoters -
                      protocol.numValidNoOneMachineVotes);
              }
            } else if (isMachineOnlyVote(year)) {
              if (document === "26" || document === "25" || document === "24") {
                protocol.ballotsReceived = parseInt(row[6]);
                protocol.numRegisteredVoters = parseInt(row[7]);
                protocol.numAdditionalVoters = parseInt(row[8]);
                protocol.numUnusedPaperBallots = parseInt(row[10]);
                protocol.numInvalidAndDestroyedPaperBallots = parseInt(row[11]);
                protocol.totalActualVoters =
                  document === "26"
                    ? parseInt(row[12]) - parseInt(row[15])
                    : parseInt(row[14]) || parseInt(row[13]);
              }
              if (row[16] !== "" && row[18] !== "") {
                protocol.numMachineBallots =
                  (protocol.numMachineBallots || 0) + parseInt(row[16]);
                protocol.numValidNoOneMachineVotes =
                  (protocol.numValidNoOneMachineVotes || 0) + parseInt(row[18]);
                protocol.numValidMachineVotes =
                  (protocol.numValidMachineVotes || 0) +
                  (row[17] !== ""
                    ? parseInt(row[17])
                    : protocol.totalActualVoters -
                      protocol.numValidNoOneMachineVotes);
              }
            } else {
              protocol.ballotsReceived = parseInt(row[6]);
              protocol.numRegisteredVoters = parseInt(row[7]);
              if (year === "2023_04_02") {
                protocol.numAdditionalVoters = parseInt(row[8]);
                protocol.totalActualVoters = parseInt(row[9]);
                protocol.numUnusedPaperBallots = parseInt(row[10]);
                protocol.numInvalidAndDestroyedPaperBallots = parseInt(row[11]);
                protocol.numPaperBallotsFound = parseInt(row[12]);
                protocol.numInvalidBallotsFound = parseInt(row[15]);
                if (row[17].trim() !== "") {
                  protocol.numMachineBallots = parseInt(row[17]);
                }
                protocol.numValidVotes = parseInt(row[19]);
                if (row[20].trim() !== "") {
                  protocol.numValidMachineVotes = parseInt(row[20]);
                }
                protocol.numValidNoOnePaperVotes = parseInt(row[22]);
                if (row[23].trim() !== "") {
                  protocol.numValidNoOneMachineVotes = parseInt(row[23]);
                }
              } else {
                const dataIdx = year === "2024_06_09" ? 10 : 8;
                protocol.numAdditionalVoters = parseInt(row[dataIdx]);
                protocol.totalActualVoters = parseInt(row[dataIdx + 1]);
                protocol.numUnusedPaperBallots = parseInt(row[dataIdx + 2]);
                protocol.numInvalidAndDestroyedPaperBallots = parseInt(
                  row[dataIdx + 3],
                );
                protocol.numPaperBallotsFound = parseInt(row[dataIdx + 4]);
                protocol.numInvalidBallotsFound = parseInt(row[dataIdx + 5]);
                protocol.numValidNoOnePaperVotes = parseInt(row[dataIdx + 6]);
                protocol.numValidVotes = parseInt(row[dataIdx + 7]);
                if (row.length > dataIdx + 8) {
                  if (row[dataIdx + 8].trim() !== "") {
                    protocol.numMachineBallots = parseInt(row[dataIdx + 8]);
                  }
                  if (row[dataIdx + 9].trim() !== "") {
                    protocol.numValidNoOneMachineVotes = parseInt(
                      row[dataIdx + 9],
                    );
                  }
                  if (row[dataIdx + 10].trim() !== "") {
                    protocol.numValidMachineVotes = parseInt(row[dataIdx + 10]);
                  }
                }
              }
            }
          }
          if (!existingProtocol) {
            allProtocols.push(protocol);
          }
        }
        /* const json = stringify(allProtocols);
        const outFile = `${outFolder}/${fileName}.json`;
        fs.writeFileSync(outFile, json, "utf8");
        console.log("Successfully added file ", outFile); */
        resolve(allProtocols);
      }),
  );
};
