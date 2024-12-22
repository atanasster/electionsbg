import fs from "fs";
import { parse } from "csv-parse";
import { FinancingFromCandidates, PartyFiling } from "@/data/dataTypes";

export const parseFromCandidates = async ({
  dataFolder,
  income,
}: {
  dataFolder: string;
  income: PartyFiling;
}): Promise<FinancingFromCandidates[]> => {
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
        const allCandidates: FinancingFromCandidates[] = [];
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
            allCandidates.push({
              name,
              date,
              monetary,
              nonMonetary,
              goal,
            });
          }
        }
        if (
          income.candidatesMonetary === 0 &&
          income.candidatesNonMonetary === 0
        ) {
          const { candidatesMonetary, candidatesNonMonetary } =
            allCandidates.reduce((acc, curr) => {
              return {
                ...acc,
                candidatesMonetary: acc.candidatesMonetary + curr.monetary,
                candidatesNonMonetary:
                  acc.candidatesNonMonetary + curr.nonMonetary,
              };
            }, income);
          income.candidatesMonetary = candidatesMonetary;
          income.candidatesNonMonetary = candidatesNonMonetary;
        }
        resolve(allCandidates);
      }),
  );
};
