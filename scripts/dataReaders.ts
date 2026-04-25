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

/**
 * Group records by a partition key and write one JSON file per partition,
 * shaped as a `{ [recordKey]: record }` map for O(1) lookup in the client.
 *
 * Used to consolidate thousands of tiny per-record files (e.g. one per
 * polling section) into a few dozen per-oblast bundles. This trades a
 * single bigger fetch for many small ones — better on mobile latency and
 * eliminates the filesystem block-padding waste in the build output.
 */
export const savePartitioned = (
  o: { [key: string]: object },
  stringify: (o: object) => string,
  folder: string,
  partitionFn: (key: string) => string,
) => {
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  const grouped: { [partition: string]: { [key: string]: object } } = {};
  Object.keys(o).forEach((key) => {
    const p = partitionFn(key);
    if (!grouped[p]) grouped[p] = {};
    grouped[p][key] = o[key];
  });
  Object.keys(grouped).forEach((p) => {
    fs.writeFileSync(`${folder}/${p}.json`, stringify(grouped[p]), "utf8");
  });
  console.log(
    `Successfully wrote ${Object.keys(grouped).length} partition files to`,
    folder,
  );
};
