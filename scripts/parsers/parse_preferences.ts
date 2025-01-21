import fs from "fs";
import { parse } from "csv-parse";
import { PreferencesInfo } from "@/data/dataTypes";

export const parsePreferences = (
  inFolder: string,
  year: string,
): Promise<PreferencesInfo[]> => {
  const result: string[][] = [];
  const allPreferences: PreferencesInfo[] = [];
  const preferencesFile = `${inFolder}/preferences.txt`;
  if (!fs.existsSync(preferencesFile)) {
    return Promise.resolve([]);
  }
  return new Promise((resolve) =>
    fs
      .createReadStream(preferencesFile)
      .pipe(
        parse({
          delimiter: ";",
          relax_column_count: true,
          relax_quotes: true,
        }),
      )
      .on("data", (data) => {
        result.push(data);
      })
      .on("end", () => {
        for (let i = 0; i < result.length; i++) {
          const row = result[i];
          const section = row[1];
          const totalVotes = parseInt(row[4]);
          const pref = row[3];
          if (totalVotes && !isNaN(parseInt(pref))) {
            const preference: PreferencesInfo = {
              section,
              partyNum: parseInt(row[2]),
              pref,
              totalVotes,
              paperVotes: parseInt(row[5]),
              machineVotes: parseInt(row[6]),
            };
            allPreferences.push(preference);
          }
        }

        resolve(allPreferences);
      }),
  );
  console.log(year);
};
