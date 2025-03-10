import fs from "fs";
import { parse } from "csv-parse";
import {
  CandidatesInfo,
  FinancingFromCandidates,
  PartyFilingIncome,
} from "@/data/dataTypes";

export const parseFromCandidates = async ({
  dataFolder,
  income,
  candidates,
}: {
  dataFolder: string;
  income: PartyFilingIncome;
  candidates: CandidatesInfo[];
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

          let name = row[0];

          const monetary = parseFloat(row[2]);
          const nonMonetary = parseFloat(row[3]);
          if (
            name &&
            name !== "Сума:" &&
            (!isNaN(monetary) || !isNaN(nonMonetary))
          ) {
            const nameParts = name
              .toLowerCase()
              .split(" ")
              .filter((s) => s !== "");
            const nameMatches = candidates.find((candidate) => {
              const candidateParts = candidate.name
                .toLowerCase()
                .split(" ")
                .filter((s) => s !== "");
              if (
                nameParts.length === candidateParts.length &&
                nameParts.join(" ") === candidateParts.join(" ")
              ) {
                return true;
              }
              if (
                nameParts.length === 2 &&
                candidateParts.length === 3 &&
                nameParts[0] === candidateParts[0] &&
                nameParts[1] === candidateParts[2]
              ) {
                return true;
              }
              return false;
            });
            if (nameMatches) {
              name = nameMatches.name;
            } else {
              name = nameParts
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ");
            }

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
          income.candidates.monetary === 0 &&
          income.candidates.nonMonetary === 0
        ) {
          const { monetary, nonMonetary } = allCandidates.reduce(
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
          income.candidates.monetary = monetary;
          income.candidates.nonMonetary = nonMonetary;
        }
        resolve(allCandidates);
      }),
  );
};
