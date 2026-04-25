// One-off migration: converts the existing per-section files under
// /public/<date>/sections/<id>.json into per-oblast bundles under
// /public/<date>/sections/by-oblast/<XX>.json, then deletes the originals.
//
// Run once per local checkout to avoid re-executing the full data pipeline.
// The pipeline (scripts/parsers/split_sections.ts) emits the bundled layout
// directly, so future `npm run prod` runs don't need this script.

import fs from "fs";
import path from "path";

const publicFolder = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../public",
);

const electionDirs = fs
  .readdirSync(publicFolder, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^2\d{3}_\d{2}_\d{2}$/.test(d.name))
  .map((d) => d.name);

let totalOldFiles = 0;
let totalBundles = 0;

for (const date of electionDirs) {
  const sectionsDir = `${publicFolder}/${date}/sections`;
  if (!fs.existsSync(sectionsDir)) continue;

  const entries = fs.readdirSync(sectionsDir, { withFileTypes: true });
  const files = entries.filter(
    (e) => e.isFile() && e.name.endsWith(".json") && !e.name.startsWith("by-"),
  );
  if (files.length === 0) continue;

  const grouped: { [oblast: string]: { [section: string]: unknown } } = {};
  for (const f of files) {
    const sectionId = f.name.replace(/\.json$/, "");
    const oblast = sectionId.slice(0, 2);
    const data = JSON.parse(fs.readFileSync(`${sectionsDir}/${f.name}`, "utf-8"));
    if (!grouped[oblast]) grouped[oblast] = {};
    grouped[oblast][sectionId] = data;
  }

  const byOblastDir = `${sectionsDir}/by-oblast`;
  fs.mkdirSync(byOblastDir, { recursive: true });
  for (const oblast of Object.keys(grouped)) {
    fs.writeFileSync(
      `${byOblastDir}/${oblast}.json`,
      JSON.stringify(grouped[oblast]),
      "utf-8",
    );
  }

  // Remove the old per-section files now that bundles exist
  for (const f of files) {
    fs.unlinkSync(`${sectionsDir}/${f.name}`);
  }

  totalOldFiles += files.length;
  totalBundles += Object.keys(grouped).length;
  console.log(
    `  ${date}: ${files.length} files → ${Object.keys(grouped).length} oblast bundles`,
  );
}

console.log(
  `\nMigrated ${totalOldFiles} per-section files into ${totalBundles} oblast bundles.`,
);
