import fs from "fs";
import { backupFileName } from "./backup_file";
import { sectionVotesFileName } from "scripts/consts";
import { SectionInfo } from "@/data/dataTypes";

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
    const or = backup.find((b) => b.section === r.section);
    if (!or) {
      throw new Error("Could not find original section: " + r.section);
    }
    r.original = { protocol: or.results.protocol, votes: or.results.votes };
  });
  return true;
};
