import fs from "fs";
import { backupFileName } from "./backup_file";
import { municipalityVotesFileName } from "scripts/consts";
import { ElectionMunicipality } from "@/data/dataTypes";

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
    const or = backup.find((b) => b.obshtina === r.obshtina);
    if (!or) {
      throw new Error("Could  not find original region: " + r.obshtina);
    }
    r.original = { protocol: or.results.protocol, votes: or.results.votes };
  });
  return true;
};
