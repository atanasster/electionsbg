import fs from "fs";
import { parse } from "csv-parse";
import { PartyInfo } from "@/data/dataTypes";

export const parseParties = async (
  inFolder: string,
  outFolder: string,
  year: string,
): Promise<PartyInfo[]> => {
  const result: string[][] = [];
  const fileName = "cik_parties";
  const outFile = `${outFolder}/${fileName}.json`;
  const allParties: PartyInfo[] = [];
  if (fs.existsSync(outFile)) {
    const json = fs.readFileSync(outFile, "utf-8");
    if (json) {
      const parties: PartyInfo[] = JSON.parse(json);
      parties.forEach((p) => allParties.push(p));
    }
  }
  return new Promise((resolve) =>
    fs
      .createReadStream(`${inFolder}/${fileName}.txt`)
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
        const json = JSON.stringify(allParties, null, 2);

        fs.writeFileSync(outFile, json, "utf8");
        console.log("Successfully added file ", outFile);
        resolve(allParties);
      }),
  );
};
