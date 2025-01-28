import fs from "fs";
import { parse } from "csv-parse";
import regionsData from "../../src/data/json/regions.json";
const regions = regionsData;
import { CandidatesInfo } from "@/data/dataTypes";
import { regionCodes } from "../parsers/region_codes";
import { capitalizeSentence } from "@/data/utils";

export const parseCandidates = (
  inFolder: string,
  year: string,
): Promise<CandidatesInfo[]> => {
  const result: string[][] = [];
  const allCandidates: CandidatesInfo[] = [];
  const candidatesFile = `${inFolder}/local_candidates.txt`;
  if (!fs.existsSync(candidatesFile)) {
    return Promise.resolve([]);
  }
  return new Promise((resolve) =>
    fs
      .createReadStream(candidatesFile)
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
          const code = row[0].toString().padStart(2, "0");
          const nuts3 = regionCodes.find((c) => c.key === code)?.nuts3;
          if (!nuts3) {
            throw new Error(`Could not find region code: ${row[0]}`);
          }
          const region = regions.find((r) => r.nuts3 === nuts3);
          if (!region) {
            throw new Error(`Could not find region nuts3: ${nuts3}`);
          }
          const dataIndex = year <= "2014_10_05" ? 1 : 2;
          let prefNum = parseInt(row[dataIndex + 2]);
          if (prefNum < 100) {
            prefNum = prefNum + 100;
          }
          const name = capitalizeSentence(row[dataIndex + 3]);
          const candidate: CandidatesInfo = {
            name,
            oblast: region?.oblast,
            partyNum: parseInt(row[dataIndex]),
            pref: prefNum.toString(),
          };
          allCandidates.push(candidate);
        }
        resolve(allCandidates);
      }),
  );
};
