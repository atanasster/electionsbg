import fs from "fs";
import path from "path";
import { SectionInfo } from "@/data/dataTypes";
import { buildCoordsLookup } from "scripts/reports/problem_sections";
import { sectionVotesFileName } from "scripts/consts";

// Patch every election's section files with lat/lon backfilled from the latest
// election that has coordinates (currently 2026_04_19 — older CEC datasets did
// not include GPS). Section codes are stable from ~2009 onward, so coverage
// is high for 2009+ and near-zero for 2005 (renumbered ID scheme).
//
// Updates:
//   1. public/YYYY_MM_DD/sections/by-oblast/*.json   (per-oblast bundles)
//   2. public/YYYY_MM_DD/settlements/*.json          (settlement screen — embeds sections array)
//   3. raw_data/YYYY_MM_DD/section_votes.json        (consumed by reports)
//
// Idempotent: only fills sections that don't already have a coordinate.
export const backfillSectionCoords = ({
  publicFolder,
  dataFolder,
  stringify,
}: {
  publicFolder: string;
  dataFolder: string;
  stringify: (o: object) => string;
}) => {
  const lookup = buildCoordsLookup(publicFolder);
  const lookupSize = Object.keys(lookup).length;
  if (lookupSize === 0) {
    console.log(
      "backfillSectionCoords: no source election with coordinates found, skipping",
    );
    return;
  }
  console.log(
    `backfillSectionCoords: built lookup with ${lookupSize} sections`,
  );

  const years = fs
    .readdirSync(publicFolder, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}_\d{2}_\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort();

  for (const year of years) {
    let patchedBundle = 0;
    let patchedSettlement = 0;
    let patchedFlat = 0;
    let totalSections = 0;

    const byOblastDir = path.join(publicFolder, year, "sections", "by-oblast");
    if (fs.existsSync(byOblastDir)) {
      for (const f of fs.readdirSync(byOblastDir)) {
        if (!f.endsWith(".json")) continue;
        const file = path.join(byOblastDir, f);
        let bundle: Record<string, SectionInfo>;
        try {
          bundle = JSON.parse(fs.readFileSync(file, "utf-8"));
        } catch {
          continue;
        }
        let changed = false;
        for (const s of Object.values(bundle)) {
          totalSections += 1;
          if (
            typeof s.longitude === "number" &&
            typeof s.latitude === "number"
          ) {
            continue;
          }
          const c = lookup[s.section];
          if (!c) continue;
          s.longitude = c.longitude;
          s.latitude = c.latitude;
          patchedBundle += 1;
          changed = true;
        }
        if (changed) {
          fs.writeFileSync(file, stringify(bundle), "utf8");
        }
      }
    }

    const settlementsDir = path.join(publicFolder, year, "settlements");
    if (fs.existsSync(settlementsDir)) {
      for (const f of fs.readdirSync(settlementsDir)) {
        if (!f.endsWith(".json")) continue;
        const file = path.join(settlementsDir, f);
        let data: { sections?: SectionInfo[] };
        try {
          data = JSON.parse(fs.readFileSync(file, "utf-8"));
        } catch {
          continue;
        }
        if (!Array.isArray(data.sections)) continue;
        let changed = false;
        for (const s of data.sections) {
          if (
            typeof s.longitude === "number" &&
            typeof s.latitude === "number"
          ) {
            continue;
          }
          const c = lookup[s.section];
          if (!c) continue;
          s.longitude = c.longitude;
          s.latitude = c.latitude;
          patchedSettlement += 1;
          changed = true;
        }
        if (changed) {
          fs.writeFileSync(file, stringify(data), "utf8");
        }
      }
    }

    const flatFile = path.join(dataFolder, year, sectionVotesFileName);
    if (fs.existsSync(flatFile)) {
      let flat: SectionInfo[];
      try {
        flat = JSON.parse(fs.readFileSync(flatFile, "utf-8"));
      } catch {
        flat = [];
      }
      let changed = false;
      for (const s of flat) {
        if (typeof s.longitude === "number" && typeof s.latitude === "number") {
          continue;
        }
        const c = lookup[s.section];
        if (!c) continue;
        s.longitude = c.longitude;
        s.latitude = c.latitude;
        patchedFlat += 1;
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(flatFile, stringify(flat), "utf8");
      }
    }

    if (totalSections > 0 || patchedFlat > 0 || patchedSettlement > 0) {
      console.log(
        `  ${year}: backfilled ${patchedBundle}/${totalSections} bundle, ${patchedSettlement} settlement, ${patchedFlat} flat sections`,
      );
    }
  }
};
