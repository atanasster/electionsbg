import fs from "fs";
import { parse } from "csv-parse";
import regionsData from "../../src/data/json/regions.json";
const regions = regionsData;

import path from "path";
import { fileURLToPath } from "url";
import { CandidatesInfo, ElectionInfo } from "@/data/dataTypes";
import { candidatesFileName, preferencesFileName } from "scripts/consts";
import { regionCodes } from "./region_codes";
import { capitalizeSentence } from "@/data/utils";
import { parsePreferences } from "./parse_preferences";
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

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

export const runAllCandidates = async (stringify: (o: object) => string) => {
  const outFolder = path.resolve(__dirname, `../../public/`);

  const electionsFile = path.resolve(
    __dirname,
    "../../src/data/json/elections.json",
  );
  const elections: ElectionInfo[] = JSON.parse(
    fs.readFileSync(electionsFile, "utf-8"),
  );

  const updatedElections: ElectionInfo[] = fs
    .readdirSync(outFolder, { withFileTypes: true })
    .filter((file) => file.isDirectory())
    .filter((file) => file.name.startsWith("20"))
    .map((f) => ({
      name: f.name,
      ...elections.find((p) => p.name === f.name),
    }))
    .sort((a, b) => b.name.localeCompare(a.name));
  const publicFolder = path.resolve(__dirname, `../../public`);
  const rawDataFolder = path.resolve(__dirname, `../../raw_data`);
  await Promise.all(
    updatedElections.map(async (e) => {
      const dataFolder = `${rawDataFolder}/${e.name}`;
      const candidates = await parseCandidates(dataFolder, e.name);
      fs.writeFileSync(
        `${publicFolder}/${e.name}/${candidatesFileName}`,
        stringify(candidates),
        "utf-8",
      );
      const preferences = await parsePreferences(dataFolder, e.name);
      fs.writeFileSync(
        `${dataFolder}/${preferencesFileName}`,
        stringify(preferences),
        "utf-8",
      );
    }),
  );
};
