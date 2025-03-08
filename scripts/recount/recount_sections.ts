import fs from "fs";
import { backupFileName } from "./backup_file";
import { sectionVotesFileName } from "scripts/consts";
import { SectionInfo } from "@/data/dataTypes";
import { calcRecountOriginal } from "./calc_original";

export const recountSections = ({
  inFolder,
  electionSections,
}: {
  inFolder: string;
  electionSections: SectionInfo[];
}) => {
  const backUpFile = `${inFolder}/${backupFileName(sectionVotesFileName)}`;
  if (!fs.existsSync(backUpFile)) {
    throw new Error("Recount file not found: " + backUpFile);
  }
  const data = fs.readFileSync(backUpFile, "utf-8");
  const backup: SectionInfo[] = JSON.parse(data);
  electionSections.forEach((r) => {
    const original = backup.find((b) => b.section === r.section);
    if (!original) {
      throw new Error("Could not find original section: " + r.section);
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
