import fs from "fs";
import path from "path";
import { SectionInfo } from "@/data/dataTypes";
import { LocalSectionShard } from "./types";

// Stamp lat/lon (+ building address) onto every local-cycle section shard from
// the parliamentary section archive, which ships GPS + address per station.
//
// Source:  <data>/<YYYY_MM_DD>/sections/by-oblast/*.json   (parliamentary)
// Target:  <data>/<cycle>/sections/<obshtinaCode>.json     (local shards)
//
// The join is NOT a plain section-code equality. The two systems number
// sections differently — parliamentary codes are prefixed by the многомандатен
// район (МИР), local codes by the NSI административна област, and those diverge
// for Plovdiv and every oblast after it. Worse, section numbers (the secnum
// tail) are reassigned between cycles, so even an identical 9-digit code can be
// a different village two cycles later. The one reliable anchor is the
// settlement name: we accept a parliamentary coordinate ONLY when its
// settlement matches the local section's settlement (normalised). Candidates
// are tried building-precise first, then a settlement-level fallback:
//
//   1. exact 9-digit code                       (oblasts 01–15, unchanged code)
//   2. obshtina + last-5 (район+secnum)          (MIR-shifted plain obshtini)
//   3. globally-unique last-7                    (район-cities, e.g. Sofia)
//      — each gated on settlement agreement —
//   4. any station in the same obshtina+settlement (village-level fallback,
//      coords only, no address — it is a sibling building)
//
// This yields ~97–99% coverage with zero wrong-settlement placements. The pass
// is deterministic: it recomputes from scratch and OVERWRITES any previously
// stamped coords (so re-running corrects earlier, looser results).

type Geo = {
  longitude: number;
  latitude: number;
  settle: string;
  address?: string;
};

// Drop the гр./с./общ. prefix, collapse whitespace, lowercase — so "гр.София"
// (local) and "ГР.СОФИЯ" (parliamentary) compare equal.
const normSettle = (s: string | undefined): string =>
  (s ?? "")
    .replace(/^\s*(гр|с|общ|обл|кв|ж\.?к)\.?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

type Lookups = {
  exact: Record<string, Geo>;
  obLast5: Record<string, Geo>;
  obSettle: Record<string, Geo>;
  uniqLast7: Record<string, { rec: Geo; ambiguous: boolean }>;
};

// Build the four candidate maps from every parliamentary election that ships
// coordinates, newest first (first-seen wins — a station's freshest GPS).
const buildLookups = (dataFolder: string): Lookups => {
  const years = fs
    .readdirSync(dataFolder, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}_\d{2}_\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();

  const exact: Record<string, Geo> = {};
  const obLast5: Record<string, Geo> = {};
  const obSettle: Record<string, Geo> = {};
  const uniqLast7: Record<string, { rec: Geo; ambiguous: boolean }> = {};
  // The unique-last-7 path (район-cities, e.g. Sofia) hinges on a last-7 value
  // mapping to a single settlement. That holds within one election but not
  // across years (район boundaries / names drift), so judge uniqueness from
  // the newest source election only — the first one we walk that has bundles.
  let newestSourceSeen = false;

  for (const y of years) {
    const dir = path.join(dataFolder, y, "sections", "by-oblast");
    if (!fs.existsSync(dir)) continue;
    const isNewestSource = !newestSourceSeen;
    newestSourceSeen = true;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      let bundle: Record<string, SectionInfo>;
      try {
        bundle = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      } catch {
        continue;
      }
      for (const s of Object.values(bundle)) {
        if (typeof s.longitude !== "number" || typeof s.latitude !== "number") {
          continue;
        }
        const rec: Geo = {
          longitude: s.longitude,
          latitude: s.latitude,
          settle: s.settlement,
          address:
            typeof s.address === "string" && s.address.trim()
              ? s.address
              : undefined,
        };
        const code = s.section;
        if (!exact[code]) exact[code] = rec;
        if (s.obshtina) {
          const kL5 = `${s.obshtina}|${code.slice(4)}`;
          if (!obLast5[kL5]) obLast5[kL5] = rec;
          const kOS = `${s.obshtina}|${normSettle(s.settlement)}`;
          if (!obSettle[kOS]) obSettle[kOS] = rec;
        }
        if (isNewestSource) {
          const last7 = code.slice(2);
          const u = uniqLast7[last7];
          if (!u) uniqLast7[last7] = { rec, ambiguous: false };
          else if (normSettle(u.rec.settle) !== normSettle(s.settlement)) {
            u.ambiguous = true;
          }
        }
      }
    }
  }
  return { exact, obLast5, obSettle, uniqLast7 };
};

