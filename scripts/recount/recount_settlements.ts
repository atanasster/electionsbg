import fs from "fs";
import { backupFileName } from "./backup_file";
import { settlementsVotesFileName } from "scripts/consts";
import { ElectionSettlement } from "@/data/dataTypes";

export const recountSettlements = ({
  inFolder,
  electionSettlements,
}: {
  inFolder: string;
  electionSettlements: ElectionSettlement[];
}) => {
  const backUpFile = `${inFolder}/${backupFileName(settlementsVotesFileName)}`;
  if (!fs.existsSync(backUpFile)) {
    throw new Error("Recount file not found: " + backUpFile);
  }
  const data = fs.readFileSync(backUpFile, "utf-8");
  const backup: ElectionSettlement[] = JSON.parse(data);
  electionSettlements.forEach((r) => {
    const or = backup.find((b) => b.ekatte === r.ekatte);
    if (!or) {
      throw new Error("Could not find original settlement: " + r.ekatte);
    }
    r.original = { protocol: or.results.protocol, votes: or.results.votes };
  });
  return true;
};
