import fs from "fs";
import { backupFileName } from "./backup_file";
import { municipalityVotesFileName } from "scripts/consts";
import { ElectionMunicipality } from "@/data/dataTypes";
import { calcRecountOriginal } from "./calc_original";

export const recountMunicipalities = ({
  inFolder,
  electionMunicipalities,
}: {
  inFolder: string;
  electionMunicipalities: ElectionMunicipality[];
}) => {
  const backUpFile = `${inFolder}/${backupFileName(municipalityVotesFileName)}`;
  if (!fs.existsSync(backUpFile)) {
    throw new Error("Recount file not found: " + backUpFile);
  }
  const data = fs.readFileSync(backUpFile, "utf-8");
  const backup: ElectionMunicipality[] = JSON.parse(data);
  electionMunicipalities.forEach((r) => {
    const original = backup.find((b) => b.obshtina === r.obshtina);
    if (!original) {
      throw new Error("Could not find original municipality: " + r.obshtina);
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
