import fs from "fs";
import { parse } from "csv-parse";
import { SectionInfo } from "@/data/dataTypes";

export const parseSections = (
  inFolder: string,
  year: string,
): Promise<SectionInfo[]> => {
  const result: string[][] = [];
  const allSections: SectionInfo[] = [];

  return new Promise((resolve) =>
    fs
      .createReadStream(`${inFolder}/sections.txt`)
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
          const section = {} as SectionInfo;
          if (year <= "2013_05_12") {
            section.section = row[1];
            section.region = section.section.slice(0, 2);
            section.region_name = row[2];
            section.settlement = row[4];
            section.zip_code = row[5];
            section.is_mobile = 0;
            section.is_ship = 0;
            section.num_machines = 0;
          } else {
            section.section = row[0];
            if (year === "2014_10_05") {
              section.settlement = row[1];
              if (row[2] !== section.section) {
                section.ekatte = row[2];
              }
              section.region = section.section.slice(0, 2);
              section.is_mobile = parseInt(row[3]);
              section.is_ship = parseInt(row[4]);
              section.num_machines = row[5] ? parseInt(row[5]) : 0;
            } else {
              section.region = row[1];
              section.region_name = row[2];
              section.zip_code = row[3];
              section.settlement = row[4];

              if (year <= "2021_11_14") {
                section.is_mobile = parseInt(row[5]);
                section.is_ship = parseInt(row[6]);
                section.num_machines = row[7] ? parseInt(row[7]) : 0;
              } else {
                section.address = row[5];
                section.is_mobile = row[6].trim() !== "" ? parseInt(row[6]) : 0;
                section.is_ship = row[7].trim() !== "" ? parseInt(row[7]) : 0;
                section.num_machines =
                  row[8].trim() !== "" ? parseInt(row[8]) : 0;
              }
            }
          }
          allSections.push(section);
        }
        resolve(allSections);
      }),
  );
};
