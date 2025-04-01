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
        let sectionPreferences: PreferencesInfo[] = [];
        let prevSection: string = "";
        for (let i = 0; i < result.length; i++) {
          const row = result[i];
          const dataIndex = year <= "2021_04_04" ? 0 : 1;
          const section = row[dataIndex];
          if (prevSection !== section) {
            sectionPreferences = [];
          }
          prevSection = section;
          const totalVotes = parseInt(row[dataIndex + 3]);
          if (isNaN(totalVotes)) {
            throw new Error(
              `Invalid total preferences: ${section}-${row[dataIndex + 3]}`,
            );
          }
          let prefNum = parseInt(row[dataIndex + 2]);
          if (totalVotes && !isNaN(prefNum)) {
            if (prefNum < 100) {
              prefNum = prefNum + 100;
            }
            if (prefNum > 100) {
              const preference: PreferencesInfo = {
                section,
                partyNum: parseInt(row[dataIndex + 1]),
                pref: prefNum.toString(),
                totalVotes,
              };
              if (
                sectionPreferences.find(
                  (p) =>
                    p.partyNum === preference.partyNum &&
                    p.pref === preference.pref,
                )
              ) {
                throw new Error(
                  `Duplicate preference ${section}-${preference.partyNum}-${preference.pref}`,
                );
              }
              const paperVotes = parseInt(row[dataIndex + 4]);
              if (!isNaN(paperVotes)) {
                preference.paperVotes = paperVotes;
              }
              const machineVotes = parseInt(row[dataIndex + 5]);
              if (!isNaN(machineVotes)) {
                preference.machineVotes = machineVotes;
              }
              sectionPreferences.push(preference);
              allPreferences.push(preference);
            }
          }
        }

        resolve(allPreferences);
      }),
  );
};
