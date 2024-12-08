import fs from "fs";
import { parse } from "csv-parse";
import { PartyInfo } from "@/data/dataTypes";
import { cikPartiesFileName } from "scripts/consts";

export const parseParties = async (
  inFolder: string,
  outFolder: string,
  year: string,
  stringify: (o: object) => string,
): Promise<PartyInfo[]> => {
  const result: string[][] = [];

  const outFile = `${outFolder}/${cikPartiesFileName}`;
  const allParties: PartyInfo[] = [];
  if (fs.existsSync(outFile)) {
    const json = fs.readFileSync(outFile, "utf-8");
    const parties: PartyInfo[] = JSON.parse(json);
    parties.forEach((p) => allParties.push(p));
  }
  return new Promise((resolve) =>
    fs
      .createReadStream(`${inFolder}/cik_parties.txt`)
      .pipe(
        parse({ delimiter: ";", relax_column_count: true, relax_quotes: true }),
      )
      .on("data", (data) => {
        result.push(data);
      })
      .on("end", () => {
        for (let i = 0; i < result.length; i++) {
          const row = result[i];

          const numRow = year <= "2013_05_12" ? 1 : 0;
          const partyNumber = parseInt(row[numRow]);
          let party = allParties.find((p) => p.number === partyNumber);
          if (!party) {
            party = {
              number: partyNumber,
              name: row[1],
              color: "lightslategrey",
              nickName: row[numRow + 1],
            };
            allParties.push(party);
          } else {
            party.number = partyNumber;
            party.name = row[numRow + 1];
          }
        }
        const json = stringify(allParties);

        fs.writeFileSync(outFile, json, "utf8");
        console.log("Successfully added file ", outFile);
        resolve(allParties);
      }),
  );
};
