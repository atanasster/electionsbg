import fs from "fs";
import { parse } from "csv-parse";

type PartyFromCandidates = {
  name: string;
  date: string;
  monetary: number;
  nonMonetary: number;
  goal?: string;
};
export const parseFromCandidates = async ({
  dataFolder,
}: {
  dataFolder: string;
}): Promise<PartyFromCandidates[]> => {
  const result: string[][] = [];
  const fromFileName = `${dataFolder}/from_candidates.csv`;
  if (!fs.existsSync(fromFileName)) {
    return [];
  }
  return new Promise((resolve) =>
    fs
      .createReadStream(fromFileName)
      .pipe(
        parse({ delimiter: ",", relax_column_count: true, relax_quotes: true }),
      )
      .on("data", (data) => {
        result.push(data);
      })
      .on("end", () => {
        const allDonors: PartyFromCandidates[] = [];
        for (let i = 0; i < result.length; i++) {
          const row = result[i];

          const name = row[0];
          const monetary = parseFloat(row[2]);
          const nonMonetary = parseFloat(row[3]);
          if (
            name &&
            name !== "Сума:" &&
            (!isNaN(monetary) || !isNaN(nonMonetary))
          ) {
            const date = row[1];
            const goal = row[4];
            allDonors.push({
              name,
              date,
              monetary,
              nonMonetary,
              goal,
            });
          }
        }
        // const json = stringify(allParties);

        //fs.writeFileSync(outFile, json, "utf8");
        // console.log("Successfully added file ", outFile);
        resolve(allDonors);
      }),
  );
};
