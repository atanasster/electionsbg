import fs from "fs";
import { parse } from "csv-parse";
import { FinancingFromParties, PartyFilingIncome } from "@/data/dataTypes";

export const parseFromParties = async ({
  dataFolder,
  income,
}: {
  dataFolder: string;
  income: PartyFilingIncome;
}): Promise<FinancingFromParties[]> => {
  const result: string[][] = [];
  const fromFileName = `${dataFolder}/from_parties.csv`;
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
        const allParties: FinancingFromParties[] = [];
        for (let i = 0; i < result.length; i++) {
          const row = result[i];

          const name = row[0];
          const monetary = parseFloat(row[1]);
          const nonMonetary = parseFloat(row[2]);
          if (
            name &&
            name !== "Сума:" &&
            (!isNaN(monetary) || !isNaN(nonMonetary))
          ) {
            allParties.push({
              name,
              monetary,
              nonMonetary,
            });
          }
        }
        if (income.party.monetary === 0 && income.party.nonMonetary === 0) {
          const { monetary, nonMonetary } = allParties.reduce(
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
          income.party.monetary = monetary;
          income.party.nonMonetary = nonMonetary;
        }
        resolve(allParties);
      }),
  );
};
