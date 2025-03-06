import fs from "fs";
import { backupFileName } from "./backup_file";
import { regionsVotesFileName } from "scripts/consts";
import { ElectionRegion } from "@/data/dataTypes";
import { calcRecountOriginal } from "./calc_original";

export const recountRegions = ({
  inFolder,
  electionRegions,
}: {
  inFolder: string;
  electionRegions: ElectionRegion[];
}) => {
  const backUpFile = `${inFolder}/${backupFileName(regionsVotesFileName)}`;
  if (!fs.existsSync(backUpFile)) {
    return false;
  }
  const data = fs.readFileSync(backUpFile, "utf-8");
  const backup: ElectionRegion[] = JSON.parse(data);
  electionRegions.forEach((r) => {
    const original = backup.find((b) => b.key === r.key);
    if (!original) {
      throw new Error("Could not find original region: " + r.key);
    }
    r.original = calcRecountOriginal({
      originalVotes: original.results.votes,
      recountVotes: r.results.votes,
    });
  });
  return true;
};