// Local section shards live directly under <cycle>/sections/*.json as
// `{ obshtinaCode, sections: [...] }` — distinct from the parliamentary
// per-oblast maps under <year>/sections/by-oblast/. Shape-detect so we only
// touch local shards.
const isLocalShard = (o: unknown): o is LocalSectionShard =>
  !!o &&
  typeof o === "object" &&
  typeof (o as LocalSectionShard).obshtinaCode === "string" &&
  Array.isArray((o as LocalSectionShard).sections);

export const backfillLocalSectionCoords = ({
  publicFolder,
  stringify,
}: {
  publicFolder: string;
  stringify: (o: object) => string;
}) => {
  const { exact, obLast5, obSettle, uniqLast7 } = buildLookups(publicFolder);
  const lookupSize = Object.keys(exact).length;
  if (lookupSize === 0) {
    console.log(
      "backfillLocalSectionCoords: no source election with coordinates found, skipping",
    );
    return;
  }
  console.log(
    `backfillLocalSectionCoords: indexed ${lookupSize} parliamentary sections`,
  );

  const cycles = fs
    .readdirSync(publicFolder, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const cycle of cycles) {
    const sectionsDir = path.join(publicFolder, cycle, "sections");
    if (!fs.existsSync(sectionsDir)) continue;

    let building = 0;
    let village = 0;
    let total = 0;
    let touchedFiles = 0;

    for (const f of fs.readdirSync(sectionsDir)) {
      if (!f.endsWith(".json")) continue;
      const file = path.join(sectionsDir, f);
      let shard: unknown;
      try {
        shard = JSON.parse(fs.readFileSync(file, "utf-8"));
      } catch {
        continue;
      }
      if (!isLocalShard(shard)) continue;
      const ob = shard.obshtinaCode;

      let changed = false;
      for (const s of shard.sections) {
        total += 1;
        // Recompute from scratch — clear any prior stamp first.
        const hadCoords =
          typeof s.longitude === "number" || s.address !== undefined;
        delete s.longitude;
        delete s.latitude;
        delete s.address;

        const ls = normSettle(s.settlement);
        const last7 = s.sectionCode.slice(2);
        const u = uniqLast7[last7];
        const buildingCands: (Geo | undefined)[] = [
          exact[s.sectionCode],
          obLast5[`${ob}|${s.sectionCode.slice(4)}`],
          u && !u.ambiguous ? u.rec : undefined,
        ];

        let stamped = false;
        for (const c of buildingCands) {
          if (c && normSettle(c.settle) === ls) {
            s.longitude = c.longitude;
            s.latitude = c.latitude;
            if (c.address) s.address = c.address;
            building += 1;
            stamped = true;
            break;
          }
        }
        if (!stamped) {
          const v = obSettle[`${ob}|${ls}`];
          if (v) {
            // Settlement-level fallback: right village, sibling building — so
            // coords only, never the (wrong) address.
            s.longitude = v.longitude;
            s.latitude = v.latitude;
            village += 1;
            stamped = true;
          }
        }
        if (stamped || hadCoords) changed = true;
      }
      if (changed) {
        fs.writeFileSync(file, stringify(shard), "utf8");
        touchedFiles += 1;
      }
    }

    if (total > 0) {
      const cover = Math.round((100 * (building + village)) / total);
      console.log(
        `  ${cycle}: ${building} building + ${village} village / ${total} sections (${cover}%) across ${touchedFiles} shard(s)`,
      );
    }
  }
};
