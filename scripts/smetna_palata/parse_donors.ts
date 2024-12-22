import fs from "fs";
import { parse } from "csv-parse";
import { PartyIncome } from "@/data/dataTypes";

type PartyDonors = {
  name: string;
  date: string;
  monetary: number;
  nonMonetary: number;
  goal?: string;
  coalition?: string;
  party?: string;
};
export const parseDonors = async ({
  dataFolder,
  income,
}: {
  dataFolder: string;
  income: PartyIncome;
}): Promise<PartyDonors[]> => {
  const result: string[][] = [];
  const fromFileName = `${dataFolder}/from_donors.csv`;
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
        const allDonors: PartyDonors[] = [];
        for (let i = 0; i < result.length; i++) {
          const row = result[i];

          const name = row[0];
          const date = row[1];
          const monetary = parseFloat(row[2]);
          const nonMonetary = parseFloat(row[3]);
          if (
            name &&
            name !== "Сума:" &&
            (!isNaN(monetary) || !isNaN(nonMonetary))
          ) {
            const goal = row[4];
            const coalition = row[5];
            const party = row[6];
            allDonors.push({
              name,
              date,
              monetary,
              nonMonetary,
              goal,
              coalition,
              party,
            });
          }
        }
        if (income.donorsMonetary === 0 && income.donorsNonMonetary === 0) {
          const { donorsMonetary, donorsNonMonetary } = allDonors.reduce(
            (acc, curr) => {
              return {
                ...acc,
                donorsMonetary: acc.donorsMonetary + curr.monetary,
                donorsNonMonetary: acc.donorsMonetary + curr.nonMonetary,
              };
            },
            income,
          );
          income.donorsMonetary = donorsMonetary;
          income.donorsNonMonetary = donorsNonMonetary;
        }
        // const json = stringify(allParties);

        //fs.writeFileSync(outFile, json, "utf8");
        // console.log("Successfully added file ", outFile);
        resolve(allDonors);
      }),
  );
};
