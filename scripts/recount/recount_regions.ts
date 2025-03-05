import fs from "fs";
import { backupFileName } from "./backup_file";
import { regionsVotesFileName } from "scripts/consts";
import { ElectionRegion } from "@/data/dataTypes";

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
    const or = backup.find((b) => b.key === r.key);
    if (!or) {
      throw new Error("Could not find original region: " + r.key);
    }
    r.original = { protocol: or.results.protocol, votes: or.results.votes };
  });
  return true;
};
