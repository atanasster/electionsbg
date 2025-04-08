import fs from "fs";
import {
  ElectionMunicipality,
  ElectionRegion,
  ElectionSettlement,
  SectionInfo,
} from "@/data/dataTypes";
import {
  municipalityVotesFileName,
  regionsVotesFileName,
  sectionVotesFileName,
  settlementsVotesFileName,
} from "./consts";

export const regionDataReader = (dataFolder: string, year?: string) => {
  if (!year) {
    return undefined;
  }
  const votes: ElectionRegion[] = JSON.parse(
    fs.readFileSync(`${dataFolder}/${year}/${regionsVotesFileName}`, "utf-8"),
  );
  return votes;
};
export const municipalityDataReader = (dataFolder: string, year?: string) => {
  if (!year) {
    return undefined;
  }
  const votes: ElectionMunicipality[] = JSON.parse(
    fs.readFileSync(
      `${dataFolder}/${year}/${municipalityVotesFileName}`,
      "utf-8",
    ),
  );
  return votes;
};

export const settlementDataReader = (dataFolder: string, year?: string) => {
  if (!year) {
    return undefined;
  }
  const votes: ElectionSettlement[] = JSON.parse(
    fs.readFileSync(
      `${dataFolder}/${year}/${settlementsVotesFileName}`,
      "utf-8",
    ),
  );
  return votes;
};

export const sectionDataReader = (dataFolder: string, year?: string) => {
  if (!year) {
    return undefined;
  }
  const votes: SectionInfo[] = JSON.parse(
    fs.readFileSync(`${dataFolder}/${year}/${sectionVotesFileName}`, "utf-8"),
  );
  return votes;
};

export const saveSplitObject = (
  o: { [key: string]: object },
  stringify: (o: object) => string,
  folder: string,
  ext?: string,
) => {
  Object.keys(o).forEach((key) => {
    const data = stringify(o[key]);
    fs.writeFileSync(
      `${folder}/${key}${ext ? `_${ext}` : ""}.json`,
      data,
      "utf8",
    );
  });
  console.log("Successfully added split files ", folder);
};
