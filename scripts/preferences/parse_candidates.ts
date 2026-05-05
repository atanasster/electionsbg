import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse";
import regionsData from "../../src/data/json/regions.json";
const regions = regionsData;
import { CandidatesInfo } from "@/data/dataTypes";
import { regionCodes } from "../parsers/region_codes";
import { capitalizeSentence } from "@/data/utils";
import { transliterateName } from "@/data/candidates/transliterateName";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load parliament/index.json once so each candidate's English name can reuse
// the parliament.bg EN-API form when the candidate later matched an MP. The
// CIK file has no MP id, so we key by normalized Bulgarian name. Homonyms
// across MPs are resolved at display time by useResolvedCandidate; for the
// stored `name_en` field we accept the first MP's English form — same name
// transliterates the same way regardless of which person it is.
type MpIndexFile = { mps: { normalizedName: string; name_en: string }[] };
let mpEnByNormalizedName: Map<string, string> | null = null;
const loadMpIndex = (): Map<string, string> => {
  if (mpEnByNormalizedName) return mpEnByNormalizedName;
  const indexFile = path.resolve(
    __dirname,
    "../../public/parliament/index.json",
  );
  const m = new Map<string, string>();
  if (fs.existsSync(indexFile)) {
    try {
      const idx: MpIndexFile = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      for (const mp of idx.mps ?? []) {
        if (mp.name_en && !m.has(mp.normalizedName)) {
          m.set(mp.normalizedName, mp.name_en);
        }
      }
    } catch {
      // Missing/unparseable parliament index — every candidate falls back to
      // algorithmic transliteration. Acceptable on a fresh clone.
    }
  }
  mpEnByNormalizedName = m;
  return m;
};

const englishNameFor = (
  bgTitleCased: string,
  mpEn: Map<string, string>,
): string => {
  const key = bgTitleCased.toUpperCase().replace(/\s+/g, " ").trim();
  return mpEn.get(key) ?? transliterateName(bgTitleCased);
};

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
  const mpEn = loadMpIndex();
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
          if (isNaN(prefNum)) {
            throw new Error("Invalid preference number " + row[dataIndex + 2]);
          }
          if (prefNum < 100) {
            prefNum = prefNum + 100;
          }
          if (prefNum > 100) {
            const name = capitalizeSentence(row[dataIndex + 3]);
            const candidate: CandidatesInfo = {
              name,
              name_en: englishNameFor(name, mpEn),
              oblast: region?.oblast,
              partyNum: parseInt(row[dataIndex]),
              pref: prefNum.toString(),
            };
            allCandidates.push(candidate);
          }
        }
        resolve(allCandidates);
      }),
  );
};
