import fs from "fs";
import { parse } from "csv-parse";
import { FinancingFromDonors, PartyFilingIncome } from "@/data/dataTypes";

export const parseDonors = async ({
  dataFolder,
  income,
}: {
  dataFolder: string;
  income: PartyFilingIncome;
}): Promise<FinancingFromDonors[]> => {
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
        const allDonors: FinancingFromDonors[] = [];
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
        if (income.donors.monetary === 0 && income.donors.nonMonetary === 0) {
          const { monetary, nonMonetary } = allDonors.reduce(
            (acc, curr) => {
              return {
                monetary: acc.monetary + curr.monetary,
                nonMonetary: acc.nonMonetary + curr.nonMonetary,
              };
            },
            {
              monetary: 0,
              nonMonetary: 0,
            },
          );
          income.donors.monetary = monetary;
          income.donors.nonMonetary = nonMonetary;
        }
        // const json = stringify(allParties);

        //fs.writeFileSync(outFile, json, "utf8");
        // console.log("Successfully added file ", outFile);
        resolve(allDonors);
      }),
  );
};
