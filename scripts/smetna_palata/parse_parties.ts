import fs from "fs";
import { parse } from "csv-parse";
import { FinancingFromParties, PartyFiling } from "@/data/dataTypes";

export const parseFromParties = async ({
  dataFolder,
  income,
}: {
  dataFolder: string;
  income: PartyFiling;
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
        const allCandidates: FinancingFromParties[] = [];
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
            allCandidates.push({
              name,
              monetary,
              nonMonetary,
            });
          }
        }
        if (income.partyMonetary === 0 && income.partyNonMonetary === 0) {
          const { partyMonetary, partyNonMonetary } = allCandidates.reduce(
            (acc, curr) => {
              return {
                ...acc,
                partyMonetary: acc.partyMonetary + curr.monetary,
                partyNonMonetary: acc.partyNonMonetary + curr.nonMonetary,
              };
            },
            income,
          );
          income.partyMonetary = partyMonetary;
          income.partyNonMonetary = partyNonMonetary;
        }
        resolve(allCandidates);
      }),
  );
};
