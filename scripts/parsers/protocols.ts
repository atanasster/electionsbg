import fs from "fs";
import { parse } from "csv-parse";
import { SectionProtocol } from "@/data/dataTypes";

export type FullSectionProtocol = {
  // № формуляр
  document: string;
  //Пълен код на секция(код на район(2), община(2), адм. район(2), секция(3))
  section: string;
  //Код на РИК
  rik: string;
  //Фабрични номера на страниците на протокола, разделени с |
  pages: string;
} & SectionProtocol;

export const parseProtocols = async (
  inFolder: string,
  outFolder: string,
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
          const protocol: FullSectionProtocol = {
            document: row[0],
            section: row[1],
            rik: row[2],
            pages: row[3],
            ballotsReceived: parseInt(row[6]),
            numRegisteredVoters: parseInt(row[7]),
            numAdditionalVoters: parseInt(row[8]),
            totalActualVoters: parseInt(row[9]),
            numUnusedPaperBallots: parseInt(row[10]),
            numInvalidAndDestroyedPaperBallots: parseInt(row[11]),
            numPaperBallotsFound: parseInt(row[12]),
            numInvalidBallotsFound: parseInt(row[13]),
            numValidNoOnePaperVotes: parseInt(row[14]),
            numValidVotes: parseInt(row[15]),
          };
          if (row.length > 16) {
            protocol.numMachineBallots = parseInt(row[16]);
            protocol.numValidNoOneMachineVotes = parseInt(row[17]);
            protocol.numValidMachineVotes = parseInt(row[18]);
          }
          allProtocols.push(protocol);
        }
        const json = JSON.stringify(allProtocols, null, 2);
        const outFile = `${outFolder}/${fileName}.json`;
        fs.writeFileSync(outFile, json, "utf8");
        console.log("Successfully added file ", outFile);
        resolve(allProtocols);
      }),
  );
};
