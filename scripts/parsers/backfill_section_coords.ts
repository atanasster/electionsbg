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
//   1. data/YYYY_MM_DD/sections/by-oblast/*.json   (per-oblast bundles)
//   2. data/YYYY_MM_DD/settlements/*.json          (settlement screen — embeds sections array)
//   3. raw_data/YYYY_MM_DD/section_votes.json      (consumed by reports)
//
// Idempotent: only fills sections that don't already have a coordinate.
//
// THIS IS A REPAIR PASS, NOT THE PRIMARY DEFENCE. Only the 2026+ CEC source
// carries GPS (see the parser branches in ./sections.ts) — every older election
// holds coordinates that exist ONLY here, in generated output that .gitignore
// excludes (`/data/2*/*`). A re-parse rebuilds those files from `sections.txt`
// and therefore drops the coordinates, and git cannot notice. That is exactly
// what happened on 2026-07-18 and 2026-07-25: six elections (2021_07_11
// through 2024_10_27) were re-parsed without this pass and went to 0 geocoded
// sections, which then reached GCS.
//
// So the primary defence is preserveSectionCoords below, which carries existing
// coordinates through a re-parse without needing a donor election at all. This
// pass remains the way to populate a NEW election and to repair one already
// zeroed.
/**
 * Carry coordinates from the CURRENT raw_data/<year>/section_votes.json onto a
 * freshly parsed section list, for every section the parse left without one.
 *
 * Call this immediately after parseSections and before anything writes: the
 * flat file, the by-oblast bundles and the settlement shards are all rendered
 * from the same array, so patching it once fixes all three.
 *
 * Unlike backfillSectionCoords this needs no donor election — it reads the
 * election's own previous output — so it holds even when data/ has been wiped
 * of every other year, and it cannot pull a coordinate from a different
 * election onto a re-used section code. Returns how many it carried over.
 */
export const preserveSectionCoords = ({
  inFolder,
  sections,
}: {
  inFolder: string;
  sections: SectionInfo[];
}): number => {
  const flatFile = path.join(inFolder, sectionVotesFileName);
  if (!fs.existsSync(flatFile)) return 0;
  let prev: SectionInfo[];
  try {
    prev = JSON.parse(fs.readFileSync(flatFile, "utf-8"));
  } catch {
    return 0;
  }
  if (!Array.isArray(prev)) return 0;

  const known = new Map<string, { longitude: number; latitude: number }>();
  for (const s of prev)
    if (typeof s.longitude === "number" && typeof s.latitude === "number")
      known.set(s.section, { longitude: s.longitude, latitude: s.latitude });
  if (known.size === 0) return 0;

  let carried = 0;
  for (const s of sections) {
    if (typeof s.longitude === "number" && typeof s.latitude === "number")
      continue;
    const c = known.get(s.section);
    if (!c) continue;
    s.longitude = c.longitude;
    s.latitude = c.latitude;
    carried += 1;
  }
  if (carried)
    console.log(
      `preserveSectionCoords: carried ${carried} coordinate(s) through the re-parse`,
    );
  return carried;
};

export const backfillSectionCoords = ({
  publicFolder,
  dataFolder,
  only,
  stringify,
}: {
  publicFolder: string;
  dataFolder: string;
  /** Limit the sweep to these election folders. Omit to sweep every one. */
  only?: string[];
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

  const onlySet = only && only.length ? new Set(only) : null;
  const years = fs
    .readdirSync(publicFolder, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}_\d{2}_\d{2}$/.test(d.name))
    .map((d) => d.name)
    .filter((y) => !onlySet || onlySet.has(y))
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
