import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SectionInfo } from "@/data/dataTypes";
import { isParliamentaryFolder } from "scripts/lib/electionFolders";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

export const findSectionInOtherElections = (
  section: string,
  yearMonth: string,
): SectionInfo | undefined => {
  // Election folders moved to /data/ during the GCS migration.
  const outFolder = path.resolve(__dirname, `../../data/`);

  // ⚠ PARLIAMENTARY ONLY. This looks a section up in OTHER elections' shards to
  // recover its settlement/coords, and the shards it reads are the parliamentary
  // `sections/by-oblast/` bundles. A `startsWith("20")` test also opened `_mi` and
  // (once the tree lands) `_pvr` folders, whose 9-digit codes are a DIFFERENT key
  // space on the 2011 oblast grid — a match there would attribute one election's
  // section to another. See scripts/lib/electionFolders.ts.
  const elections: string[] = fs
    .readdirSync(outFolder, { withFileTypes: true })
    .filter((file) => file.isDirectory())
    .filter(
      (file) => isParliamentaryFolder(file.name) && file.name !== yearMonth,
    )
    .map((f) => f.name)
    .sort((a, b) => a.localeCompare(b));
  // Per-election section data is now bundled by oblast (the leading 2
  // digits of the 9-digit section ID), so look the section up inside the
  // matching bundle rather than fetching a per-section file.
  const oblast = section.slice(0, 2);
  for (let i = 0; i < elections.length; i++) {
    const bundleFile = path.resolve(
      outFolder,
      elections[i],
      `./sections/by-oblast/${oblast}.json`,
    );
    if (!fs.existsSync(bundleFile)) continue;
    const bundle: Record<string, SectionInfo> = JSON.parse(
      fs.readFileSync(bundleFile, "utf-8"),
    );
    const s = bundle[section];
    if (s) {
      return {
        section,
        zip_code: s.zip_code,
        settlement: s.settlement,
        address: s.address,
      } as SectionInfo;
    }
  }
  return undefined;
};
