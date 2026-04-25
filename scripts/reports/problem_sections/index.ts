import fs from "fs";
import {
  ElectionInfo,
  PartyInfo,
  SectionInfo,
  StatsVote,
  VoteResults,
} from "@/data/dataTypes";
import { addResults } from "@/data/utils";
import { sectionDataReader } from "scripts/dataReaders";
import { cikPartiesFileName } from "scripts/consts";
import { PROBLEM_NEIGHBORHOODS, ProblemNeighborhood } from "./neighborhoods";

export type ProblemSectionsNeighborhood = {
  id: string;
  name_bg: string;
  name_en: string;
  city_bg: string;
  city_en: string;
  source_url: string;
  sections: SectionInfo[];
};

export type ProblemSectionsReport = {
  neighborhoods: ProblemSectionsNeighborhood[];
};

const MIN_ELECTION_DATE = "2024_10_27";

const matchesNeighborhood = (
  section: SectionInfo,
  n: ProblemNeighborhood,
): boolean => {
  if (n.sectionCodes?.includes(section.section)) return true;
  if (n.sectionPrefix && section.section.startsWith(n.sectionPrefix))
    return true;
  if (section.ekatte !== n.ekatte) return false;
  if (!n.addressIncludes?.length) return false;
  const addr = (section.address || "").toUpperCase();
  return n.addressIncludes.some((kw) => addr.includes(kw.toUpperCase()));
};

// Build a section-code → {longitude, latitude} map from the latest election that
// has coordinates. Used to backfill GPS for older elections where the CEC data
// didn't yet include lat/lon (pre-2026_04_19).
const buildCoordsLookup = (
  publicFolder: string,
): Record<string, { longitude: number; latitude: number }> => {
  const years = fs
    .readdirSync(publicFolder, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}_\d{2}_\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();
  const lookup: Record<string, { longitude: number; latitude: number }> = {};
  for (const y of years) {
    // Per-election section data is bundled per-oblast — each bundle file
    // contains a `{ [sectionId]: SectionInfo }` map. Walk every bundle and
    // record the first lat/lon we see for each section.
    const dir = `${publicFolder}/${y}/sections/by-oblast`;
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const bundle: Record<string, SectionInfo> = JSON.parse(
          fs.readFileSync(`${dir}/${f}`, "utf-8"),
        );
        for (const s of Object.values(bundle)) {
          if (
            !lookup[s.section] &&
            typeof s.longitude === "number" &&
            typeof s.latitude === "number"
          ) {
            lookup[s.section] = {
              longitude: s.longitude,
              latitude: s.latitude,
            };
          }
        }
      } catch {
        // ignore malformed files
      }
    }
  }
  return lookup;
};

export const generateProblemSections = ({
  publicFolder,
  dataFolder,
  year,
  stringify,
  coordsLookup,
}: {
  publicFolder: string;
  dataFolder: string;
  year: string;
  stringify: (o: object) => string;
  coordsLookup?: Record<string, { longitude: number; latitude: number }>;
}) => {
  if (year < MIN_ELECTION_DATE) return;
  const sections = sectionDataReader(dataFolder, year);
  if (!sections) return;
  const report: ProblemSectionsReport = {
    neighborhoods: PROBLEM_NEIGHBORHOODS.map((n) => {
      const matched = sections
        .filter((s) => matchesNeighborhood(s, n))
        .map((s) => {
          if (
            coordsLookup &&
            (typeof s.longitude !== "number" || typeof s.latitude !== "number")
          ) {
            const coords = coordsLookup[s.section];
            if (coords) {
              return {
                ...s,
                longitude: coords.longitude,
                latitude: coords.latitude,
              };
            }
          }
          return s;
        })
        .sort((a, b) => a.section.localeCompare(b.section));
      return {
        id: n.id,
        name_bg: n.name_bg,
        name_en: n.name_en,
        city_bg: n.city_bg,
        city_en: n.city_en,
        source_url: n.source_url,
        sections: matched,
      };
    }).filter((n) => n.sections.length > 0),
  };
  const outFile = `${publicFolder}/${year}/problem_sections.json`;
  fs.writeFileSync(outFile, stringify(report), "utf8");
  const total = report.neighborhoods.reduce((a, n) => a + n.sections.length, 0);
  const withGps = report.neighborhoods.reduce(
    (a, n) =>
      a +
      n.sections.filter(
        (s) =>
          typeof s.longitude === "number" && typeof s.latitude === "number",
      ).length,
    0,
  );
  console.log(
    `Generated problem_sections.json for ${year}: ${report.neighborhoods.length} neighborhoods, ${total} sections (${withGps} with GPS)`,
  );
};

export { buildCoordsLookup };

export const generateProblemSectionsStats = ({
  publicFolder,
  stringify,
}: {
  publicFolder: string;
  stringify: (o: object) => string;
}) => {
  const years = fs
    .readdirSync(publicFolder, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}_\d{2}_\d{2}$/.test(d.name))
    .map((d) => d.name)
    .filter((y) => y >= MIN_ELECTION_DATE)
    .sort();
  const history: ElectionInfo[] = [];
  years.forEach((year) => {
    const file = `${publicFolder}/${year}/problem_sections.json`;
    if (!fs.existsSync(file)) return;
    const data: ProblemSectionsReport = JSON.parse(
      fs.readFileSync(file, "utf-8"),
    );
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(`${publicFolder}/${year}/${cikPartiesFileName}`, "utf-8"),
    );
    const results: VoteResults = { votes: [] };
    data.neighborhoods.forEach((n) =>
      n.sections.forEach((s) => {
        if (s.results) {
          addResults(results, s.results.votes, s.results.protocol);
        }
      }),
    );
    history.push({
      name: year,
      results: {
        protocol: results.protocol,
        votes: results.votes.map((v) => {
          const party = parties.find((p) => p.number === v.partyNum);
          const stat: StatsVote = {
            ...v,
            number: party?.number as number,
            nickName: party?.nickName as string,
          };
          if (party?.commonName) {
            stat.commonName = party.commonName;
          }
          return stat;
        }),
      },
    });
  });
  const outFile = `${publicFolder}/problem_sections_stats.json`;
  fs.writeFileSync(outFile, stringify(history), "utf8");
  console.log(
    `Generated problem_sections_stats.json with ${history.length} elections`,
  );
};
