import fs from "fs";
import { parse } from "csv-parse";
import { SectionInfo } from "@/data/dataTypes";

export const parseSections = (inFolder: string): Promise<SectionInfo[]> => {
  const result: string[][] = [];
  const allSections: SectionInfo[] = [];

  return new Promise((resolve) =>
    fs
      .createReadStream(`${inFolder}/sections.txt`)
      .pipe(parse({ delimiter: ";", relax_column_count: true }))
      .on("data", (data) => {
        result.push(data);
      })
      .on("end", () => {
        for (let i = 0; i < result.length; i++) {
          const row = result[i];

          const section: SectionInfo = {
            section: row[0],
            region: parseInt(row[1]),
            region_name: row[2],
            zip_code: parseInt(row[3]),
            settlement: row[4],
            address: row[5],
            is_mobile: parseInt(row[6]),
            is_ship: parseInt(row[7]),
            num_machines: parseInt(row[8]),
          };

          allSections.push(section);
        }
        resolve(allSections);
      }),
  );
};
