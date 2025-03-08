import fs from "fs";
import { backupFileName } from "./backup_file";
import { settlementsVotesFileName } from "scripts/consts";
import { ElectionSettlement } from "@/data/dataTypes";
import { calcRecountOriginal } from "./calc_original";

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
    const original = backup.find((b) => b.ekatte === r.ekatte);
    if (!original) {
      throw new Error("Could not find original settlement: " + r.ekatte);
    }
    const calc = calcRecountOriginal({
      originalVotes: original.results.votes,
      recountVotes: r.results.votes,
    });
    if (calc) {
      r.original = calc;
    }
  });
  return true;
};
