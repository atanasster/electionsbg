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
        const uniqueDocuments: string[] = [];
        for (let i = 0; i < result.length; i++) {
          const row = result[i];
          const sectionRow =
            year === "2014_10_05" || year <= "2009_07_05" ? 0 : 1;
          const document = sectionRow === 1 ? row[0] : "24";
          let section = row[sectionRow];
          if (section.startsWith("*")) {
            section = section.substring(1);
          }
          const existingProtocol = allProtocols.find(
            (p) => p.section == section,
          );
          const protocol: FullSectionProtocol =
            existingProtocol || ({} as FullSectionProtocol);
          protocol.section = section;
          if (year <= "2005_06_25") {
            protocol.numRegisteredVoters = parseInt(row[4]);
            protocol.numAdditionalVoters = parseInt(row[5]);
            protocol.totalActualVoters = parseInt(row[8]);
            protocol.numPaperBallotsFound = parseInt(row[8]);
            protocol.numInvalidBallotsFound = parseInt(row[12]);
            protocol.numValidVotes = parseInt(row[13]);
          } else if (year === "2009_07_05") {
            if (!existingProtocol) {
              protocol.totalActualVoters = parseInt(row[9]);
              protocol.numAdditionalVoters =
                parseInt(row[3]) + parseInt(row[4]);
              protocol.numRegisteredVoters =
                parseInt(row[1]) - protocol.numAdditionalVoters;
              protocol.numPaperBallotsFound = parseInt(row[19]);
              protocol.numInvalidBallotsFound = parseInt(row[25]);
              protocol.numValidVotes =
                protocol.numPaperBallotsFound - protocol.numInvalidBallotsFound;
            } else {
              protocol.numMachineBallots = parseInt(row[19]);
              protocol.numValidNoOneMachineVotes = parseInt(row[25]);
              protocol.numValidMachineVotes = parseInt(row[26]);
            }
          } else if (year === "2013_05_12") {
            if (!uniqueDocuments.includes(document)) {
              debugger;
            }
            protocol.ballotsReceived = parseInt(row[3]);
            protocol.numRegisteredVoters = parseInt(row[4]);
            protocol.numAdditionalVoters = parseInt(row[5]) + parseInt(row[6]);
            protocol.totalActualVoters = parseInt(row[7]);
            protocol.numUnusedPaperBallots = parseInt(row[19]);
            protocol.numInvalidAndDestroyedPaperBallots = parseInt(row[20]);
            protocol.numPaperBallotsFound = parseInt(row[24]);
            protocol.numInvalidBallotsFound = parseInt(row[32]);
            protocol.numValidVotes = parseInt(row[33]);
          } else if (year === "2014_10_05") {
            protocol.ballotsReceived = parseInt(row[2]);
            protocol.numRegisteredVoters = parseInt(row[3]);
            protocol.numAdditionalVoters = parseInt(row[4]);
            protocol.totalActualVoters = parseInt(row[5]);
            protocol.numUnusedPaperBallots = parseInt(row[9]);
            protocol.numInvalidAndDestroyedPaperBallots =
              parseInt(row[10]) +
              parseInt(row[11]) +
              parseInt(row[12]) +
              parseInt(row[13]) +
              parseInt(row[14]);

            protocol.numPaperBallotsFound = parseInt(row[15]);
            protocol.numInvalidBallotsFound = parseInt(row[16]);
            protocol.numValidVotes = parseInt(row[17]);
            protocol.numValidNoOnePaperVotes = parseInt(row[18]);
          } else {
            protocol.rik = row[2];
            if (year === "2017_03_26") {
              protocol.ballotsReceived = parseInt(row[4]);
              protocol.numRegisteredVoters = parseInt(row[5]);
              protocol.numAdditionalVoters = parseInt(row[6]);
              protocol.totalActualVoters = parseInt(row[7]);
              protocol.numUnusedPaperBallots = parseInt(row[8]);
              protocol.numInvalidAndDestroyedPaperBallots =
                parseInt(row[9]) +
                (parseInt(row[10]) || 0) +
                (parseInt(row[11]) || 0) +
                (parseInt(row[12]) || 0) +
                (parseInt(row[13]) || 0);
              protocol.numPaperBallotsFound = parseInt(row[14]);
              protocol.numInvalidBallotsFound = parseInt(row[15]);
              protocol.numValidVotes = parseInt(row[17]);
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
              if (document === "25" || document === "29") {
                protocol.ballotsReceived = parseInt(row[4]);
                protocol.numRegisteredVoters = parseInt(row[5]);
                protocol.numAdditionalVoters = parseInt(row[6]);
                protocol.totalActualVoters = parseInt(row[7]);
                protocol.numUnusedPaperBallots = parseInt(row[8]);
                protocol.numInvalidAndDestroyedPaperBallots = parseInt(row[9]);
              } else if (
                document === "31" ||
                document === "32" ||
                document === "27" ||
                document === "41"
              ) {
                protocol.numValidNoOneMachineVotes =
                  (protocol.numValidNoOneMachineVotes || 0) + parseInt(row[16]);
                protocol.numValidMachineVotes =
                  (protocol.numValidMachineVotes || 0) + parseInt(row[15]);
                protocol.numMachineBallots =
                  (protocol.numMachineBallots || 0) + parseInt(row[14]);
              } else if (
                document === "28" ||
                document === "26" ||
                document === "24"
              ) {
                protocol.ballotsReceived = parseInt(row[4]);
                protocol.numRegisteredVoters = parseInt(row[5]);
                protocol.numAdditionalVoters = parseInt(row[6]);
                protocol.totalActualVoters = parseInt(row[7]);
                protocol.numUnusedPaperBallots = parseInt(row[8]);
                protocol.numInvalidAndDestroyedPaperBallots = parseInt(row[9]);
                protocol.numPaperBallotsFound = parseInt(row[11]);
                protocol.numInvalidBallotsFound = parseInt(row[13]);
                protocol.numValidVotes = parseInt(row[15]);
                protocol.numValidNoOnePaperVotes = parseInt(row[16]);
              }
            } else if (isMachineOnlyVote(year)) {
              if (document === "25" || document === "29" || document === "30") {
                protocol.totalActualVoters = parseInt(row[9]);
                protocol.ballotsReceived = parseInt(row[6]);
                protocol.numRegisteredVoters = parseInt(row[7]);
                protocol.numAdditionalVoters = parseInt(row[8]);
                protocol.numUnusedPaperBallots = parseInt(row[10]);
                protocol.numInvalidAndDestroyedPaperBallots = parseInt(row[11]);
                protocol.numValidNoOneMachineVotes = 0;
                protocol.numValidMachineVotes = 0;
                protocol.numMachineBallots = 0;
              } else if (
                document === "31" ||
                document === "32" ||
                document === "27" ||
                document === "41"
              ) {
                protocol.numValidNoOneMachineVotes =
                  (protocol.numValidNoOneMachineVotes || 0) + parseInt(row[18]);
                protocol.numValidMachineVotes =
                  (protocol.numValidMachineVotes || 0) + parseInt(row[17]);
                protocol.numMachineBallots =
                  (protocol.numMachineBallots || 0) + parseInt(row[16]);
              } else {
                protocol.ballotsReceived = parseInt(row[6]);
                protocol.numRegisteredVoters = parseInt(row[7]);
                protocol.numAdditionalVoters = parseInt(row[8]);
                protocol.numUnusedPaperBallots = parseInt(row[10]);
                protocol.numInvalidAndDestroyedPaperBallots = parseInt(row[11]);
                if (row[13]) {
                  protocol.numPaperBallotsFound = parseInt(row[13]);
                }
                if (document === "24" || document === "28") {
                  protocol.totalActualVoters = parseInt(row[16]);
                  protocol.numValidVotes = parseInt(row[17]);
                  protocol.numValidNoOnePaperVotes = parseInt(row[18]);
                } else if (document === "26") {
                  protocol.totalActualVoters = parseInt(row[9]);
                  protocol.numValidVotes = parseInt(row[17]);
                  protocol.numInvalidBallotsFound = parseInt(row[15]);
                  protocol.numValidNoOnePaperVotes = parseInt(row[18]);
                  protocol.numMachineBallots = parseInt(row[14]);
                }
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
              } else if (year === "2024_06_09") {
                protocol.numAdditionalVoters = parseInt(row[10]);
                protocol.totalActualVoters = parseInt(row[11]);
                protocol.numUnusedPaperBallots = parseInt(row[12]);
                protocol.numInvalidAndDestroyedPaperBallots = parseInt(row[13]);
                protocol.numPaperBallotsFound = parseInt(row[14]);
                protocol.numInvalidBallotsFound = parseInt(row[15]);
                protocol.numValidNoOnePaperVotes = parseInt(row[16]);
                protocol.numValidVotes = parseInt(row[17]);
                if (row.length > 18) {
                  if (row[18].trim() !== "") {
                    protocol.numMachineBallots = parseInt(row[18]);
                  }
                  if (row[19].trim() !== "") {
                    protocol.numValidNoOneMachineVotes = parseInt(row[19]);
                  }
                  if (row[20].trim() !== "") {
                    protocol.numValidMachineVotes = parseInt(row[20]);
                  }
                }
              } else {
                protocol.numAdditionalVoters = parseInt(row[8]);
                protocol.totalActualVoters = parseInt(row[9]);
                protocol.numUnusedPaperBallots = parseInt(row[10]);
                protocol.numInvalidAndDestroyedPaperBallots = parseInt(row[11]);
                protocol.numPaperBallotsFound = parseInt(row[12]);
                protocol.numInvalidBallotsFound = parseInt(row[13]);
                protocol.numValidNoOnePaperVotes = parseInt(row[14]);
                protocol.numValidVotes = parseInt(row[15]);
                if (row.length > 16) {
                  if (row[16].trim() !== "") {
                    protocol.numMachineBallots = parseInt(row[16]);
                  }
                  if (row[17].trim() !== "") {
                    protocol.numValidNoOneMachineVotes = parseInt(row[17]);
                  }
                  if (row[18].trim() !== "") {
                    protocol.numValidMachineVotes = parseInt(row[18]);
                  }
                }
              }
            }
          }
          if (!uniqueDocuments.includes(document)) {
            uniqueDocuments.push(document);
          }
          if (!existingProtocol) {
            allProtocols.push(protocol);
          }
        }
        resolve(allProtocols);
      }),
  );
};
