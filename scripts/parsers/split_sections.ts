import fs from "fs";
import { SectionInfo } from "@/data/dataTypes";
import { sectionVotesFileName } from "scripts/consts";
import { savePartitioned } from "scripts/dataReaders";

// Section IDs are 9-digit strings where the leading 2 digits encode the
// oblast (electoral region). Bundling by this prefix turns ~12,000 tiny
// per-section JSON files into ~55 mid-sized per-oblast bundles per election.
const oblastOf = (sectionId: string) => sectionId.slice(0, 2);

export const splitSections = ({
  inFolder,
  outFolder,
  electionSections,
  stringify,
}: {
  inFolder: string;
  outFolder: string;
  electionSections: SectionInfo[];
  stringify: (o: object) => string;
}) => {
  const backupFileName = `${inFolder}/${sectionVotesFileName}`;
  fs.writeFileSync(backupFileName, stringify(electionSections), "utf8");
  console.log("Successfully added file ", backupFileName);
  const outDataFolder = `${outFolder}/sections`;

  // Wipe any prior per-section files from an older pipeline run so they
  // don't leak into the build alongside the new bundled output.
  if (fs.existsSync(outDataFolder)) {
    for (const f of fs.readdirSync(outDataFolder)) {
      const full = `${outDataFolder}/${f}`;
      if (fs.statSync(full).isFile() && f.endsWith(".json")) {
        fs.unlinkSync(full);
      }
    }
  } else {
    fs.mkdirSync(outDataFolder, { recursive: true });
  }

  const byKey = electionSections.reduce((acc, m) => {
    return { ...acc, [m.section]: m };
  }, {});
  savePartitioned(byKey, stringify, `${outDataFolder}/by-oblast`, oblastOf);
};
